import test from 'node:test';
import assert from 'node:assert/strict';
import { publicMessage, sendError, GENERIC } from '../../server/errors.js';

// Inspection finding F5 (docs/process/2026-10-21.md). Nine handlers sent `String(e)` to the
// client. For the project routes nobody in the client read it, so the only audience was whoever
// called the API directly - and through the dev server's LAN proxy that is anyone on the network.

/** A filesystem error as Node raises it: the message carries the absolute path. */
const fsError = (code, file = 'C:\\Users\\someone\\Desktop\\easy-mv-maker\\server\\data\\p_abc.json') =>
    Object.assign(new Error(`${code}: operation failed, open '${file}'`), { code, path: file });

const fakeRes = () => {
    const r = { headersSent: false, code: 0, body: undefined };
    r.status = (n) => { r.code = n; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

test('a filesystem error never sends its path', () => {
    // The whole finding. Before, this exact error went out verbatim.
    for (const code of ['ENOSPC', 'EACCES', 'ENOENT', 'EIO']) {
        const sent = publicMessage(fsError(code));
        assert.doesNotMatch(sent, /Users|Desktop|easy-mv-maker|p_abc|\\\\|\//, `${code} leaked a path: ${sent}`);
    }
});

test('a known code becomes a sentence the user can act on', () => {
    // Why the message is not simply blanked: the YouTube routes show it, and "the disk is full"
    // is information the person needs.
    assert.match(publicMessage(fsError('ENOSPC')), /디스크/);
    assert.match(publicMessage(fsError('EACCES')), /권한/);
    assert.notEqual(publicMessage(fsError('ENOSPC')), GENERIC);
});

test('anything else gets the generic sentence, whatever was thrown', () => {
    for (const thrown of [new Error('secret /etc/passwd'), fsError('EWHATEVER'), 'a string', null, undefined, 42, { code: 7 }]) {
        assert.equal(publicMessage(thrown), GENERIC);
    }
});

test('sendError logs the whole error and sends only the safe part', () => {
    const logged = [];
    const res = fakeRes();
    const e = fsError('ENOSPC');
    sendError(res, e, 'PUT /api/projects/:id', (...a) => logged.push(a));
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: publicMessage(e) });
    // The owner of the machine still gets everything, in the server's own log.
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /PUT \/api\/projects\/:id/);
    assert.equal(logged[0][1], e);
});

test('a response already streaming is logged, not answered twice', () => {
    // The YouTube routes set headers and start sending a file; a failure after that cannot change
    // the status, and trying would throw on top of the error being reported.
    const res = fakeRes();
    res.headersSent = true;
    let logs = 0;
    assert.doesNotThrow(() => sendError(res, fsError('EIO'), 'GET /api/youtube-video', () => { logs++; }));
    assert.equal(res.code, 0);
    assert.equal(logs, 1);
});
