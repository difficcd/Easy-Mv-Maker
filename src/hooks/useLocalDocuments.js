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
import { saveProject, loadProject, listProjects, deleteProject, loadAutosave, autosaveKey } from '../db.js';
import { downloadBlob } from '../export/download.js';
import { randomId, nextId } from '../core/ids.js';
import { safeArray } from '../canvas/canvasUtils.js';
import { tr } from '../i18n.js';

/** How often to ask the browser how much room is left. */
const QUOTA_POLL_MS = 60000;

/**
 * @param {object} opts
 * @param {(includeAudio?: boolean, assetSink?: any[], blobsOk?: boolean) => Promise<any>} opts.buildData
 * @param {(data: any, assetBase?: string|null, label?: string) => Promise<boolean>} opts.restore
 * @param {() => void} opts.resetToEmpty
 * @param {(m: string) => void} opts.setAppError
 * @param {(m: string) => void} opts.setToast
 * @param {(p: any) => void} opts.setLoadProgress
 * @param {{current: any}} opts.fileHandleRef owned by App, because resetToEmpty clears it
 * @param {{current: string}} opts.localNameRef owned by App, because the server backup falls back
 *   to it for a name and that hook is created first
 */
export function useLocalDocuments({ buildData, restore, resetToEmpty, setAppError, setToast, setLoadProgress, fileHandleRef, localNameRef }) {
    const [localProjects, setLocalProjects] = useState(/** @type {any} */(null)); // null = picker closed
    const localIdRef = useRef(/** @type {string|null} */(null));
    const [storageInfo, setStorageInfo] = useState(/** @type {any} */(null));

    const [tabs, setTabs] = useState([{ id: 't1', name: tr('프로젝트 1') }]);
    const [activeTabId, setActiveTabId] = useState('t1');
    const tabDocsRef = useRef(/** @type {Record<string, any>} */({})); // id -> doc snapshot (null = fresh/empty)
    const tabBusyRef = useRef(false);

    // Crash recovery has to finish deciding before the autosave may write, or a new empty document
    // overwrites the very thing the user is about to be offered.
    const didRecoverRef = useRef(false);

    // --- .emv files --------------------------------------------------------------------------
    const doSave = async (asNew = false) => {
        const json = JSON.stringify(await buildData(), null, 2);
        if ('showSaveFilePicker' in window && (asNew || !fileHandleRef.current)) {
            try {
                const h = await window.showSaveFilePicker({ suggestedName: 'project.emv', types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                fileHandleRef.current = h;
                const w = await h.createWritable(); await w.write(json); await w.close();
                return;
            } catch (e) { if (e.name === 'AbortError') return; }
        } else if ('showSaveFilePicker' in window && fileHandleRef.current) {
            try { const w = await fileHandleRef.current.createWritable(); await w.write(json); await w.close(); return; } catch (e) {
                // The handle stopped working. The download below still saves the work, but it
                // goes to the downloads folder rather than over the file the user chose, so
                // silence here would read as a successful overwrite.
                fileHandleRef.current = null;
                setToast(tr('저장한 파일에 쓸 수 없어 다운로드로 저장합니다'));
            }
        }
        downloadBlob(new Blob([json], { type: 'application/json' }), 'project.emv');
    };

    // A large .emv looks frozen during the read and parse alone, so that stretch shows just a
    // label with an indeterminate bar (total 0); restore then takes over with real progress.
    const readAndRestore = async (getText) => {
        setLoadProgress({ label: tr('파일 읽는 중'), done: 0, total: 0 });
        try {
            const text = await getText();
            setLoadProgress({ label: tr('파일 분석 중'), done: 0, total: 0 });
            await new Promise(r => setTimeout(r, 0)); // give the bar a chance to paint once
            const data = JSON.parse(text);
            return await restore(data);
        } catch (err) {
            setLoadProgress(null);
            alert(tr('파일 오류: ') + err.message);
            return false;
        }
    };

    const doOpen = async () => {
        if ('showOpenFilePicker' in window) {
            try {
                const [h] = await window.showOpenFilePicker({ types: [{ description: 'Easy MV Project', accept: { 'application/json': ['.emv'] } }] });
                // Only after the file is actually open. Set first, the handle pointed at a file
                // that had not been loaded - and the next save would write whatever is on screen
                // over it.
                if (await readAndRestore(async () => (await h.getFile()).text())) fileHandleRef.current = h;
                return;
            } catch (e) { if (e.name === 'AbortError') return; }
        }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.emv';
        inp.onchange = e => {
            const f = /** @type {HTMLInputElement} */ (e.target).files[0]; if (!f) return;
            readAndRestore(() => new Promise((res, rej) => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.onerror = rej; r.readAsText(f); }));
        };
        inp.click();
    };

    const doNew = () => {
        if (!window.confirm(tr('새 프로젝트? 저장되지 않은 내용은 사라집니다.'))) return;
        resetToEmpty();
    };

    // --- IndexedDB projects ------------------------------------------------------------------
    const doLocalSave = async (forceNew = false) => {
        try {
            const data = await buildData(true, null, true); // IndexedDB stores frame Blobs directly
            if (!forceNew && localIdRef.current) { await saveProject(localIdRef.current, data, localNameRef.current || 'Untitled'); alert(tr('로컬에 저장했습니다.')); return; }
            const name = window.prompt(tr('로컬 저장 이름:'), localNameRef.current || 'MV Project');
            if (!name) return;
            const id = randomId('l_');
            await saveProject(id, data, name);
            localIdRef.current = id; localNameRef.current = name;
            alert(tr('로컬에 저장했습니다.'));
        } catch (e) { alert(tr('로컬 저장 실패: ') + e.message); }
    };

    const openLocalList = async () => {
        try { setLocalProjects((await listProjects()).filter(p => p.id !== autosaveKey)); }
        catch (e) { alert(tr('로컬 목록 실패: ') + e.message); }
    };

    const doLocalOpen = async (id, name) => {
        try {
            const data = await loadProject(id);
            if (!data) { alert(tr('데이터가 없습니다.')); return; }
            // As in doServerOpen: the identity is only ours once the document is actually in.
            if (!await restore(data)) return;
            localIdRef.current = id; localNameRef.current = name || ''; setLocalProjects(null);
        }
        catch (e) { alert(tr('로컬 열기 실패: ') + e.message); }
    };

    const doLocalDelete = async (id) => {
        if (!window.confirm(tr('이 로컬 프로젝트를 삭제할까요?'))) return;
        try { await deleteProject(id); if (localIdRef.current === id) { localIdRef.current = null; localNameRef.current = ''; } openLocalList(); }
        catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };

    // --- Tabs (multiple projects open at once, Clip Studio / SAI style) -----------------------
    // Each tab keeps a full in-memory document snapshot (buildData with Blobs, so no base64 cost).
    // Switching = snapshot the current tab, then restore the target's snapshot.
    const snapshotActiveTab = async () => {
        // A failure here is not cosmetic: the snapshot is the only copy of this tab's work once we
        // switch away from it, so the caller must not switch.
        tabDocsRef.current[activeTabId] = await buildData(true, null, true);
    };

    const switchTab = async (id) => {
        if (id === activeTabId || tabBusyRef.current) return;
        tabBusyRef.current = true;
        try {
            try { await snapshotActiveTab(); }
            catch (e) { setAppError(tr('현재 탭을 저장할 수 없어 탭을 바꾸지 않았습니다: ') + (e?.message || String(e))); return; }
            setActiveTabId(id);
            const doc = tabDocsRef.current[id];
            if (doc) await restore(doc); else resetToEmpty();
        } finally { tabBusyRef.current = false; }
    };

    const newTab = async () => {
        if (tabBusyRef.current) return; tabBusyRef.current = true;
        try {
            // Same reasoning as switchTab: opening a new tab means leaving this one, and leaving
            // it without a snapshot loses it.
            try { await snapshotActiveTab(); }
            catch (e) { setAppError(tr('현재 탭을 저장할 수 없어 새 탭을 열지 않았습니다: ') + (e?.message || String(e))); return; }
            const id = 't' + nextId().toString(36);
            setTabs(p => [...p, { id, name: tr('프로젝트 ') + (p.length + 1) }]);
            tabDocsRef.current[id] = null;
            setActiveTabId(id);
            resetToEmpty();
        } finally { tabBusyRef.current = false; }
    };

    /** Rename a tab. Asking for the name is the caller's business; this only records it. */
    const renameTab = (id, name) => setTabs(p => p.map(t => (t.id === id ? { ...t, name: name || t.name } : t)));

    const closeTab = async (id) => {
        if (tabs.length <= 1) { if (window.confirm(tr('마지막 탭입니다. 내용을 비울까요?'))) { resetToEmpty(); tabDocsRef.current[id] = null; } return; }
        if (!window.confirm(tr('이 탭을 닫을까요? 저장하지 않은 내용은 사라집니다.'))) return;
        delete tabDocsRef.current[id];
        const rest = tabs.filter(t => t.id !== id);
        setTabs(rest);
        if (id === activeTabId) {
            const target = rest[rest.length - 1];
            setActiveTabId(target.id);
            const doc = tabDocsRef.current[target.id];
            if (doc) await restore(doc); else resetToEmpty();
        }
    };

    // --- Crash recovery and the storage budget ------------------------------------------------
    // Offer the last autosave on first load. Deliberately a question rather than automatic: the
    // autosave may be older than what the user meant to open.
    useEffect(() => {
        let cancelled = false;
        loadAutosave().then(data => {
            if (cancelled || !data || !Array.isArray(data.cuts)) return;
            const meaningful = data.cuts.length > 1 || data.cuts.some(c =>
                safeArray(c.layers).some(l => safeArray(l.strokes).length) || safeArray(c.texts).length);
            if (!meaningful) return;
            const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : '';
            if (window.confirm(tr('이전에 자동저장된 작업이 있습니다{0}.\n복구할까요?', when ? ` (${when})` : ''))) {
                restore(data);
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
        doSave, doOpen, doNew, readAndRestore,
        localProjects, setLocalProjects, localIdRef, localNameRef,
        doLocalSave, openLocalList, doLocalOpen, doLocalDelete,
        tabs, activeTabId, switchTab, newTab, closeTab, renameTab,
        storageInfo, didRecoverRef,
    };
}
