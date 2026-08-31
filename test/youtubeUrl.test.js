import test from 'node:test';
import assert from 'node:assert/strict';
import { isYouTubeUrl } from '../server/youtubeUrl.js';

test('the addresses people actually paste are accepted', () => {
    for (const u of [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=abc',
        'https://m.youtube.com/watch?v=abc',
        'https://music.youtube.com/watch?v=abc',
        'https://youtu.be/abc',
        'https://www.youtube.com/shorts/abc',
        'https://www.youtube-nocookie.com/embed/abc',
        'http://www.youtube.com/watch?v=abc',
    ]) {
        assert.ok(isYouTubeUrl(u), `rejected a real one: ${u}`);
    }
});

test('a host that merely contains the word is not YouTube', () => {
    // The two ways a string check gets this wrong. Searching anywhere in the URL accepts the
    // first; anchoring at the start accepts the second. Only parsing gets both right.
    assert.equal(isYouTubeUrl('https://evil.test/?next=youtube.com'), false);
    assert.equal(isYouTubeUrl('https://youtube.com.evil.test/watch?v=abc'), false);
    assert.equal(isYouTubeUrl('https://notyoutube.com/watch?v=abc'), false);
    assert.equal(isYouTubeUrl('https://evil.test/youtube.com/watch'), false);
});

test('credentials in the URL do not smuggle a host past the check', () => {
    // The classic: everything before @ is userinfo, so the real host is evil.test.
    assert.equal(isYouTubeUrl('https://www.youtube.com@evil.test/x'), false);
    assert.equal(isYouTubeUrl('https://user:pass@evil.test/?a=youtube.com'), false);
});

test('the internal addresses this check exists to block', () => {
    // Handing these to yt-dlp would have it fetch from the host's own network - reachable from
    // the server and from nowhere else, which is what made an open downloader worth closing.
    for (const u of [
        'http://localhost:8787/api/projects',
        'http://127.0.0.1/',
        'http://169.254.169.254/latest/meta-data/',
        'http://192.168.1.1/',
        'http://[::1]:8787/',
    ]) {
        assert.equal(isYouTubeUrl(u), false, `let through: ${u}`);
    }
});

test('non-http schemes are refused', () => {
    assert.equal(isYouTubeUrl('file:///etc/passwd'), false);
    assert.equal(isYouTubeUrl('ftp://youtube.com/x'), false);
    assert.equal(isYouTubeUrl('javascript:alert(1)'), false);
    // Even one wearing the right hostname.
    assert.equal(isYouTubeUrl('data:text/html,youtube.com'), false);
});

test('the host comparison ignores case', () => {
    assert.ok(isYouTubeUrl('https://WWW.YouTube.COM/watch?v=abc'));
});

test('junk in, false out - never a throw', () => {
    for (const v of ['', '   ', 'youtube.com/watch?v=abc', null, undefined, 42, {}, []]) {
        assert.equal(isYouTubeUrl(/** @type {any} */(v)), false, `threw or accepted: ${String(v)}`);
    }
});
