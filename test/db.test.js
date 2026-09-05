import test from 'node:test';
import assert from 'node:assert/strict';

// A fake IndexedDB, just enough of it to answer the question this change is about: does a save
// resolve before the transaction has committed? A real request fires onsuccess as soon as the
// store accepts the write, and the transaction commits afterwards - and can still abort, which
// is what running out of quota looks like. The fake reproduces exactly that ordering.

const control = {
    /** 'commit' | 'abort' | 'requestError' */
    outcome: 'commit',
    abortError: null,
    log: [],
};

const soon = (fn) => setTimeout(fn, 0);

function makeFakeIndexedDB() {
    const rows = new Map();
    const store = {
        put(record) {
            const req = {};
            soon(() => {
                if (control.outcome === 'requestError') {
                    req.error = new Error('put rejected');
                    req.onerror?.();
                    return;
                }
                // The store accepts it and says so - before any commit has happened.
                if (control.outcome === 'commit') rows.set(record.id, record);
                control.log.push('request success');
                req.onsuccess?.();
            });
            return req;
        },
        get(id) {
            const req = {};
            soon(() => { req.result = rows.get(id); req.onsuccess?.(); });
            return req;
        },
        getAll() {
            const req = {};
            soon(() => { req.result = [...rows.values()]; req.onsuccess?.(); });
            return req;
        },
        delete(id) {
            const req = {};
            soon(() => { rows.delete(id); req.onsuccess?.(); });
            return req;
        },
    };
    return {
        open() {
            const req = {};
            soon(() => {
                req.result = {
                    objectStoreNames: { contains: () => true },
                    createObjectStore: () => store,
                    transaction() {
                        const t = { error: null, objectStore: () => store };
                        // Two ticks later than the request, as a real commit is.
                        soon(() => soon(() => {
                            if (control.outcome === 'abort') {
                                t.error = control.abortError;
                                control.log.push('transaction abort');
                                t.onabort?.();
                            } else if (control.outcome === 'commit') {
                                control.log.push('transaction complete');
                                t.oncomplete?.();
                            } else {
                                t.onabort?.();
                            }
                        }));
                        return t;
                    },
                };
                req.onsuccess?.();
            });
            return req;
        },
    };
}

globalThis.indexedDB = makeFakeIndexedDB();
const { saveProject, loadProject, listProjects, deleteProject } = await import('../src/db.js');

test('a save resolves only once the transaction has committed', async () => {
    control.outcome = 'commit';
    control.log = [];
    await saveProject('p1', { savedAt: '2026-01-01T00:00:00.000Z' }, 'One');
    assert.deepEqual(control.log, ['request success', 'transaction complete'],
        'resolving on the request would have returned before the commit');
});

// The bug: put fires onsuccess, the promise resolved, and then the commit failed with no one
// listening. A quota failure on an autosave was reported to the app as a successful save.
test('a transaction that aborts after the request succeeded is a rejection', async () => {
    control.outcome = 'abort';
    control.abortError = new Error('QuotaExceededError');
    control.log = [];
    await assert.rejects(
        () => saveProject('p2', {}, 'Two'),
        /QuotaExceededError/,
        'the save did not land, so it must not report success',
    );
    assert.deepEqual(control.log, ['request success', 'transaction abort'],
        'the request really did succeed first - this is the ordering that hid the failure');
});

test('an abort with no error of its own still rejects rather than hanging', async () => {
    control.outcome = 'abort';
    control.abortError = null;
    await assert.rejects(() => saveProject('p3', {}, 'Three'), /aborted/);
});

test('a request-level failure still rejects', async () => {
    control.outcome = 'requestError';
    await assert.rejects(() => saveProject('p4', {}, 'Four'), /put rejected/);
});

test('a committed save is what comes back, and the shape is unchanged', async () => {
    control.outcome = 'commit';
    await saveProject('p5', { cuts: [1, 2, 3], savedAt: 'then' }, 'Five');
    assert.deepEqual(await loadProject('p5'), { cuts: [1, 2, 3], savedAt: 'then' });
    assert.equal(await loadProject('nothing-here'), null, 'a missing project is null, not undefined');
    const rows = await listProjects();
    const five = rows.find(r => r.id === 'p5');
    assert.deepEqual(five, { id: 'p5', name: 'Five', savedAt: 'then' });
    assert.ok(!('data' in five), 'the list carries metadata only - it must not pull whole projects into memory');
});

test('the name and timestamp fall back the way they did', async () => {
    control.outcome = 'commit';
    await saveProject('p6', { name: 'from the data' });
    assert.equal((await listProjects()).find(r => r.id === 'p6').name, 'from the data');
    await saveProject('p7', null);
    const seven = (await listProjects()).find(r => r.id === 'p7');
    assert.equal(seven.name, 'p7', 'with nothing to go on, the id is the name');
    assert.ok(Date.parse(seven.savedAt) > 0, 'and the time is now');
});

test('delete goes through the same commit wait', async () => {
    control.outcome = 'commit';
    await saveProject('p8', { cuts: [] }, 'Eight');
    await deleteProject('p8');
    assert.equal(await loadProject('p8'), null);
    control.outcome = 'abort';
    control.abortError = new Error('nope');
    await assert.rejects(() => deleteProject('p8'), /nope/);
});
