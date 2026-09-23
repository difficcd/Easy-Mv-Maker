import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apiFetch, fetchAsset, putAsset } from '../../src/core/api.ts';

// A real server rather than a stubbed fetch, because the thing being tested is what fetch does
// with a status code - and a stub would be me asserting my own assumption about that.

let server, base, lastPut;

const start = () => new Promise((res) => {
    server = http.createServer((req, url) => { });
    server.close();
    server = http.createServer((req, reply) => {
        const [path, query] = req.url.split('?');
        if (path === '/ok') { reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end('{"id":"p_1","name":"Round Trip"}'); return; }
        if (path === '/missing') { reply.writeHead(404, { 'Content-Type': 'application/json' }); reply.end('{"error":"not found"}'); return; }
        if (path === '/broken') { reply.writeHead(500, { 'Content-Type': 'text/html' }); reply.end('<html>oops</html>'); return; }
        if (path === '/blob') { reply.writeHead(200, { 'Content-Type': 'image/webp' }); reply.end(Buffer.from([1, 2, 3, 4])); return; }
        if (path.includes('/asset/')) {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                lastPut = { path, query, type: req.headers['content-type'], bytes: Buffer.concat(chunks) };
                if (path.includes('refuse')) { reply.writeHead(507); reply.end('{}'); return; }
                reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end('{"ok":true}');
            });
            return;
        }
        reply.writeHead(404); reply.end('{}');
    });
    server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; res(); });
});

test('apiFetch: a good response is parsed', async (t) => {
    await start();
    t.after(() => server.close());
    assert.deepEqual(await apiFetch(`${base}/ok`), { id: 'p_1', name: 'Round Trip' });
});

// fetch resolves on a 404. Without the status check the caller parses the error body as its
// answer - which is exactly how {"error":"not found"} once became a frame's image data.
test('apiFetch: a 404 throws instead of returning the error body', async (t) => {
    await start();
    t.after(() => server.close());
    await assert.rejects(() => apiFetch(`${base}/missing`), /HTTP 404/);
    await assert.rejects(() => apiFetch(`${base}/broken`), /HTTP 500/);
});

test('fetchAsset: bytes come back as a Blob with their type', async (t) => {
    await start();
    t.after(() => server.close());
    const blob = await fetchAsset(`${base}/blob`);
    assert.equal(blob.type, 'image/webp');
    assert.equal(blob.size, 4);
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
});

test('fetchAsset: a missing asset throws rather than handing back the error page', async (t) => {
    await start();
    t.after(() => server.close());
    await assert.rejects(() => fetchAsset(`${base}/missing`), /HTTP 404/);
});

test('putAsset: sends the blob itself, with its type and extension', async (t) => {
    await start();
    t.after(() => server.close());
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/webp' });
    await putAsset(`${base}/api/projects/p_1`, { id: 'frame7', ext: 'webp', blob }, 'nope');
    assert.equal(lastPut.path, '/api/projects/p_1/asset/frame7');
    assert.equal(lastPut.query, 'ext=webp');
    assert.equal(lastPut.type, 'image/webp');
    assert.deepEqual([...lastPut.bytes], [9, 9, 9]);
});

test('putAsset: a legacy dataURL is fetched back into a Blob first', async (t) => {
    await start();
    t.after(() => server.close());
    const url = 'data:image/png;base64,' + Buffer.from([7, 7]).toString('base64');
    await putAsset(`${base}/api/projects/p_1`, { id: 'old', ext: 'png', url }, 'nope');
    assert.equal(lastPut.type, 'image/png');
    assert.deepEqual([...lastPut.bytes], [7, 7]);
});

test('putAsset: a refused upload throws the message it was given, not a status code', async (t) => {
    await start();
    t.after(() => server.close());
    const blob = new Blob([new Uint8Array([1])], { type: 'image/webp' });
    await assert.rejects(
        () => putAsset(`${base}/api/projects/refuse`, { id: 'f', ext: 'webp', blob }, '프레임 업로드 실패 (3/9)'),
        /프레임 업로드 실패 \(3\/9\)/,
        'the caller localises and numbers it, so the message has to survive',
    );
});

test('putAsset: an extension is escaped rather than trusted into the query', async (t) => {
    await start();
    t.after(() => server.close());
    const blob = new Blob([new Uint8Array([1])], { type: 'image/webp' });
    await putAsset(`${base}/api/projects/p_1`, { id: 'f', ext: 'we bp&x=1', blob }, 'nope');
    assert.equal(lastPut.query, 'ext=we%20bp%26x%3D1');
});

// --- waiting out a rate limit (#the 120-frame save) --------------------------------------------
//
// Saving externalises every frame as its own upload, so a save costs `frames + 2` writes. Any
// ceiling the server picks can be reached by a big enough project, and failing there is the worst
// outcome available: the manifest is written last, so every frame uploads and then nothing is
// committed. These pin the arithmetic that turns that into "slower" instead.

import { retryDelayMs } from '../../src/core/api.ts';

test('retryDelayMs: the server is believed when it says how long to wait', () => {
    assert.equal(retryDelayMs('1', 0), 1000);
    assert.equal(retryDelayMs('3', 0), 3000);
});

test('retryDelayMs: no header means back off, doubling', () => {
    // A server that rate limits without saying for how long still has to be backed off.
    assert.equal(retryDelayMs(null, 0), 250);
    assert.equal(retryDelayMs(null, 1), 500);
    assert.equal(retryDelayMs(null, 2), 1000);
    assert.ok(retryDelayMs(null, 3) > retryDelayMs(null, 2));
});

test('retryDelayMs: junk is treated as no header rather than as zero', () => {
    // Zero would busy-loop against the thing that just asked to be left alone.
    for (const h of ['', 'soon', '-5', '0', undefined, NaN]) {
        assert.ok(retryDelayMs(h, 0) >= 200, `${h} gave ${retryDelayMs(h, 0)}`);
    }
});

test('retryDelayMs: a wild Retry-After cannot stall a save for an hour', () => {
    assert.ok(retryDelayMs('3600', 0) <= 5000);
    assert.ok(retryDelayMs('99999', 5) <= 5000);
});

test('retryDelayMs: never busy-loops, never stalls, whatever it is given', () => {
    for (const h of [null, '0', '1', '600', 'x']) {
        for (let a = 0; a < 10; a++) {
            const ms = retryDelayMs(h, a);
            assert.ok(ms >= 200 && ms <= 5000, `${h}/${a} gave ${ms}`);
        }
    }
});
