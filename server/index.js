// Tiny project storage API for Easy MV Maker.
// Projects are persisted as JSON files under server/data/ (a simple file-backed DB),
// so saving "to the server" is independent of the browser's local download / file save.
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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

app.listen(PORT, () => console.log(`[mv-api] project storage listening on http://localhost:${PORT}`));
