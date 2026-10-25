// The document, on this machine: files, browser storage, and the tabs that hold several at once.
//
// The mirror of useServerStorage, and split along the same line. Three things that look separate
// and are one concern, because all three are "a document that lives here rather than on a server"
// and all three go through the same two functions:
//
//   .emv files      a file the user picked, written with the File System Access API where it
//                   exists and downloaded where it does not
//   IndexedDB       projects kept in the browser, plus the autosave that crash recovery offers
//   tabs            several documents open at once, each one a snapshot in memory
//
// What stays in App and arrives as functions: buildData, restore, and resetToEmpty. The first two
// for the reason useServerStorage gives - building a document reads most of App's state and
// restoring one writes most of it. resetToEmpty for the same reason from the other end: emptying
// the document means clearing cuts, tracks, the playhead, the selection, the layer cache and both
// media tracks, which is App's business and not this file's.
//
// Nothing here touches a canvas, a stroke, or the timeline.

import { useState, useRef, useEffect } from 'react';
import { saveProject, loadProject, listProjects, deleteProject, loadAutosave, autosaveKey, patchProject, listFolders, addFolder, moveFolder } from '../db.ts';
import { renderDocPreview } from '../canvas/docPreview.ts';
import type { BrowsedProject } from '../ui/dialogs/ProjectBrowser.tsx';
import { downloadBlob } from '../export/download.ts';
import { ZipWriter } from '../export/zip.ts';
import { splitProject, pieceFileName, piecesAreSequential } from '../core/splitProject.ts';
import { randomId, nextId } from '../core/ids.ts';
import { safeArray } from '../core/geometry.ts';
import { tr } from '../i18n.ts';
import type { Ask } from './useAsk.ts';
import { BLANK_IDENTITY, hasIdentity, isBlankDocument, type DocIdentity } from '../core/docTabs.ts';
/** What the local side needs from the app: how to build and restore a document, how to empty it, and where to report. */
export interface LocalDocumentDeps {
    buildData: (includeAudio?: boolean, assetSink?: any[] | null, blobsOk?: boolean) => Promise<any>;
    restore: (data: any, assetBase?: string | null, label?: string) => Promise<boolean>;
    resetToEmpty: () => void;
    setAppError: (m: string) => void;
    setToast: (m: string) => void;
    /** how to ask, since a hook has no dialog of its own */
    ask: Ask;
    setLoadProgress: (p: { label: string, done: number, total: number } | null) => void;
    /** owned by App, because resetToEmpty clears it */
    fileHandleRef: { current: any };
    /** owned by App, because the server backup falls back on it */
    localNameRef: { current: string };
    /** the server project this document saves to - useServerStorage's; kept per tab here */
    serverIdRef: { current: string | null };
    serverNameRef: { current: string };
    /** the frame open now, small, for the project's preview in the browser */
    makeThumb?: () => Promise<Blob | null>;
}
/** One open document in the tab strip. */
export interface Tab { id: string; name: string }


/** How often to ask the browser how much room is left. */
const QUOTA_POLL_MS = 60000;

/**
 * @param {object} opts
 * @param {(includeAudio?: boolean, assetSink?: any[], blobsOk?: boolean) => Promise<any>} opts.buildData
 * @param {(data: any, assetBase?: string|null, label?: string) => Promise<boolean>} opts.restore
 * @param {() => void} opts.resetToEmpty
 * @param {(m: string) => void} opts.setAppError
 * @param {(m: string) => void} opts.setToast
 * @param {Ask} opts.ask how to ask, since a hook has no dialog of its own
 * @param {(p: any) => void} opts.setLoadProgress
 * @param {{current: any}} opts.fileHandleRef owned by App, because resetToEmpty clears it
 * @param {{current: string}} opts.localNameRef owned by App, because the server backup falls back
 *   to it for a name and that hook is created first
 */
