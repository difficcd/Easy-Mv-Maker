/* Service worker: installable, works offline, and does not serve last week's app.
 *
 * The previous version was cache-first for everything, with a cache name that never changed. That
 * combination means a browser which has visited once never sees a new deployment again: the
 * cached index.html is returned before the network is consulted, it names the bundle hash from
 * the day it was cached, and that bundle is in the cache too. The activate handler does delete
 * caches whose name differs from the current one - but the name was a constant, so nothing was
 * ever deleted. A feature could ship, deploy green, and simply not be there.
 *
 * What makes this safe to get wrong twice is that everything looks fine from the outside. The
 * deployment succeeds, the commit is right, and the bug lives entirely in the visitor's browser.
 *
 * The fix is to split by what the URL promises:
 *
 *   /assets/*   content-hashed by Vite, so the name changes whenever the bytes do. Cache-first
 *               is not just safe here, it is the point - these can be kept forever.
 *   everything  network-first, cache as a fallback. index.html has a fixed name and changing
 *   else       contents, which is exactly the case cache-first cannot serve.
 *   /api/*      never touched; it must reach the live server.
 *
 * CACHE_NAME must be bumped whenever this file's behaviour changes, so the activate handler
 * clears what the old rules cached.
 */

const CACHE_NAME = 'mv-maker-cache-v2';

// The app shell, so a cold offline start has something to open.
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/**
 * How a request should be served. Split out and named so the rule can be read - and tested -
 * without a browser.
 *
 * @param {string} pathname
 * @param {string} [mode] the request's `mode`; navigations must never come from cache first
 * @returns {'bypass' | 'cache-first' | 'network-first'}
 */
function cacheStrategy(pathname, mode) {
    // The project-storage API is live data. Serving a cached project list would be worse than
    // failing, because it looks like the server answered.
    if (pathname.startsWith('/api')) return 'bypass';
    // Typing a URL or reloading. Always the network first, or a reload can never recover.
    if (mode === 'navigate') return 'network-first';
    // Vite writes a content hash into these names, so a given URL's bytes never change.
    if (pathname.startsWith('/assets/')) return 'cache-first';
    return 'network-first';
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Individually, so one missing file does not fail the whole install the way addAll does.
        await Promise.all(SHELL.map(u => cache.add(u).catch(() => { })));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const strategy = cacheStrategy(url.pathname, req.mode);
    if (strategy === 'bypass') return;

    if (strategy === 'cache-first') {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        })());
        return;
    }

    // Network first: what is on the server wins, and the cache is only what to fall back on when
    // there is no server to ask.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const res = await fetch(req);
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        } catch {
            const hit = await cache.match(req, { ignoreSearch: true });
            if (hit) return hit;
            // A navigation with nothing cached for that exact URL still gets the app shell, so
            // deep links work offline.
            if (req.mode === 'navigate') {
                const shell = await cache.match('/index.html');
                if (shell) return shell;
            }
            return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
    })());
});

// Lets the page tell a waiting worker to take over immediately, rather than the user having to
// close every tab before an update lands.
self.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') self.skipWaiting();
});
