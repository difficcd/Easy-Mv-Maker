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
const newId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

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

app.delete('/api/projects/:id', async (req, res) => {
    try { await fs.unlink(fileFor(req.params.id)); res.json({ ok: true }); }
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
