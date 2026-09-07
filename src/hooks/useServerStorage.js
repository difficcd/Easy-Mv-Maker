// Keeping projects on the local API server, and the rotating backups of them.
//
// Two related jobs that were spread through App:
//
//   Save / Open / Delete   a project the user names, on the server, with its frames and audio
//                          stored beside it as separate binary assets rather than base64
//   Backups                a snapshot every five minutes, kept as timestamped files and rotated,
//                          so a lost browser profile or an overwritten project is recoverable
//
// They belong together because they share an identity - a project saved to the server backs up
// under its own id, and an unsaved one backs up under a key of its own - and because both go
// through the same asset upload.
//
// What stays in App, and why: buildData and restore. Building a document reads most of App's
// state, and restoring one writes most of it. Threading either of those in here would mean
// threading in everything they touch, and the seam would be wider than the thing it separates.
// They arrive as two functions instead, which is the whole of what this needs from the document.
//
// The 200-odd lines this holds do not touch cuts, layers, strokes, the canvas or the timeline.
// That is what made it the first thing worth cutting out of App: not that it was the biggest,
// but that the cut was the narrowest.

import { useState, useRef, useEffect } from 'react';
import { apiFetch, putAsset } from '../core/api.js';
import { readStored, writeStored } from '../core/persist.js';
import { randomId } from '../core/ids.js';
import { safeArray } from '../canvas/canvasUtils.js';
import { tr } from '../i18n.js';

/** How often the automatic backup wakes up. */
const BACKUP_EVERY_MS = 5 * 60 * 1000;

/**
 * @param {object} opts
 * @param {boolean} opts.serverAvailable whether the API answered its probe
 * @param {(includeAudio?: boolean, assetSink?: any[], blobsOk?: boolean) => Promise<any>} opts.buildData
 * @param {(data: any, assetBase?: string|null) => Promise<boolean>} opts.restore false if the
 *   document did not go in, in which case the caller must not record the project's identity
 * @param {(p: any) => void} opts.setLoadProgress
 * @param {(m: string) => void} opts.setAppError
 * @param {(m: string) => void} opts.setToast
 * @param {{current: any}} opts.liveRef the newest document, read without re-running the timer
 * @param {{current: string}} opts.localNameRef a name to fall back on for an unnamed backup
 */
