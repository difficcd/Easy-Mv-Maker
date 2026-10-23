import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// The routes run against a temporary data directory. MV_DATA_DIR is read when paths.js loads,
// so it is set before anything from server/ is imported.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-data-'));
process.env.MV_DATA_DIR = dir;
const { normFolder, movePath, removedPath, withAncestors, isInside } = await import('../../server/folders.js');
const { projectRoutes } = await import('../../server/projects.js');

const app = express();
app.use(express.json());
projectRoutes(app);
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }); });

const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
};
const save = async (name, folder) => (await call('POST', '/api/projects', { name, folder, data: { appName: 'EasyMVMaker', cuts: [] } })).body.id;
const listed = async () => Object.fromEntries((await call('GET', '/api/projects')).body.map(p => [p.name, p]));

test('a folder path is cleaned, never refused', () => {
    assert.equal(normFolder(' Songs / Chorus '), 'Songs/Chorus');
    assert.equal(normFolder('../a//b/./'), 'a/b');
    assert.equal(normFolder('a<b>:c'), 'abc');
    assert.equal(normFolder(undefined), '');
});

test('moving and removing a folder carries everything under it', () => {
    assert.equal(movePath('a/b/c', 'a/b', 'x'), 'x/c');
    assert.equal(movePath('a/bc', 'a/b', 'x'), 'a/bc', 'a sibling with a longer name is not inside');
    assert.equal(removedPath('a/b', 'a/b'), 'a');
    assert.equal(removedPath('a/b/c', 'a/b'), 'a/c');
    assert.equal(removedPath('a/c', 'a'), 'c');
    assert.deepEqual(withAncestors(['a/b/c']), ['a', 'a/b', 'a/b/c']);
    assert.ok(isInside('a/b', 'a') && !isInside('ab', 'a'));
});

test('rename changes the name and nothing else', async () => {
    const id = await save('Old', 'Songs');
    const before = await listed();
    assert.equal((await call('PATCH', `/api/projects/${id}`, { name: 'New' })).status, 200);
    const after = await listed();
    assert.equal(after.New.folder, 'Songs');
    assert.equal(after.New.savedAt, before.Old.savedAt);
    assert.deepEqual((await call('GET', `/api/projects/${id}`)).body.appName, 'EasyMVMaker');
});

test('saving again keeps the project in its folder', async () => {
    const id = await save('Kept', 'A/B');
    await call('PUT', `/api/projects/${id}`, { name: 'Kept', data: { appName: 'EasyMVMaker', cuts: [1] } });
    assert.equal((await listed()).Kept.folder, 'A/B');
});

test('folders nest, rename with their contents, and cannot go inside themselves', async () => {
    await save('Deep', 'Top/Mid/Low');
    await call('POST', '/api/folders', { path: 'Top/Empty' });
    assert.deepEqual((await call('GET', '/api/folders')).body.filter(f => f.startsWith('Top')), ['Top', 'Top/Empty', 'Top/Mid', 'Top/Mid/Low']);
    assert.equal((await call('PATCH', '/api/folders', { from: 'Top', to: 'Top/Mid/Inner' })).status, 400);
    await call('PATCH', '/api/folders', { from: 'Top/Mid', to: 'Renamed' });
    assert.equal((await listed()).Deep.folder, 'Renamed/Low');
    const folders = (await call('GET', '/api/folders')).body;
    assert.ok(folders.includes('Top/Empty') && !folders.some(f => f.startsWith('Top/Mid')), folders.join(','));
});

test('removing a folder deletes no project: they move up a level', async () => {
    await save('Inside', 'Box/Lid');
    await save('Beside', 'Box');
    await call('DELETE', '/api/folders?path=Box');
    const l = await listed();
    assert.equal(l.Inside.folder, 'Lid');
    assert.equal(l.Beside.folder, '');
    assert.ok(!(await call('GET', '/api/folders')).body.includes('Box'));
});

test('a preview is stored beside the project and listed', async () => {
    const id = await save('Pictured', '');
    const res = await fetch(`${base}/api/projects/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(res.status, 200);
    assert.equal((await listed()).Pictured.thumb, true);
    assert.deepEqual([...new Uint8Array(await (await fetch(`${base}/api/projects/${id}/thumb`)).arrayBuffer())], [1, 2, 3]);
    await call('DELETE', `/api/projects/${id}`);
    assert.equal((await fetch(`${base}/api/projects/${id}/thumb`)).status, 404, 'deleted with the project');
});
