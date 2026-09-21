// Tiny project storage API for Easy MV Maker.
// Projects are persisted as JSON files under server/data/ (a simple file-backed DB),
// so saving "to the server" is independent of the browser's local download / file save.
import express from 'express';
import { promises as fs } from 'node:fs';
import { createRateLimiter, rateLimit } from './rateLimit.js';
import { DATA_DIR } from './paths.js';
import { projectRoutes } from './projects.js';
import { backupRoutes } from './backups.js';
import { youtubeRoutes } from './youtube.js';

const PORT = process.env.MV_API_PORT ? Number(process.env.MV_API_PORT) : 8787;
// Loopback unless somebody asks otherwise. Passing no host to app.listen binds every interface,
// which is what this did - so on a laptop joined to any network, all fourteen endpoints were
// reachable by anyone on it, with no authentication in front of them.
//
// Nothing needs the wider binding. A tablet reaches the app through the Vite dev server's /api
// proxy, and that proxy runs on this machine and connects to localhost - so the tablet workflow
// keeps working with the API bound to loopback. Set MV_API_HOST=0.0.0.0 to open it deliberately.
const HOST = process.env.MV_API_HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '256mb' })); // projects embed base64 bitmaps, so allow large bodies

// Rate limits, in three tiers, because the routes cost wildly different amounts.
//
// Generous by design. These are a brake on runaway scripts and casual abuse, not access control -
// that is still open and still tracked on #41. A limit low enough to be a security boundary would
// also be low enough to interrupt an ordinary autosave-heavy editing session.
//
// The importer gets its own, much tighter, tier: each call starts a yt-dlp process that downloads
// from someone else's servers. Hammering that costs the host bandwidth and gets the address
// blocked by YouTube, which breaks the feature for everybody using that machine.
const readLimit = createRateLimiter({ capacity: 240, perSecond: 8 });    // listing and fetching
const writeLimit = createRateLimiter({ capacity: 120, perSecond: 2 });   // saves, uploads, deletes
const importLimit = createRateLimiter({ capacity: 4, perSecond: 0.05 }); // ~3 a minute, sustained

app.get('/api/*splat', rateLimit(readLimit, 'requests'));
app.put('/api/*splat', rateLimit(writeLimit, 'writes'));
app.post('/api/*splat', rateLimit(writeLimit, 'writes'));
app.delete('/api/*splat', rateLimit(writeLimit, 'writes'));
app.get('/api/youtube-audio', rateLimit(importLimit, 'imports'));
app.get('/api/youtube-video', rateLimit(importLimit, 'imports'));


await fs.mkdir(DATA_DIR, { recursive: true });

projectRoutes(app);
backupRoutes(app);
youtubeRoutes(app);

app.listen(PORT, HOST, () => {
    // Printing the host it actually bound, not the one it probably meant. The old line said
    // "localhost" while binding everything, which is the kind of message that stops anybody from
    // looking further.
    console.log(`[mv-api] project storage listening on http://${HOST}:${PORT}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
        console.log('[mv-api] WARNING: reachable from the network, and there is no authentication.');
    }
});
