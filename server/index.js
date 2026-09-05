// Tiny project storage API for Easy MV Maker.
// Projects are persisted as JSON files under server/data/ (a simple file-backed DB),
// so saving "to the server" is independent of the browser's local download / file save.
import express from 'express';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isYouTubeUrl } from './youtubeUrl.js';
import { createRateLimiter, rateLimit } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
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

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
const fileFor = (id) => path.join(DATA_DIR, `${safeId(id)}.json`);
const assetsDirFor = (id) => path.join(DATA_DIR, `${safeId(id)}.assets`);
const newId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const ASSET_MIME = {
    webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
    webm: 'video/webm', mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime',
};
// webm/mp4/ogg are ambiguous (audio vs video) — the asset id tells us which.
const AUDIO_MIME = { webm: 'audio/webm', mp4: 'audio/mp4', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', opus: 'audio/ogg', wav: 'audio/wav' };

/**
 * Write a project file and answer with what was written.
 *
 * Creating and overwriting were the same five lines twice, differing only in where the id came
 * from. Two copies of the stored shape are two chances for "save as new" and "overwrite" to
 * write different files - and the difference would only show up when one of them was opened.
 */
async function writeProject(rawId, req, res) {
    // Sanitised here rather than by one of the two callers, so it is done once and the id written
    // into the file always matches the filename fileFor builds from it. Every path builder does
    // its own safeId as well; a caller doing it too made the ones that did not look unguarded.
    const id = safeId(rawId);
    const name = req.body?.name || 'Untitled';
    // The body is either { name, data } or the document itself, depending on which client wrote it.
    const data = req.body?.data ?? req.body;
    // Temp file then rename, the same way a backup is written, and for the same reason its
    // comment gives: a crash or a full disk part-way through must not leave a half-written file.
    // Only the backup had it. The project - the thing a backup exists to protect - was written
    // straight over the previous copy, so an interrupted save destroyed the good one. That this
    // happens is not hypothetical: listJsonDir below already skips files that will not parse,
    // "so one corrupt save should not make the project list unopenable". This is where they came
    // from.
    //
    // The temp name ends in .json.tmp, which the .json filters everywhere else already skip, so
    // one left behind by a failed rename is inert rather than showing up as a project.
    const target = fileFor(id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ id, name, savedAt: new Date().toISOString(), data }));
    await fs.rename(tmp, target);
    res.json({ id, name });
}

/**
 * The .json files in a directory, summarised, newest first.
 *
 * A file that will not parse is left out rather than failing the whole listing: one corrupt save
 * should not make the project list unopenable.
 *
 * @param {string} dir
 * @param {(name: string, fullPath: string) => Promise<object|null>} summarise
 */
