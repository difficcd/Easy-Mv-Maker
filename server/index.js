// Tiny project storage API for Easy MV Maker.
// Projects are persisted as JSON files under server/data/ (a simple file-backed DB),
// so saving "to the server" is independent of the browser's local download / file save.
import express from 'express';
import { promises as fs } from 'node:fs';
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
            if (code !== 0) { res.status(500).json({ error: '추출 실패: ' + err.slice(-400) }); return; }
            const files = await fs.readdir(dir);
            if (!files.length) { res.status(500).json({ error: '오디오 파일 없음' }); return; }
            const f = files[0];
            res.setHeader('Content-Type', audioType(path.extname(f).toLowerCase()));
            res.send(await fs.readFile(path.join(dir, f)));
        } catch (e) { res.status(500).json({ error: String(e) }); }
        finally { fs.rm(dir, { recursive: true, force: true }).catch(() => { }); }
    });
});

app.listen(PORT, () => console.log(`[mv-api] project storage listening on http://localhost:${PORT}`));
