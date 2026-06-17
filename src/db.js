// Minimal IndexedDB wrapper (no deps) used for local autosave / crash recovery.
// A project record is the same JSON shape produced by App's buildData(), so it
// round-trips through the existing restore() path unchanged.

const DB_NAME = 'easymv';
const DB_VERSION = 1;
const STORE = 'projects';
const AUTOSAVE_ID = 'autosave';

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
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

function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveProject(id, data, name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, 'readwrite').put({ id, name: name ?? data?.name ?? id, savedAt: data?.savedAt ?? new Date().toISOString(), data });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function loadProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, 'readonly').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => reject(req.error);
    });
}

export async function listProjects() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, 'readonly').getAll();
        req.onsuccess = () => resolve((req.result || []).map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt })));
        req.onerror = () => reject(req.error);
    });
}

export async function deleteProject(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, 'readwrite').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export const autosaveKey = AUTOSAVE_ID;
export const saveAutosave = (data) => saveProject(AUTOSAVE_ID, data, '(자동저장)');
export const loadAutosave = () => loadProject(AUTOSAVE_ID);
