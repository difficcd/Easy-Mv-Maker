import { tr } from './i18n.ts';
// Minimal IndexedDB wrapper (no deps) used for local autosave / crash recovery.
// A project record is the same JSON shape produced by App's buildData(), so it
// round-trips through the existing restore() path unchanged.

const DB_NAME = 'easymv';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTOSAVE_ID = 'autosave';

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

/** @returns {Promise<void>} */
export function saveProject(id: string, data: any, name?: string): Promise<void> {
    return run('readwrite', (store) => store.put({
        id,
        name: name ?? data?.name ?? id,
        savedAt: data?.savedAt ?? new Date().toISOString(),
        data,
    }));
}

export function loadProject(id: string): Promise<any> {
    return run('readonly', (store) => store.get(id), (r) => (r ? r.data : null));
}

export function listProjects(): Promise<Array<{ id: string, name: string, savedAt: string }>> {
    return run('readonly', (store) => store.getAll(),
        (rows: any[]) => (rows || []).map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt })));
}

/** @returns {Promise<void>} */
export function deleteProject(id: string): Promise<void> {
    return run('readwrite', (store) => store.delete(id));
}

export const autosaveKey = AUTOSAVE_ID;
export const saveAutosave = (data: any) => saveProject(AUTOSAVE_ID, data, tr('(자동저장)'));
export const loadAutosave = () => loadProject(AUTOSAVE_ID);