export function useLocalDocuments({ buildData, restore, resetToEmpty, setAppError, setToast, ask, setLoadProgress, fileHandleRef, localNameRef, serverIdRef, serverNameRef, makeThumb }: LocalDocumentDeps) {
    const [localProjects, setLocalProjects] = useState<BrowsedProject[] | null>(null); // null = browser closed
    const [localFolders, setLocalFolders] = useState<string[]>([]);
    // The folder open in the browser - where "save under a new name" puts a project - and the
    // object URLs the cards' previews are shown through, released when the list is replaced.
    const localBrowseRef = useRef('');
    const previewUrlsRef = useRef<string[]>([]);
    const localOpenRef = useRef(false);
    localOpenRef.current = localProjects !== null;
    const localFillingRef = useRef(false);
    const localIdRef = useRef<string | null>(null);
    const [storageInfo, setStorageInfo] = useState<{ usage: number, quota: number, pct: number } | null>(null);

    const [tabs, setTabs] = useState<Tab[]>([{ id: 't1', name: tr('프로젝트 1') }]);
    const [activeTabId, setActiveTabId] = useState('t1');
    const tabDocsRef = useRef<Record<string, any>>({}); // id -> doc snapshot (null = fresh/empty)
    const tabBusyRef = useRef(false);

    // Crash recovery has to finish deciding before the autosave may write, or a new empty document
    // overwrites the very thing the user is about to be offered.
    const didRecoverRef = useRef(false);

    // --- .emv files --------------------------------------------------------------------------
    const doSave = async (asNew = false) => {
        const json = JSON.stringify(await buildData(), null, 2);
        if ('showSaveFilePicker' in window && (asNew || !fileHandleRef.current)) {
            try {
                const h = await window.showSaveFilePicker!({ suggestedName: 'project.emv', types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                fileHandleRef.current = h;
                const w = await h.createWritable(); await w.write(json); await w.close();
                return;
            } catch (e: any) { if (e.name === 'AbortError') return; }
        } else if ('showSaveFilePicker' in window && fileHandleRef.current) {
            try { const w = await fileHandleRef.current.createWritable(); await w.write(json); await w.close(); return; } catch {
                // The handle stopped working. The download below still saves the work, but it
                // goes to the downloads folder rather than over the file the user chose, so
                // silence here would read as a successful overwrite.
                fileHandleRef.current = null;
                setToast(tr('저장한 파일에 쓸 수 없어 다운로드로 저장합니다'));
            }
        }
        downloadBlob(new Blob([json], { type: 'application/json' }), 'project.emv');
    };

    /**
     * What the progress overlay says while a document is being opened.
     *
     * Named, because the overlay blocks the screen and "opening a project" does not say *which*
     * - and the one time that matters is exactly when several are in play: switching tabs,
     * restoring a backup, or opening the wrong file by mistake, where the name is the only way
     * to notice before it has replaced what was on screen.
     *
     * It stays a blocking overlay rather than becoming a corner chip like the video download.
     * That chip means "carry on working"; opening replaces the document underneath, so there is
     * nothing to carry on with, and saying otherwise would be the lie.
     */
    const openingLabel = (name?: string | null, verb?: string): string => {
        const base = verb || tr('프로젝트 여는 중');
        return name ? `${base} — ${name}` : base;
    };

    // A large .emv looks frozen during the read and parse alone, so that stretch shows just a
    // label with an indeterminate bar (total 0); restore then takes over with real progress.
    const readAndRestore = async (getText: () => Promise<string>, name?: string): Promise<boolean> => {
        setLoadProgress({ label: openingLabel(name, tr('파일 읽는 중')), done: 0, total: 0 });
        try {
            const text = await getText();
            setLoadProgress({ label: openingLabel(name, tr('파일 분석 중')), done: 0, total: 0 });
            await new Promise(r => setTimeout(r, 0)); // give the bar a chance to paint once
            const data = JSON.parse(text);
            return await restore(data, null, openingLabel(name));
        } catch (err: any) {
            setLoadProgress(null);
            setAppError(tr('파일 오류: ') + err.message);
            return false;
        }
    };

    const doOpen = async () => {
        if ('showOpenFilePicker' in window) {
            try {
                const [h] = await window.showOpenFilePicker!({ types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                // Only after the file is actually open. Set first, the handle pointed at a file
                // that had not been loaded - and the next save would write whatever is on screen
                // over it.
                if (await openInTab(h.name, () => readAndRestore(async () => (await h.getFile()).text(), h.name))) fileHandleRef.current = h;
                return;
            } catch (e: any) { if (e.name === 'AbortError') return; }
        }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.emv';
        inp.onchange = e => {
            const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
            openInTab(f.name, () => readAndRestore(() => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = ev => res(ev.target!.result as string); r.onerror = rej; r.readAsText(f); }), f.name));
        };
        inp.click();
    };

    /**
     * Split this project into one .emv per part, delivered as a single zip.
     *
     * The other half of #123: the export queue can combine pieces, and until now the pieces had
     * to be made by hand. Past a certain number of cuts the app lags, so the advice is to work in
     * pieces - advice that is only followable if splitting is one action.
     *
     * A zip rather than several downloads, because a browser blocks the second and third file of
     * a burst and there is no way to tell that has happened from in here.
     *
     * Built once and sliced, rather than the app being rearranged once per piece: splitProject is
     * a function of the document, so nothing on screen moves while this runs.
     */
    const doSplitSave = async () => {
        try {
            setLoadProgress({ label: tr('프로젝트 나누는 중'), done: 0, total: 0 });
            // Self-contained pieces: base64 rather than Blobs, because each one has to open on its
            // own on a machine that has nothing else.
            const full = await buildData();
            const pieces = splitProject(full, tr('파트'));
            if (pieces.length < 2) {
                setAppError(tr('나눌 파트가 없습니다. 컷을 파트로 묶은 뒤 다시 시도하세요.'));
                return;
            }
            // A part is any group of cuts, adjacent or not, so pieces can overlap in time. Laying
            // those end to end afterwards gives a longer film with the gaps blank - a real
            // consequence of grouping non-adjacent cuts, and not what "split my timeline into
            // chunks" leads anyone to expect. Better asked here than discovered in the export.
            if (!piecesAreSequential(pieces)
                && !await ask.confirm(tr('파트들이 시간 순서로 나뉘어 있지 않습니다. 이대로 나누면 조각끼리 시간이 겹쳐서, 나중에 이어 붙일 때 빈 구간이 생깁니다. 계속할까요?'), { okLabel: tr('나누기') })) {
                return;
            }
            const zip = new ZipWriter();
            const enc = new TextEncoder();
            pieces.forEach((piece, i) => {
                zip.add(pieceFileName(i, pieces.length, piece.name), enc.encode(JSON.stringify(piece.doc)));
            });
            downloadBlob(new Blob([zip.finish()], { type: 'application/zip' }), 'mv_parts.zip');
            setToast(tr('{0}개 파트로 나눴습니다.', pieces.length));
        } catch (e: any) {
            setAppError(tr('나누기 실패: ') + (e?.message || String(e)));
        } finally {
            setLoadProgress(null);
        }
    };

    const doNew = async () => {
        if (!await ask.confirm(tr('새 프로젝트? 저장되지 않은 내용은 사라집니다.'), { okLabel: tr('새 프로젝트') })) return;
        resetToEmpty();
    };

    // --- IndexedDB projects ------------------------------------------------------------------
    const doLocalSave = async (forceNew = false) => {
        try {
            const data = await buildData(true, null, true); // IndexedDB stores frame Blobs directly
            // The preview is a nicety, as on the server: a save without one is still a save.
            const thumb = await makeThumb?.().catch(() => null) ?? null;
            if (!forceNew && localIdRef.current) { await saveProject(localIdRef.current, data, localNameRef.current || 'Untitled', { keep: true, ...(thumb ? { thumb } : {}) }); setToast(tr('로컬에 저장했습니다.')); return; }
            const name = await ask.prompt(tr('로컬 저장 이름:'), { value: localNameRef.current || 'MV Project', okLabel: tr('저장') });
            if (!name) return;
            const id = randomId('l_');
            await saveProject(id, data, name, { folder: localBrowseRef.current, thumb });
            localIdRef.current = id; localNameRef.current = name;
            setToast(tr('로컬에 저장했습니다.'));
        } catch (e: any) { setAppError(tr('로컬 저장 실패: ') + e.message); }
    };

    const releasePreviews = () => { for (const u of previewUrlsRef.current) URL.revokeObjectURL(u); previewUrlsRef.current = []; };
    const previewUrl = (blob: Blob) => { const u = URL.createObjectURL(blob); previewUrlsRef.current.push(u); return u; };

    const openLocalList = async () => {
        try {
            const rows = (await listProjects()).filter(p => p.id !== autosaveKey);
            releasePreviews();
            setLocalProjects(rows.map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt, folder: r.folder, thumbUrl: r.thumb ? previewUrl(r.thumb) : null })));
            setLocalFolders(await listFolders());
            localOpenRef.current = true;
            fillLocalPreviews(rows.filter(r => !r.thumb).map(r => r.id));
        }
        catch (e: any) { setAppError(tr('로컬 목록 실패: ') + e.message); }
    };
    const closeLocalList = () => { setLocalProjects(null); releasePreviews(); };

    // Projects saved before previews existed get one from their first page, once, as on the
    // server (useServerStorage). Stored on the record, so it is not drawn again.
    const fillLocalPreviews = async (ids: string[]) => {
        if (localFillingRef.current) return;
        localFillingRef.current = true;
        try {
            for (const id of ids) {
                if (!localOpenRef.current) break;
                try {
                    const blob = await renderDocPreview(await loadProject(id), '', async () => { throw new Error('no server assets locally'); });
                    if (!blob) continue;
                    await patchProject(id, { thumb: blob });
                    const url = previewUrl(blob);
                    setLocalProjects(list => list && list.map(q => (q.id === id ? { ...q, thumbUrl: url } : q)));
                } catch (e) { console.warn('[preview]', id, e); }
            }
        } finally { localFillingRef.current = false; }
    };

    /** One change to the stored projects or folders, then the list as it now is. */
    const changeLocal = async (run: () => Promise<unknown>) => {
        try { await run(); await openLocalList(); }
        catch (e: any) { setAppError(tr('변경 실패: ') + e.message); }
    };
    const renameLocalProject = (id: string, name: string) => changeLocal(async () => {
        await patchProject(id, { name });
        if (localIdRef.current === id) localNameRef.current = name;
    });
    const moveLocalProject = (id: string, folder: string) => changeLocal(() => patchProject(id, { folder }));
    const createLocalFolder = (path: string) => changeLocal(() => addFolder(path));
    const moveLocalFolder = (from: string, to: string) => changeLocal(() => moveFolder(from, to));
    const deleteLocalFolder = async (path: string) => {
        if (!await ask.confirm(tr('이 폴더를 지울까요? 안에 있던 프로젝트와 폴더는 한 단계 위로 옮겨집니다.'), { okLabel: tr('삭제') })) return;
        await changeLocal(() => moveFolder(path, null));
    };
    const setLocalBrowseFolder = (folder: string) => { localBrowseRef.current = folder; };

    const doLocalOpen = async (id: string, name?: string) => {
        try {
            const data = await loadProject(id);
            if (!data) { setAppError(tr('데이터가 없습니다.')); return; }
            // As in doServerOpen: the identity is only ours once the document is actually in.
            closeLocalList();
            if (!await openInTab(name, () => restore(data, null, openingLabel(name)))) return;
            localIdRef.current = id; localNameRef.current = name || '';
        }
        catch (e: any) { setAppError(tr('로컬 열기 실패: ') + e.message); }
    };

    const doLocalDelete = async (id: string) => {
        if (!await ask.confirm(tr('이 로컬 프로젝트를 삭제할까요?'), { okLabel: tr('삭제') })) return;
        try { await deleteProject(id); if (localIdRef.current === id) { localIdRef.current = null; localNameRef.current = ''; } openLocalList(); }
        catch (e: any) { setAppError(tr('삭제 실패: ') + e.message); }
    };

    // --- Tabs (multiple projects open at once, Clip Studio / SAI style) -----------------------
    // Each tab keeps a full in-memory document snapshot (buildData with Blobs, so no base64 cost).
    // Switching = snapshot the current tab, then restore the target's snapshot.
    // Where each tab's document saves to (core/docTabs). Taken when a tab is left and put back
    // when it is entered, so a save in one tab never writes over another tab's project.
    const tabIdentityRef = useRef<Record<string, DocIdentity>>({});
    const currentIdentity = (): DocIdentity => ({
        fileHandle: fileHandleRef.current, localId: localIdRef.current, localName: localNameRef.current,
        serverId: serverIdRef.current, serverName: serverNameRef.current,
    });
    const applyIdentity = (id: DocIdentity | undefined) => {
        const i = id || BLANK_IDENTITY;
        fileHandleRef.current = i.fileHandle; localIdRef.current = i.localId; localNameRef.current = i.localName;
        serverIdRef.current = i.serverId; serverNameRef.current = i.serverName;
    };

    const snapshotActiveTab = async () => {
        // A failure here is not cosmetic: the snapshot is the only copy of this tab's work once we
        // switch away from it, so the caller must not switch.
        const doc = await buildData(true, null, true);
        tabDocsRef.current[activeTabId] = doc;
        tabIdentityRef.current[activeTabId] = currentIdentity();
        return doc;
    };

    /**
     * Open a project in a tab of its own. `open` puts the document on screen and says whether it
     * went in; the caller records where it saves to afterwards, as before.
     *
     * A blank tab that saves nowhere is used as it is, the way a drawing app reuses its untitled
     * canvas. Otherwise the current tab is kept as it is and a new one opened; if the document
     * does not go in, the new tab is closed and the one that was open comes back.
     */
    const openInTab = async (name: string | undefined, open: () => Promise<boolean>): Promise<boolean> => {
        if (tabBusyRef.current) return false;
        tabBusyRef.current = true;
        try {
            const prevId = activeTabId;
            let prevDoc: any;
            try { prevDoc = await snapshotActiveTab(); }
            catch (e: any) { setAppError(tr('현재 탭을 저장할 수 없어 새 탭을 열지 않았습니다: ') + (e?.message || String(e))); return false; }
            const label = name || tr('프로젝트');
            if (isBlankDocument(prevDoc) && !hasIdentity(tabIdentityRef.current[prevId])) {
                applyIdentity(BLANK_IDENTITY);
                const ok = await open();
                if (ok) setTabs(p => p.map(t => (t.id === prevId ? { ...t, name: label } : t)));
                return ok;
            }
            const id = 't' + nextId().toString(36);
            setTabs(p => [...p, { id, name: label }]);
            tabDocsRef.current[id] = null;
            setActiveTabId(id);
            applyIdentity(BLANK_IDENTITY);
            if (await open()) return true;
            // It did not go in: back to the tab that was open, as it was.
            setTabs(p => p.filter(t => t.id !== id));
            delete tabDocsRef.current[id];
            setActiveTabId(prevId);
            await restore(prevDoc, null, openingLabel(tabs.find(t => t.id === prevId)?.name));
            applyIdentity(tabIdentityRef.current[prevId]);
            return false;
        } finally { tabBusyRef.current = false; }
    };

    const switchTab = async (id: string) => {
        if (id === activeTabId || tabBusyRef.current) return;
        tabBusyRef.current = true;
        try {
            try { await snapshotActiveTab(); }
            catch (e: any) { setAppError(tr('현재 탭을 저장할 수 없어 탭을 바꾸지 않았습니다: ') + (e?.message || String(e))); return; }
            setActiveTabId(id);
            const doc = tabDocsRef.current[id];
            if (doc) await restore(doc, null, openingLabel(tabs.find(t => t.id === id)?.name)); else resetToEmpty();
            applyIdentity(tabIdentityRef.current[id]);
        } finally { tabBusyRef.current = false; }
    };

    const newTab = async () => {
        if (tabBusyRef.current) return; tabBusyRef.current = true;
        try {
            // Same reasoning as switchTab: opening a new tab means leaving this one, and leaving
            // it without a snapshot loses it.
            try { await snapshotActiveTab(); }
            catch (e: any) { setAppError(tr('현재 탭을 저장할 수 없어 새 탭을 열지 않았습니다: ') + (e?.message || String(e))); return; }
            const id = 't' + nextId().toString(36);
            setTabs(p => [...p, { id, name: tr('프로젝트 ') + (p.length + 1) }]);
            tabDocsRef.current[id] = null;
            setActiveTabId(id);
            resetToEmpty();
            applyIdentity(BLANK_IDENTITY);
        } finally { tabBusyRef.current = false; }
    };

    /** Rename a tab. Asking for the name is the caller's business; this only records it. */
    const renameTab = (id: string, name: string) => setTabs(p => p.map(t => (t.id === id ? { ...t, name: name || t.name } : t)));

    const closeTab = async (id: string) => {
        if (tabs.length <= 1) { if (await ask.confirm(tr('마지막 탭입니다. 내용을 비울까요?'), { okLabel: tr('비우기') })) { resetToEmpty(); applyIdentity(BLANK_IDENTITY); tabDocsRef.current[id] = null; } return; }
        if (!await ask.confirm(tr('이 탭을 닫을까요? 저장하지 않은 내용은 사라집니다.'), { okLabel: tr('닫기') })) return;
        delete tabDocsRef.current[id];
        delete tabIdentityRef.current[id];
        const rest = tabs.filter(t => t.id !== id);
        setTabs(rest);
        if (id === activeTabId) {
            const target = rest[rest.length - 1];
            setActiveTabId(target.id);
            const doc = tabDocsRef.current[target.id];
            if (doc) await restore(doc, null, openingLabel(target.name)); else resetToEmpty();
            applyIdentity(tabIdentityRef.current[target.id]);
        }
    };

    // --- Crash recovery and the storage budget ------------------------------------------------
    // Offer the last autosave on first load. Deliberately a question rather than automatic: the
    // autosave may be older than what the user meant to open.
    useEffect(() => {
        let cancelled = false;
        loadAutosave().then(async data => {
            if (cancelled || !data || !Array.isArray(data.cuts)) return;
            const meaningful = data.cuts.length > 1 || data.cuts.some((c: Cut) =>
                safeArray<Layer>(c.layers).some(l => safeArray(l.strokes).length) || safeArray(c.texts).length);
            if (!meaningful) return;
            const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : '';
            if (await ask.confirm(tr('이전에 자동저장된 작업이 있습니다{0}.\n복구할까요?', when ? ` (${when})` : ''), { okLabel: tr('복구') })) {
                restore(data, null, tr('자동저장 복구 중'));
            }
        }).catch(() => { }).finally(() => { didRecoverRef.current = true; });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount, by design
    }, []);

    // Ask the browser to make local storage persistent, so the IndexedDB autosave isn't
    // silently evicted under storage pressure (the main way local-only work gets lost).
    useEffect(() => { navigator.storage?.persist?.().catch(() => { }); }, []);

    // Warn before the local quota runs out — a failed autosave is otherwise invisible.
    useEffect(() => {
        let alive = true;
        const check = async () => {
            try {
                const est = await navigator.storage?.estimate?.();
                if (!est || !alive || !est.quota) return;
                setStorageInfo({ usage: est.usage || 0, quota: est.quota, pct: (est.usage || 0) / est.quota });
            } catch { }
        };
        check();
        const id = setInterval(check, QUOTA_POLL_MS);
        return () => { alive = false; clearInterval(id); };
    }, []);

    return {
        doSave, doOpen, doNew, readAndRestore, doSplitSave,
        localProjects, setLocalProjects, localIdRef, localNameRef, localFolders, closeLocalList,
        renameLocalProject, moveLocalProject, createLocalFolder, moveLocalFolder, deleteLocalFolder, setLocalBrowseFolder,
        doLocalSave, openLocalList, doLocalOpen, doLocalDelete,
        tabs, activeTabId, switchTab, newTab, closeTab, renameTab, openInTab,
        storageInfo, didRecoverRef,
    };
}
