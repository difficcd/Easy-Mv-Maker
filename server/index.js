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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.MV_API_PORT ? Number(process.env.MV_API_PORT) : 8787;

const app = express();
app.use(express.json({ limit: '256mb' })); // projects embed base64 bitmaps, so allow large bodies

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

// List saved projects (metadata only).
app.get('/api/projects', async (_req, res) => {
    try {
        const files = (await fs.readdir(DATA_DIR)).filter(f => f.endsWith('.json'));
        const items = await Promise.all(files.map(async f => {
            try {
                const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8'));
                return { id: f.replace(/\.json$/, ''), name: raw.name || raw.data?.appName || f, savedAt: raw.savedAt || null };
            } catch { return null; }
        }));
        res.json(items.filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))));
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
        const id = newId();
        const name = req.body?.name || 'Untitled';
        const data = req.body?.data ?? req.body;
        await fs.writeFile(fileFor(id), JSON.stringify({ id, name, savedAt: new Date().toISOString(), data }));
        res.json({ id, name });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Overwrite an existing project.
app.put('/api/projects/:id', async (req, res) => {
    try {
        const id = safeId(req.params.id);
        const name = req.body?.name || 'Untitled';
        const data = req.body?.data ?? req.body;
        await fs.writeFile(fileFor(id), JSON.stringify({ id, name, savedAt: new Date().toISOString(), data }));
        res.json({ id, name });
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
        const dir = backupDirFor(_req.params.key);
        const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'));
        const items = await Promise.all(files.map(async f => {
            try {
                const st = await fs.stat(path.join(dir, f));
                const head = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
                return { stamp: f.replace(/\.json$/, ''), name: head.name || 'Untitled', savedAt: head.savedAt || st.mtime.toISOString(), size: st.size };
            } catch { return null; }
        }));
        res.json(items.filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))));
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
    if (!/^https?:\/\//.test(url)) { res.status(400).json({ error: 'invalid url' }); return; }
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
    if (!/^https?:\/\//.test(url)) { res.status(400).json({ error: 'invalid url' }); return; }
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

app.listen(PORT, () => console.log(`[mv-api] project storage listening on http://localhost:${PORT}`));