async function listJsonDir(dir, summarise) {
    const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'));
    const items = await Promise.all(files.map(async f => {
        try { return await summarise(f, path.join(dir, f)); } catch { return null; }
    }));
    return items.filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

// List saved projects (metadata only).
app.get('/api/projects', async (_req, res) => {
    try {
        res.json(await listJsonDir(DATA_DIR, async (f, full) => {
            const raw = JSON.parse(await fs.readFile(full, 'utf8'));
            return { id: f.replace(/\.json$/, ''), name: raw.name || raw.data?.appName || f, savedAt: raw.savedAt || null };
        }));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Fetch one project's full data.
app.get('/api/projects/:id', async (req, res) => {
    try {
        const raw = JSON.parse(await fs.readFile(fileFor(req.params.id), 'utf8'));
        res.json(raw.data ?? raw);
    } catch { res.status(404).json({ error: 'not found' }); }
});

// Create a new project (server assigns an id).
app.post('/api/projects', async (req, res) => {
    try {
        await writeProject(newId(), req, res);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Overwrite an existing project.
app.put('/api/projects/:id', async (req, res) => {
    try {
        await writeProject(req.params.id, req, res);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Binary asset store (video frames). Kept OUT of the project JSON so large/original-quality
// projects don't build one giant base64 string (which OOMs the browser and the server).
// Uploaded and fetched one asset at a time, so peak memory is a single frame.
app.put('/api/projects/:id/asset/:assetId', express.raw({ type: '*/*', limit: '1024mb' }), async (req, res) => {
    try {
        const dir = assetsDirFor(req.params.id);
        await fs.mkdir(dir, { recursive: true });
        const ext = String(req.query.ext || 'webp').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webp';
        await fs.writeFile(path.join(dir, `${safeId(req.params.assetId)}.${ext}`), req.body);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.get('/api/projects/:id/asset/:assetId', async (req, res) => {
    try {
        const dir = assetsDirFor(req.params.id);
        const want = safeId(req.params.assetId) + '.';
        const f = (await fs.readdir(dir)).find(n => n.startsWith(want));
        if (!f) { res.status(404).json({ error: 'not found' }); return; }
        const ext = f.split('.').pop().toLowerCase();
        const mime = req.params.assetId === '__audio__' ? (AUDIO_MIME[ext] || 'audio/mpeg') : (ASSET_MIME[ext] || 'application/octet-stream');
        res.setHeader('Content-Type', mime);
        res.send(await fs.readFile(path.join(dir, f)));
    } catch { res.status(404).json({ error: 'not found' }); }
});

// Which assets are already stored for this id. Lets the client skip re-uploading frames it
// has already sent — without this, every autosave of a video-heavy project would re-push
// hundreds of MB. Assets are content-keyed by bitmapId, so presence is enough.
app.get('/api/projects/:id/assets', async (req, res) => {
    try {
        const dir = assetsDirFor(req.params.id);
        const files = await fs.readdir(dir).catch(() => []);
        res.json(files.map(f => f.replace(/\.[^.]+$/, '')));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// --- Autosave backups -------------------------------------------------------------------
// Rotating, timestamped snapshots kept as separate files on disk, so a corrupted or
// mistakenly overwritten project can be rolled back. Binary assets are NOT copied per
// snapshot; they live in the shared asset dir for the same key and are referenced by id.
const BACKUP_KEEP = 12;
const backupDirFor = (key) => path.join(DATA_DIR, `${safeId(key)}.backups`);
const safeStamp = (s) => String(s).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40);

// Rotating the snapshots was never enough: every automatic backup uploads its frames as binary
// assets, and only the JSON was ever deleted. Frames belonging to snapshots that had long since
// rotated out stayed on disk forever - one directory here had grown to 301MB of files that no
// retained snapshot referenced any more.
//
// Deleting is safe only against ALL retained snapshots, not just the newest: an older snapshot
// still has to be restorable. Anything none of them names is unreachable.
async function pruneBackupAssets(key, dir) {
    const assetsDir = assetsDirFor(key);
    let names;
    try { names = await fs.readdir(assetsDir); } catch { return 0; }

    const keep = new Set();
    let snaps;
    try { snaps = (await fs.readdir(dir)).filter(f => f.endsWith('.json')); } catch { return 0; }
    for (const f of snaps) {
        try {
            const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
            for (const a of (j?.data?.assets || [])) if (a?.id) keep.add(String(a.id));
        } catch {
            // An unreadable snapshot is not evidence that anything is unused, so keep everything.
            return 0;
        }
    }

    let removed = 0;
    for (const name of names) {
        const id = name.replace(/\.[^.]+$/, '');
        if (id.startsWith('__')) continue;        // __audio__ and friends are not in the manifest
        if (keep.has(id)) continue;
        await fs.unlink(path.join(assetsDir, name)).catch(() => { });
        removed++;
    }
    return removed;
}

app.post('/api/backups/:key', async (req, res) => {
    try {
        const dir = backupDirFor(req.params.key);
        await fs.mkdir(dir, { recursive: true });
        const savedAt = new Date().toISOString();
        const stamp = savedAt.replace(/[:.]/g, '-');
        const name = req.body?.name || 'Untitled';
        const data = req.body?.data ?? req.body;
        // Write to a temp file then rename: a crash mid-write can never leave a half-written
        // snapshot that would fail to parse on restore.
        const target = path.join(dir, `${stamp}.json`);
        const tmp = `${target}.tmp`;
        await fs.writeFile(tmp, JSON.stringify({ key: safeId(req.params.key), name, savedAt, data }));
        await fs.rename(tmp, target);
        // Rotate: keep only the newest BACKUP_KEEP snapshots.
        const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort();
        for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
            await fs.unlink(path.join(dir, f)).catch(() => { });
        }
        const pruned = await pruneBackupAssets(req.params.key, dir);
        res.json({ ok: true, stamp, savedAt, kept: Math.min(files.length, BACKUP_KEEP), pruned });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/backups/:key', async (_req, res) => {
    try {
        res.json(await listJsonDir(backupDirFor(_req.params.key), async (f, full) => {
            // One handle for both the stat and the read. Statting a path and then reading it is
            // two chances for the file to be something else in between, and this listing runs
            // while backups are being written.
            const fh = await fs.open(full, 'r');
            try {
                const st = await fh.stat();
                const head = JSON.parse(await fh.readFile('utf8'));
                return { stamp: f.replace(/\.json$/, ''), name: head.name || 'Untitled', savedAt: head.savedAt || st.mtime.toISOString(), size: st.size };
            } finally { await fh.close(); }
        }));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/backups/:key/:stamp', async (req, res) => {
    try {
        const f = path.join(backupDirFor(req.params.key), `${safeStamp(req.params.stamp)}.json`);
        const raw = JSON.parse(await fs.readFile(f, 'utf8'));
        res.json(raw.data ?? raw);
    } catch { res.status(404).json({ error: 'not found' }); }
});

app.delete('/api/backups/:key/:stamp', async (req, res) => {
    try {
        await fs.unlink(path.join(backupDirFor(req.params.key), `${safeStamp(req.params.stamp)}.json`));
        res.json({ ok: true });
    } catch { res.status(404).json({ error: 'not found' }); }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        await fs.unlink(fileFor(req.params.id)).catch(() => { });
        await fs.rm(assetsDirFor(req.params.id), { recursive: true, force: true }).catch(() => { });
        res.json({ ok: true });
    }
    catch { res.status(404).json({ error: 'not found' }); }
});

// Local-only: extract audio from a URL (YouTube etc) via yt-dlp + ffmpeg. Not for the
// deployed build. For personal/authorized use; respect source ToS and copyright.
const audioType = (ext) => ({ '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.opus': 'audio/ogg', '.ogg': 'audio/ogg' }[ext] || 'application/octet-stream');

app.get('/api/youtube-audio', async (req, res) => {
    const url = String(req.query.url || '');
    if (!isYouTubeUrl(url)) { res.status(400).json({ error: 'not a YouTube address' }); return; }
    const dir = path.join(os.tmpdir(), `yt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    // bestaudio in its native container — no ffmpeg needed; browser plays m4a/webm.
    const p = spawn('yt-dlp', ['-f', 'bestaudio/best', '--no-playlist', '--extractor-args', 'youtube:player_client=default,web_safari,android', '-o', path.join(dir, 'audio.%(ext)s'), url]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', (e) => { fs.rm(dir, { recursive: true, force: true }); res.status(500).json({ error: 'yt-dlp 실행 불가 (설치 필요): ' + e.message }); });
    p.on('close', async (code) => {
        try {
            if (code !== 0) { res.status(500).json({ error: friendlyYtError(err) }); return; }
            const files = await fs.readdir(dir);
            if (!files.length) { res.status(500).json({ error: '오디오 파일 없음' }); return; }
            const f = files[0];
            res.setHeader('Content-Type', audioType(path.extname(f).toLowerCase()));
            res.send(await fs.readFile(path.join(dir, f)));
        } catch (e) { res.status(500).json({ error: String(e) }); }
        finally { fs.rm(dir, { recursive: true, force: true }).catch(() => { }); }
    });
});

// Local-only: fetch a video by URL for frame extraction. Progressive single-file formats
// only, so no ffmpeg merge is needed. Personal/authorized use; respect source ToS.
const videoType = (ext) => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' }[ext] || 'video/mp4');
// Map yt-dlp stderr to something actionable instead of a raw dump.
const friendlyYtError = (err) => {
    const e = err.toLowerCase();
    if (e.includes('sign in') || e.includes('bot')) return '유튜브가 봇으로 판단해 차단했습니다. 잠시 후 재시도하거나 다른 영상을 사용하세요.';
    if (e.includes('age')) return '연령 제한 영상이라 받을 수 없습니다.';
    if (e.includes('private')) return '비공개 영상입니다.';
    if (e.includes('unavailable') || e.includes('removed')) return '영상을 찾을 수 없거나 삭제되었습니다.';
    if (e.includes('geo') || e.includes('country')) return '지역 제한 영상입니다.';
    if (e.includes('live')) return '라이브 스트림은 지원하지 않습니다.';
    if (e.includes('requested format') || e.includes('no video formats')) return '받을 수 있는 단일 파일 포맷이 없습니다 (ffmpeg 없이 병합 불가).';
    // YouTube signs its media URLs with a challenge that yt-dlp solves in JavaScript. When the
    // installed yt-dlp is too old to solve the current one it fetches an unsigned URL and the
    // download comes back 403 - extraction having succeeded moments earlier, which is what makes
    // this look like a network fault. It is not: it is a version problem, and saying "network
    // error" sends people to check their connection instead of running one command.
    if (e.includes('403') || e.includes('signature solving failed') || e.includes('n challenge')) {
        return 'yt-dlp가 최신이 아니라 유튜브가 다운로드를 거부했습니다 (403). 서버에서 yt-dlp를 업데이트하세요: python -m pip install -U yt-dlp';
    }
    if (e.includes('unable to download') || e.includes('network') || e.includes('timed out')) return '네트워크 오류로 받지 못했습니다.';
    return '영상 받기 실패: ' + err.slice(-300);
};
const runYtdlp = (args) => new Promise((resolve) => {
    const p = spawn('yt-dlp', args);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', (e) => resolve({ code: -1, err: 'SPAWN:' + e.message }));
    p.on('close', (code) => resolve({ code, err }));
});
// Locate ffmpeg so yt-dlp can merge DASH video+audio (needed for 1080p). Returns the containing
// dir (for --ffmpeg-location) or null. Checks env, PATH, and the winget install location.
const findFfmpegDir = () => {
    const candidates = [];
    if (process.env.FFMPEG_PATH) candidates.push(path.dirname(process.env.FFMPEG_PATH));
    const la = process.env.LOCALAPPDATA;
    if (la) {
        candidates.push(path.join(la, 'Microsoft', 'WinGet', 'Links'));
        try {
            const pkgs = path.join(la, 'Microsoft', 'WinGet', 'Packages');
            for (const d of fsSync.readdirSync(pkgs)) {
                if (!/ffmpeg/i.test(d)) continue;
                const stack = [path.join(pkgs, d)];
                while (stack.length) {
                    const cur = stack.pop();
                    let ents = []; try { ents = fsSync.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
                    if (ents.some(e => e.isFile() && e.name.toLowerCase() === 'ffmpeg.exe')) { candidates.push(cur); break; }
                    for (const e of ents) if (e.isDirectory()) stack.push(path.join(cur, e.name));
                }
            }
        } catch { }
    }
    candidates.push('C:\\ffmpeg\\bin');
    for (const c of candidates) {
        try { if (fsSync.existsSync(path.join(c, 'ffmpeg.exe')) || fsSync.existsSync(path.join(c, 'ffmpeg'))) return c; } catch { }
    }
    return null;
};
const FFMPEG_DIR = findFfmpegDir();
console.log('[mv-api] ffmpeg:', FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg.exe') : 'not found (YouTube capped at ~720p progressive)');

app.get('/api/youtube-video', async (req, res) => {
    const url = String(req.query.url || '');
    if (!isYouTubeUrl(url)) { res.status(400).json({ error: 'not a YouTube address' }); return; }
    const maxH = Math.max(144, Math.min(2160, Number(req.query.maxHeight) || 1080));
    const dir = path.join(os.tmpdir(), `ytv_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    // With ffmpeg present, prefer merged bestvideo+bestaudio (unlocks 1080p+); otherwise fall back
    // to progressive single-file formats (≤720p). Each entry widens on retry.
    const merged = [
        `bv*[height<=${maxH}][ext=mp4]+ba[ext=m4a]/bv*[height<=${maxH}]+ba/b[height<=${maxH}]`,
        `bv*+ba/b`,
    ];
    const progressive = [
        `best[height<=${maxH}][ext=mp4]/best[height<=${maxH}]`,
        'best[ext=mp4]/best',
        'worst[ext=mp4]/worst',
    ];
    const formats = FFMPEG_DIR ? [...merged, ...progressive] : progressive;
    const ffArgs = FFMPEG_DIR ? ['--ffmpeg-location', FFMPEG_DIR, '--merge-output-format', 'mp4'] : [];
    try {
        let lastErr = '';
        for (const fmt of formats) {
            const { code, err } = await runYtdlp(['-f', fmt, ...ffArgs, '--no-playlist', '--no-warnings',
                '--extractor-args', 'youtube:player_client=default,web_safari,android',
                '-o', path.join(dir, 'video.%(ext)s'), url]);
            if (err.startsWith('SPAWN:')) { res.status(500).json({ error: 'yt-dlp 실행 불가 (설치 필요): ' + err.slice(6) }); return; }
            lastErr = err;
            const files = code === 0 ? (await fs.readdir(dir)).filter(f => !f.endsWith('.part')) : [];
            if (files.length) {
                const f = files[0];
                res.setHeader('Content-Type', videoType(path.extname(f).toLowerCase()));
                res.send(await fs.readFile(path.join(dir, f)));
                return;
            }
        }
        res.status(500).json({ error: friendlyYtError(lastErr) });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    } finally {
        fs.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
});

app.listen(PORT, HOST, () => {
    // Printing the host it actually bound, not the one it probably meant. The old line said
    // "localhost" while binding everything, which is the kind of message that stops anybody from
    // looking further.
    console.log(`[mv-api] project storage listening on http://${HOST}:${PORT}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
        console.log('[mv-api] WARNING: reachable from the network, and there is no authentication.');
    }
});