export function useServerStorage({
    serverAvailable, buildData, restore,
    setLoadProgress, setAppError, setToast,
    liveRef, localNameRef,
}) {
    const [serverProjects, setServerProjects] = useState(/** @type {any} */(null)); // null = picker closed
    const [backupAt, setBackupAt] = useState(/** @type {number|null} */(null));
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupList, setBackupList] = useState(/** @type {any} */(null));        // null = list closed
    const [backupProg, setBackupProg] = useState(/** @type {any} */(null));

    const serverIdRef = useRef(/** @type {string|null} */(null));
    const serverNameRef = useRef('');
    const backupKeyRef = useRef(/** @type {string|null} */(null));
    const backupBusyRef = useRef(false);
    const lastBackupSigRef = useRef('');

    /** Forget which server project is open, so the next save asks for a name. */
    const forgetProject = () => { serverIdRef.current = null; serverNameRef.current = ''; };

    // Upload externalized frame assets one at a time (binary, no base64) so peak memory is a
    // single frame — this is what keeps big/original-quality projects from OOMing on save.
    const uploadAssets = async (id, assetSink) => {
        const total = assetSink.length;
        for (let i = 0; i < total; i++) {
            await putAsset(`/api/projects/${id}`, assetSink[i], tr('프레임 업로드 실패 ({0}/{1})', i + 1, total));
            if (total > 12) setLoadProgress({ label: tr('서버에 올리는 중'), done: i + 1, total });
        }
    };

    const doServerSave = async (forceNew = false) => {
        try {
            const assetSink = [];
            const data = await buildData(true, assetSink); // frames/audio externalized → small JSON
            let id = (!forceNew && serverIdRef.current) ? serverIdRef.current : null;
            let name = serverNameRef.current || 'Untitled';
            if (!id) {
                name = window.prompt(tr('서버에 저장할 프로젝트 이름:'), serverNameRef.current || 'MV Project');
                if (!name) return;
                // Create the record first (just to get an id); the real data is committed LAST.
                const r = await apiFetch('/api/projects', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, data: { appName: 'EasyMVMaker', pending: true } }),
                });
                id = r.id; serverIdRef.current = r.id; serverNameRef.current = r.name;
            }
            // Upload assets BEFORE writing the manifest, so an interrupted save never leaves the
            // project JSON pointing at frames/audio that aren't on disk (which caused 404s + blanks).
            if (assetSink.length) await uploadAssets(id, assetSink);
            await apiFetch(`/api/projects/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data }),
            });
            alert(tr('서버에 저장했습니다.'));
        } catch (e) {
            console.error('[import]', e);
            setAppError(tr('서버 저장 실패: ') + e.message + '\n' + tr('(API 서버가 실행 중인지 확인하세요. 큰 프로젝트는 저장에 시간이 걸립니다.)'));
        } finally { setLoadProgress(null); }
    };

    const openServerList = async () => {
        try { setServerProjects(await apiFetch('/api/projects')); }
        catch (e) { alert(tr('서버 목록을 불러오지 못했습니다: ') + e.message + '\n' + tr('(API 서버 실행 확인: npm run dev)')); }
    };

    const doServerOpen = async (id, name) => {
        try {
            const data = await apiFetch(`/api/projects/${id}`);
            // Only claim the identity if the document actually went in - otherwise the next save
            // would write this project's id over whatever is really on screen.
            if (!await restore(data, `/api/projects/${id}`)) return; // assets come from this project
            serverIdRef.current = id; serverNameRef.current = name || '';
            setServerProjects(null);
        } catch (e) { alert(tr('서버에서 열기 실패: ') + e.message); }
    };

    const doServerDelete = async (id) => {
        if (!window.confirm(tr('이 프로젝트를 서버에서 삭제할까요?'))) return;
        try {
            await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (serverIdRef.current === id) forgetProject();
            openServerList();
        } catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };

    // --- Rotating server backups of the autosave (a safety net separate from Save) ---------
    // The local IndexedDB autosave protects against a crash/refresh; this protects against the
    // browser profile itself being lost or a project being overwritten. Snapshots are kept as
    // separate timestamped files server-side and rotated, so you can roll back.
    const getBackupKey = () => {
        if (serverIdRef.current) return serverIdRef.current; // group under the server project if there is one
        if (!backupKeyRef.current) {
            let k = readStored('mv_backup_key', '');
            if (!k) {
                k = randomId('bk_');
                writeStored('mv_backup_key', k);
            }
            backupKeyRef.current = k;
        }
        return backupKeyRef.current;
    };

    // Skip frames the server already has — otherwise every backup of a video project would
    // re-upload hundreds of MB. Assets are keyed by bitmapId, so presence means identical.
    const uploadAssetsDeduped = async (key, assetSink, onProgress) => {
        let have = new Set();
        try { have = new Set((await apiFetch(`/api/projects/${key}/assets`)).map(String)); } catch { }
        const todo = assetSink.filter(a => !have.has(String(a.id)));
        for (let i = 0; i < todo.length; i++) {
            await putAsset(`/api/projects/${key}`, todo[i], tr('에셋 업로드 실패 ({0}/{1})', i + 1, todo.length));
            setBackupProg({ done: i + 1, total: todo.length });
            onProgress?.(i + 1, todo.length);
        }
        return todo.length;
    };

    // The automatic backup runs itself every five minutes, so it must never block the screen.
    // It used to raise a full-screen progress overlay, which stopped all work while it ran.
    const doServerBackup = async (silent = true) => {
        if (!serverAvailable || backupBusyRef.current) return;
        backupBusyRef.current = true; setBackupBusy(true); setBackupProg(null);
        try {
            const key = getBackupKey();
            const assetSink = [];
            const data = await buildData(true, assetSink); // frames and audio go out as separate assets, keeping the JSON small
            if (assetSink.length) await uploadAssetsDeduped(key, assetSink);
            await apiFetch(`/api/backups/${key}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: serverNameRef.current || localNameRef.current || tr('자동 백업'), data }),
            });
            setBackupAt(Date.now());
            if (!silent) setToast(tr('서버에 백업했습니다.'));
        } catch (e) {
            if (!silent) setAppError(tr('서버 백업 실패: ') + e.message);
        } finally { backupBusyRef.current = false; setBackupBusy(false); setBackupProg(null); }
    };

    const openBackupList = async () => {
        try { setBackupList(await apiFetch(`/api/backups/${getBackupKey()}`)); }
        catch (e) { alert(tr('백업 목록을 불러오지 못했습니다: ') + e.message); }
    };

    const doBackupRestore = async (stamp) => {
        if (!window.confirm(tr('이 백업으로 되돌릴까요? 현재 작업 내용은 사라집니다.'))) return;
        try {
            const key = getBackupKey();
            const data = await apiFetch(`/api/backups/${key}/${stamp}`);
            if (!await restore(data, `/api/projects/${key}`)) return; // assets come from the same key
            setBackupList(null);
        } catch (e) { alert(tr('백업 복구 실패: ') + e.message); }
    };

    const doBackupDelete = async (stamp) => {
        if (!window.confirm(tr('이 백업을 삭제할까요?'))) return;
        try { await apiFetch(`/api/backups/${getBackupKey()}/${stamp}`, { method: 'DELETE' }); openBackupList(); }
        catch (e) { alert(tr('삭제 실패: ') + e.message); }
    };

    // Periodic backup. Reads the newest state through a ref: putting `cuts` in the deps would
    // restart the timer on every stroke, so it would never actually fire while you draw.
    const backupFnRef = useRef(/** @type {typeof doServerBackup|null} */(null));
    backupFnRef.current = doServerBackup;
    useEffect(() => {
        if (!serverAvailable) return;
        const id = setInterval(() => {
            const cs = liveRef.current?.cuts || [];
            const sig = cs.length + ':' + cs.map(c => safeArray(c.layers).reduce((n, l) => n + safeArray(l.strokes).length, 0)).join(',');
            if (sig === lastBackupSigRef.current) return; // nothing changed, so skip
            lastBackupSigRef.current = sig;
            backupFnRef.current?.(true);
        }, BACKUP_EVERY_MS);
        return () => clearInterval(id);
    }, [serverAvailable, liveRef]);

    return {
        serverProjects, setServerProjects,
        backupAt, backupBusy, backupList, setBackupList, backupProg,
        serverIdRef, serverNameRef, forgetProject,
        doServerSave, openServerList, doServerOpen, doServerDelete,
        doServerBackup, openBackupList, doBackupRestore, doBackupDelete,
    };
}
