import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeId, safeStamp, fileFor, assetsDirFor, backupDirFor, DATA_DIR, ASSET_MIME, AUDIO_MIME, audioType, videoType, newId } from '../../server/paths.js';

test('safeId leaves nothing a path could be made of', () => {
    assert.equal(safeId('../../etc/passwd'), 'etcpasswd');
    assert.equal(safeId('p_abc-1'), 'p_abc-1');
    assert.equal(safeId('x'.repeat(100)).length, 64);
    assert.equal(safeId(undefined), 'undefined');   // String() first, never a throw
});

test('every path builder goes through safeId, and stays under the data directory', () => {
    for (const f of [fileFor, assetsDirFor, backupDirFor]) {
        const p = f('../../../escape');
        assert.ok(p.startsWith(DATA_DIR), p);
        assert.ok(!p.includes('..'), p);
    }
    assert.equal(path.basename(fileFor('a b')), 'ab.json');
    assert.equal(path.basename(assetsDirFor('a')), 'a.assets');
    assert.equal(path.basename(backupDirFor('a')), 'a.backups');
});

test('a snapshot stamp is the ISO time with its separators replaced, and nothing else gets through', () => {
    assert.equal(safeStamp('2026-09-21T11-28-56-836Z'), '2026-09-21T11-28-56-836Z');
    assert.equal(safeStamp('../x'), 'x');
    assert.equal(safeStamp('y'.repeat(60)).length, 40);
});

test('content types: the ambiguous containers answer audio when asked as audio', () => {
    assert.equal(ASSET_MIME.webm, 'video/webm');
    assert.equal(AUDIO_MIME.webm, 'audio/webm');
    assert.equal(audioType('.m4a'), 'audio/mp4');
    assert.equal(audioType('.xyz'), 'application/octet-stream');
    assert.equal(videoType('.mkv'), 'video/x-matroska');
    assert.equal(videoType('.xyz'), 'video/mp4');
});

test('new ids are distinct and already safe', () => {
    const a = newId(), b = newId();
    assert.notEqual(a, b);
    assert.equal(safeId(a), a);
});
