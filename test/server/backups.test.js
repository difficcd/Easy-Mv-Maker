import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// The rotating backups (server/backups.js), against a temporary data directory: the safety net
// behind every save, and until now loaded by no test (cycle 2, N1). MV_DATA_DIR is read when
// paths.js loads, so it is set before anything from server/ is imported.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-backups-'));
process.env.MV_DATA_DIR = dir;
const { backupRoutes } = await import('../../server/backups.js');
const { BACKUP_KEEP, assetsDirFor, backupDirFor } = await import('../../server/paths.js');

const app = express();
app.use(express.json());
backupRoutes(app);
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }); });

const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
};
// Stamps are the time to the millisecond; two backups in the same one would share a name.
const tick = () => new Promise(r => setTimeout(r, 3));
const backup = async (key, data, name = 'Song') => { await tick(); return (await call('POST', `/api/backups/${key}`, { name, data })).body; };

test('a backup can be listed and restored as it was written', async () => {
    const b = await backup('k1', { appName: 'EasyMVMaker', cuts: [1, 2] });
    assert.equal(b.ok, true);
    const list = (await call('GET', '/api/backups/k1')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Song');
    assert.deepEqual((await call('GET', `/api/backups/k1/${list[0].stamp}`)).body, { appName: 'EasyMVMaker', cuts: [1, 2] });
});

test(`only the newest ${BACKUP_KEEP} are kept`, async () => {
    for (let i = 0; i < BACKUP_KEEP + 3; i++) await backup('k2', { n: i });
    const list = (await call('GET', '/api/backups/k2')).body;
    assert.equal(list.length, BACKUP_KEEP);
    const newest = (await call('GET', `/api/backups/k2/${list[0].stamp}`)).body;
    assert.equal(newest.n, BACKUP_KEEP + 2, 'listed newest first, and the newest is the last written');
});

test('assets no kept backup names are pruned; named ones, and the audio, stay', async () => {
    const assets = assetsDirFor('k3');
    await fs.mkdir(assets, { recursive: true });
    for (const f of ['f1.webp', 'f2.webp', 'old.webp', '__audio__.mp3']) await fs.writeFile(path.join(assets, f), 'x');
    const b = await backup('k3', { assets: [{ id: 'f1', ext: 'webp' }, { id: 'f2', ext: 'webp' }] });
    assert.equal(b.pruned, 1);
    assert.deepEqual((await fs.readdir(assets)).sort(), ['__audio__.mp3', 'f1.webp', 'f2.webp']);
});

test('an unreadable backup stops the pruning rather than deleting what it might name', async () => {
    const assets = assetsDirFor('k4');
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, 'maybe.webp'), 'x');
    await fs.mkdir(backupDirFor('k4'), { recursive: true });
    await fs.writeFile(path.join(backupDirFor('k4'), '0000-broken.json'), '{ not json');
    const b = await backup('k4', { assets: [] });
    assert.equal(b.pruned, 0);
    assert.deepEqual(await fs.readdir(assets), ['maybe.webp']);
});

test('a backup can be deleted, and a missing one is a 404', async () => {
    await backup('k5', { x: 1 });
    const [first] = (await call('GET', '/api/backups/k5')).body;
    assert.equal((await call('DELETE', `/api/backups/k5/${first.stamp}`)).status, 200);
    assert.equal((await call('GET', '/api/backups/k5')).body.length, 0);
    assert.equal((await call('GET', `/api/backups/k5/${first.stamp}`)).status, 404);
    assert.equal((await call('DELETE', '/api/backups/k5/nothing')).status, 404);
});

test('a key or stamp with a path in it stays inside the data directory', async () => {
    // Encoded, so it reaches the route as one segment and the parameter decodes to '../../escape'.
    await backup(encodeURIComponent('../../escape'), { x: 1 });
    const entries = await fs.readdir(dir);
    assert.ok(entries.includes('escape.backups'), entries.join(','));
    // An encoded path in the stamp never reaches a file: Express or safeStamp turns it away.
    assert.equal((await fetch(`${base}/api/backups/k1/..%2F..%2Fetc`)).status, 404);
});
