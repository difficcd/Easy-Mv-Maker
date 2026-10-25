import { tr } from './i18n.ts';
import { normFolder, movePath, removedPath, inFolder, withAncestors } from './core/projectFolders.ts';
// Minimal IndexedDB wrapper (no deps) used for local autosave / crash recovery.
// A project record is the same JSON shape produced by App's buildData(), so it
// round-trips through the existing restore() path unchanged.

const DB_NAME = 'easymv';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTOSAVE_ID = 'autosave';
/**
 * The folder list, kept as a record of its own so an empty folder survives. Not a project: the
 * listing leaves it out. A project's folder is a path on its record ("" the top), as on the server.
 */
const FOLDERS_ID = '__folders__';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

/**
 * Run one request in one transaction, and settle when the transaction does.
 *
 * The four operations below were four copies of the same six lines, and all four resolved on
 * `request.onsuccess`. That is early. A request succeeding means the store accepted it; the
 * transaction still has to commit, and a commit can fail afterwards - running out of quota is
 * the one that actually happens here, because an autosave carries the whole project, frames and
 * audio included. Resolving on the request meant a save that never landed was reported as saved,
 * and the autosave error the UI already knows how to show could not fire.
 *
 * `map` runs while the result is still valid, and its value is held until the commit.
 *
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} make
 * @param {(result: any) => T} [map]
 * @returns {Promise<T>}
 */
async function run<T = void>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest, map?: (result: any) => T): Promise<T> {
    const db = await openDB();
    return new Promise<T>((resolve, reject) => {
        let t: IDBTransaction;
        try { t = db.transaction(STORE, mode); } catch (e) { reject(e); return; }
        let value: any = undefined;
        let failed = false;
        const fail = (e: unknown) => { if (!failed) { failed = true; reject(e instanceof Error ? e : new Error(String(e || 'IndexedDB failed'))); } };
        let req: IDBRequest;
        try { req = make(t.objectStore(STORE)); } catch (e) { fail(e); return; }
        req.onsuccess = () => { try { value = map ? map(req.result) : undefined; } catch (e) { fail(e); } };
        req.onerror = () => fail(req.error);
        t.oncomplete = () => { if (!failed) resolve(value); };
        t.onabort = () => fail(t.error || new Error('IndexedDB transaction aborted'));
        t.onerror = () => fail(t.error);
    });
}

/**
 * Change records in one read-write transaction: `change` sees each record the cursor visits and
 * returns the record to write back, or null to leave it. Settles on the commit, as `run` does.
 * With `id`, only that record is visited (undefined when there is none).
 */
async function editRecords(change: (rec: any) => any | null, id?: string): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        let t: IDBTransaction;
        try { t = db.transaction(STORE, 'readwrite'); } catch (e) { reject(e); return; }
        const store = t.objectStore(STORE);
        let failed = false;
        const fail = (e: unknown) => { if (!failed) { failed = true; reject(e instanceof Error ? e : new Error(String(e || 'IndexedDB failed'))); } };
        if (id !== undefined) {
            const get = store.get(id);
            get.onsuccess = () => { try { const next = change(get.result); if (next) store.put(next); } catch (e) { fail(e); t.abort(); } };
        } else {
            const cur = store.openCursor();
            cur.onsuccess = () => {
                const c = cur.result; if (!c) return;
                try { const next = change(c.value); if (next) c.update(next); } catch (e) { fail(e); t.abort(); return; }
                c.continue();
            };
        }
        t.oncomplete = () => { if (!failed) resolve(); };
        t.onabort = () => fail(t.error || new Error('IndexedDB transaction aborted'));
        t.onerror = () => fail(t.error);
    });
}

/**
 * Save a project, in one write that settles on the commit.
 *
 * `extra.folder` and `extra.thumb` set where it is filed and its preview. With `keep`, whichever
 * of the two is not given is read from the record already there first - saving again must not
 * move a project back to the top or drop its preview. The autosave passes nothing and reads
 * nothing: reading the stored record means reading the whole project, on every autosave.
 */
export async function saveProject(id: string, data: any, name?: string, extra: { folder?: string, thumb?: Blob | null, keep?: boolean } = {}): Promise<void> {
    let { folder, thumb } = extra;
    if (extra.keep && (folder === undefined || thumb === undefined)) {
        const prev = await run('readonly', (store) => store.get(id), (r) => r);
        if (folder === undefined) folder = prev?.folder;
        if (thumb === undefined) thumb = prev?.thumb ?? null;
    }
    return run('readwrite', (store) => store.put({
        id,
        name: name ?? data?.name ?? id,
        savedAt: data?.savedAt ?? new Date().toISOString(),
        folder: normFolder(folder ?? ''),
        thumb: thumb ?? null,
        data,
    }));
}

/** Rename a project, move it, or give it a preview; the drawing and its saved time are untouched. */
export function patchProject(id: string, patch: { name?: string, folder?: string, thumb?: Blob | null }): Promise<void> {
    return editRecords(prev => prev && ({
        ...prev,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.folder !== undefined ? { folder: normFolder(patch.folder) } : {}),
        ...(patch.thumb !== undefined ? { thumb: patch.thumb } : {}),
    }), id);
}

export function loadProject(id: string): Promise<any> {
    return run('readonly', (store) => store.get(id), (r) => (r ? r.data : null));
}

/** A stored project as a list shows it. */
export interface LocalProjectRow { id: string; name: string; savedAt: string; folder: string; thumb: Blob | null }

export function listProjects(): Promise<LocalProjectRow[]> {
    return run('readonly', (store) => store.getAll(),
        (rows: any[]) => (rows || []).filter(r => r.id !== FOLDERS_ID)
            .map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt, folder: normFolder(r.folder), thumb: r.thumb instanceof Blob ? r.thumb : null })));
}

/** Every folder: the ones created, the ones a project is in, and the folders above them. */
export async function listFolders(): Promise<string[]> {
    const rec = await run('readonly', (store) => store.get(FOLDERS_ID), (r) => r);
    const projects = await listProjects();
    return withAncestors([...(rec?.folders || []), ...projects.map(p => p.folder)]);
}

/** Make a folder (empty, until something is saved or moved into it). */
export function addFolder(path: string): Promise<void> {
    const p = normFolder(path);
    return editRecords(prev => ({ id: FOLDERS_ID, folders: withAncestors([...(prev?.folders || []), p]) }), FOLDERS_ID);
}

/**
 * Rename or move a folder (`to` given), or remove it (`to` null): every project and listed folder
 * at or under it follows, in one transaction. Removing moves what was inside up a level; no
 * project is ever deleted here.
 */
export function moveFolder(from: string, to: string | null): Promise<void> {
    const f = normFolder(from), dest = to === null ? null : normFolder(to);
    const where = (path: string) => (dest === null ? removedPath(path, f) : movePath(path, f, dest));
    return editRecords(rec => {
        if (rec.id === FOLDERS_ID) {
            const kept = (rec.folders || []).filter((x: string) => dest !== null || x !== f).map(where);
            return { ...rec, folders: withAncestors(kept) };
        }
        const folder = normFolder(rec.folder);
        return folder && inFolder(folder, f) ? { ...rec, folder: where(folder) } : null;
    });
}

/** @returns {Promise<void>} */
export function deleteProject(id: string): Promise<void> {
    return run('readwrite', (store) => store.delete(id));
}

export const autosaveKey = AUTOSAVE_ID;
export const saveAutosave = (data: any) => saveProject(AUTOSAVE_ID, data, tr('(자동저장)'));
export const loadAutosave = () => loadProject(AUTOSAVE_ID);
