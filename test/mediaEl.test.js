import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMediaSrc } from '../src/core/mediaEl.js';

test('a blob url from our own bytes is allowed', () => {
    assert.equal(safeMediaSrc('blob:http://localhost:5175/abc-123', 'audio'), 'blob:http://localhost:5175/abc-123');
    assert.equal(safeMediaSrc('blob:null/xyz', 'video'), 'blob:null/xyz');
});

test('a data url of the right kind is allowed', () => {
    assert.equal(safeMediaSrc('data:audio/mpeg;base64,AAAA', 'audio'), 'data:audio/mpeg;base64,AAAA');
    assert.equal(safeMediaSrc('data:video/mp4;base64,AAAA', 'video'), 'data:video/mp4;base64,AAAA');
    assert.equal(safeMediaSrc('data:audio/ogg,raw', 'audio'), 'data:audio/ogg,raw');
});

test('a data url of the wrong kind is refused', () => {
    // An .emv is a document people send each other, and its audio field naming a video - or an
    // image, or anything else - is not something to hand an element and hope.
    assert.equal(safeMediaSrc('data:video/mp4;base64,AAAA', 'audio'), null);
    assert.equal(safeMediaSrc('data:audio/mpeg;base64,AAAA', 'video'), null);
    assert.equal(safeMediaSrc('data:image/png;base64,AAAA', 'audio'), null);
});

test('javascript: is refused - the case the rule is actually about', () => {
    // A media element will not run one, but that is a property of the browser, not of this code,
    // and the same value is one refactor away from an href.
    assert.equal(safeMediaSrc('javascript:alert(1)', 'audio'), null);
    assert.equal(safeMediaSrc('JavaScript:alert(1)', 'video'), null);
});

test('a data url that only contains the type as a substring is refused', () => {
    // The check is anchored at the scheme, so this cannot sneak past on a substring match.
    assert.equal(safeMediaSrc('data:text/html;x=audio/mpeg,<script>', 'audio'), null);
    assert.equal(safeMediaSrc('data:text/html,audio/mpeg', 'audio'), null);
    assert.equal(safeMediaSrc('https://example.com/data:audio/mpeg,', 'audio'), null);
});

test('http and file urls are refused, so a project cannot make the app fetch on open', () => {
    assert.equal(safeMediaSrc('http://example.com/x.mp3', 'audio'), null);
    assert.equal(safeMediaSrc('https://example.com/x.mp3', 'audio'), null);
    assert.equal(safeMediaSrc('file:///etc/passwd', 'audio'), null);
});

test('junk is null rather than an element that silently never plays', () => {
    // The duller failure this also catches: a server error page or a truncated string in the
    // audio field fails visibly here instead of becoming a track that just does nothing.
    for (const bad of ['', '   ', '{"error":"not found"}', null, undefined, 42, {}, []]) {
        assert.equal(safeMediaSrc(/** @type {any} */(bad), 'audio'), null, `for ${JSON.stringify(bad)}`);
    }
});

test('a data url with no comma or semicolon is refused', () => {
    // `data:audio/` alone is not a payload, and treating it as one would set an element to a
    // source that can never load.
    assert.equal(safeMediaSrc('data:audio/', 'audio'), null);
    assert.equal(safeMediaSrc('data:audio/mpeg', 'audio'), null);
});
