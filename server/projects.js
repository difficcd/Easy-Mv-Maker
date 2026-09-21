// Projects: the JSON documents under server/data/, and the binary assets beside each one.

import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, fileFor, assetsDirFor, newId, ASSET_MIME, AUDIO_MIME, safeId } from './paths.js';

/**
 * The .json files in a directory, summarised, newest first.
 *
 * A file that will not parse is left out rather than failing the whole listing: one corrupt save
 * should not make the project list unopenable.
 *
 * @param {string} dir
 * @param {(name: string, fullPath: string) => Promise<object|null>} summarise
 */
export async function listJsonDir(dir, summarise) {
    const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'));
    const items = await Promise.all(files.map(async f => {
        try { return await summarise(f, path.join(dir, f)); } catch { return null; }
    }));
    return items.filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** @param {import('express').Express} app */
export function projectRoutes(app) {
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


    app.delete('/api/projects/:id', async (req, res) => {
        try {
            await fs.unlink(fileFor(req.params.id)).catch(() => { });
            await fs.rm(assetsDirFor(req.params.id), { recursive: true, force: true }).catch(() => { });
            res.json({ ok: true });
        }
        catch { res.status(404).json({ error: 'not found' }); }
    });
}
