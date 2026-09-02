// The service worker's caching rule, tested without a browser.
//
// Worth testing because getting it wrong is invisible from every angle that is normally checked:
// the build passes, the deployment is green, the commit is right, and the app is still last
// week's - the bug lives entirely in a visitor's browser. It shipped that way once.
//
// sw.js is a classic worker script rather than a module, so it cannot be imported. It is read and
// run in a sandbox with a fake `self`, which also checks that the file parses and that its
// listeners register.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadWorker() {
    const listeners = {};
    const sandbox = {
        self: {
            addEventListener: (type, fn) => { listeners[type] = fn; },
            location: { origin: 'https://example.test' },
            skipWaiting: () => { },
            clients: { claim: async () => { } },
        },
        caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
        fetch: async () => ({ ok: true, clone: () => ({}) }),
        URL,
        Response: class { },
        Promise,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync('public/sw.js', 'utf8'), sandbox);
    return { listeners, strategy: vm.runInContext('cacheStrategy', sandbox), sandbox };
}

test('the worker parses and registers the handlers it needs', () => {
    const { listeners } = loadWorker();
    for (const type of ['install', 'activate', 'fetch']) {
        assert.equal(typeof listeners[type], 'function', `no ${type} handler`);
    }
});

test('a navigation always asks the network first', () => {
    // The regression that shipped: a cached index.html was served ahead of the network, so it
    // kept naming the bundle hash from the day it was cached and the app never updated.
    const { strategy } = loadWorker();
    assert.equal(strategy('/', 'navigate'), 'network-first');
    assert.equal(strategy('/index.html', 'navigate'), 'network-first');
    assert.equal(strategy('/anything/deep', 'navigate'), 'network-first');
});

test('index.html is network-first even when it is not a navigation', () => {
    const { strategy } = loadWorker();
    assert.equal(strategy('/index.html', 'no-cors'), 'network-first');
    assert.equal(strategy('/', undefined), 'network-first');
});

test('content-hashed assets are cache-first, because their names change with their bytes', () => {
    const { strategy } = loadWorker();
    assert.equal(strategy('/assets/index-C4SQoZ_1.js', 'no-cors'), 'cache-first');
    assert.equal(strategy('/assets/index-abc123.css', 'no-cors'), 'cache-first');
});

test('the API is never served from cache', () => {
    // A stale project list is worse than an error, because it looks like the server answered.
    const { strategy } = loadWorker();
    assert.equal(strategy('/api/projects', 'cors'), 'bypass');
    assert.equal(strategy('/api/projects/p_1/asset/x', 'cors'), 'bypass');
    assert.equal(strategy('/api/youtube-audio', 'cors'), 'bypass');
});

test('an /assets navigation is still a navigation', () => {
    // Ordering inside the rule: if the hashed-asset check came first, a navigation to an asset
    // path would be served from cache and could not be reloaded out of a bad state.
    const { strategy } = loadWorker();
    assert.equal(strategy('/assets/index-abc.js', 'navigate'), 'network-first');
});

test('everything else falls back to network-first', () => {
    const { strategy } = loadWorker();
    for (const p of ['/manifest.webmanifest', '/icon.svg', '/sw.js', '/favicon.ico']) {
        assert.equal(strategy(p, 'no-cors'), 'network-first', p);
    }
});

test('the cache name is not the one whose entries have to be thrown away', () => {
    // activate deletes every cache except CACHE_NAME, so the name has to change when the rules
    // do - otherwise nothing written under the old rules is ever removed.
    const src = readFileSync('public/sw.js', 'utf8');
    const m = src.match(/const CACHE_NAME = '([^']+)'/);
    assert.ok(m, 'CACHE_NAME not found');
    assert.notEqual(m[1], 'mv-maker-cache-v1', 'still the name whose cache-first entries must go');
});
