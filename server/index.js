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
//
// The write tier is sized by what one save costs, which is not one request. Saving a project
// externalises every frame as its own upload, so a save is `frames + 2` writes - the record and
// the manifest. At a capacity of 120 a 120-frame project uploaded every frame and then failed on
// the manifest: all of the work, none of the result, and a retry started from an emptier bucket.
// A frame-per-cut animation reaching a thousand frames is ordinary, so the ceiling is set past
// that, and the refill is quick enough that consecutive saves do not accumulate.
//
// This is still a brake: a runaway loop is held to 40 writes a second rather than allowed to
// spin. It was never access control, which remains open and is tracked on #41.
const readLimit = createRateLimiter({ capacity: 2400, perSecond: 80 });   // listing and fetching
const writeLimit = createRateLimiter({ capacity: 1200, perSecond: 40 });  // saves, uploads, deletes
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
