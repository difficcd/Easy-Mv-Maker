import test from 'node:test';
import assert from 'node:assert/strict';

// The browser storage's folders, previews and renames (db.ts), against a fake IndexedDB that
// commits a transaction once its last request has settled - as a real one does - and walks a
// cursor. db.test.js has its own fake, built to pin the order of request and commit; this one is
// built so a read-then-write in one transaction and a cursor pass behave as they would in Chrome.

const rows = new Map();
const soon = (fn) => setTimeout(fn, 0);

function transaction() {
    const t = { error: null, pending: 0, done: false };
    const settle = () => soon(() => { if (!t.done && t.pending === 0) { t.done = true; t.oncomplete?.(); } });
    /** A request that settles on the next tick; its handler runs before the count drops, so a request it makes keeps the transaction open. */
    const request = (work) => {
        const req = {};
        t.pending++;
        soon(() => { req.result = work(); req.onsuccess?.(); t.pending--; settle(); });
        return req;
    };
    const store = {
        put: (r) => request(() => { rows.set(r.id, structuredClone(r)); return r.id; }),
        get: (id) => request(() => (rows.has(id) ? structuredClone(rows.get(id)) : undefined)),
        getAll: () => request(() => [...rows.values()].map(r => structuredClone(r))),
        delete: (id) => request(() => { rows.delete(id); }),
        openCursor() {
            const keys = [...rows.keys()];
            let i = 0;
            const req = {};
            const step = () => {
                t.pending++;
                soon(() => {
                    const key = keys[i];
                    req.result = key === undefined ? null : {
                        value: structuredClone(rows.get(key)),
                        update: (v) => store.put(v),
                        continue: () => { i++; step(); },
                    };
                    req.onsuccess?.();
                    t.pending--; settle();
                });
            };
            step();
            return req;
        },
    };
    t.objectStore = () => store;
    t.abort = () => { t.done = true; t.onabort?.(); };
    return t;
}

globalThis.indexedDB = {
    open() {
        const req = {};
        soon(() => { req.result = { objectStoreNames: { contains: () => true }, transaction }; req.onsuccess?.(); });
        return req;
    },
};
const { saveProject, patchProject, listProjects, listFolders, addFolder, moveFolder, loadProject } = await import('../../src/db.ts');

const byName = async () => Object.fromEntries((await listProjects()).map(r => [r.name, r]));
const reset = () => rows.clear();

test('a new project goes in the folder it is saved into, with its preview', async () => {
    reset();
    const thumb = new Blob(['img'], { type: 'image/webp' });
    await saveProject('a', { cuts: [] }, 'A', { folder: 'Songs / Chorus', thumb });
    const a = (await byName()).A;
    assert.equal(a.folder, 'Songs/Chorus');
    assert.ok(a.thumb instanceof Blob);
});

test('saving again with keep stays in the folder and keeps the preview', async () => {
    reset();
    await saveProject('a', { cuts: [] }, 'A', { folder: 'Box', thumb: new Blob(['x']) });
    await saveProject('a', { cuts: [1] }, 'A', { keep: true });
    const a = (await byName()).A;
    assert.equal(a.folder, 'Box');
    assert.ok(a.thumb instanceof Blob);
    assert.deepEqual(await loadProject('a'), { cuts: [1] });
});

test('rename and move change only what they say', async () => {
    reset();
    await saveProject('a', { cuts: [7], savedAt: 'then' }, 'Old', { folder: 'X' });
    await patchProject('a', { name: 'New' });
    await patchProject('a', { folder: 'Y/Z' });
    const a = (await byName()).New;
    assert.equal(a.folder, 'Y/Z');
    assert.equal(a.savedAt, 'then');
    assert.deepEqual(await loadProject('a'), { cuts: [7], savedAt: 'then' });
    await patchProject('nobody', { name: 'ghost' });   // a missing record is left missing
    assert.equal((await listProjects()).length, 1);
});

test('folders nest, include the ones projects name, and are not listed as projects', async () => {
    reset();
    await saveProject('a', {}, 'A', { folder: 'Top/Mid' });
    await addFolder('Top/Empty');
    assert.deepEqual(await listFolders(), ['Top', 'Top/Empty', 'Top/Mid']);
    assert.deepEqual((await listProjects()).map(r => r.name), ['A'], 'the folder list is not a project');
});

test('renaming a folder carries its projects and subfolders with it', async () => {
    reset();
    await saveProject('a', {}, 'A', { folder: 'Top/Mid/Low' });
    await saveProject('b', {}, 'B', { folder: 'Topper' });
    await addFolder('Top/Mid/Empty');
    await moveFolder('Top/Mid', 'Renamed');
    const p = await byName();
    assert.equal(p.A.folder, 'Renamed/Low');
    assert.equal(p.B.folder, 'Topper', 'a folder whose name merely starts the same is not inside');
    const f = await listFolders();
    assert.ok(f.includes('Renamed/Empty') && !f.some(x => x.startsWith('Top/Mid')), f.join(','));
});

test('removing a folder deletes no project: what was inside moves up a level', async () => {
    reset();
    await saveProject('a', {}, 'A', { folder: 'Box/Lid' });
    await saveProject('b', {}, 'B', { folder: 'Box' });
    await moveFolder('Box', null);
    const p = await byName();
    assert.equal(p.A.folder, 'Lid');
    assert.equal(p.B.folder, '');
    assert.ok(!(await listFolders()).includes('Box'));
});
