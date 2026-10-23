// Projects: the JSON documents under server/data/, and the binary assets beside each one.

import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, fileFor, assetsDirFor, thumbFor, newId, ASSET_MIME, AUDIO_MIME, safeId } from './paths.js';
import { normFolder, parentOf, isInside, movePath, removedPath, withAncestors, readFolders, writeFolders } from './folders.js';
import { sendError } from './errors.js';

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

/** A project file, parsed, or null when there is none. */
async function readProject(id) {
    try { return JSON.parse(await fs.readFile(fileFor(id), 'utf8')); } catch { return null; }
}

/** Write a parsed project file back: temp file then rename, as every project write is. */
async function storeProject(id, raw) {
    const target = fileFor(id), tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(raw));
    await fs.rename(tmp, target);
}

/** Every project's id and folder - what a folder rename or removal has to walk. */
async function projectFolders() {
    return listJsonDir(DATA_DIR, async (f, full) => {
        const raw = JSON.parse(await fs.readFile(full, 'utf8'));
        return { id: f.replace(/\.json$/, ''), folder: normFolder(raw.folder), savedAt: raw.savedAt || null };
    });
}

/**
 * Move every project and listed folder at or under `from` to the same place under `to`.
 * Renaming a folder, moving it, and removing it (to its parent) are all this.
 */
async function moveFolder(from, to) {
    for (const p of await projectFolders()) {
        if (!isInside(p.folder, from)) continue;
        const raw = await readProject(p.id);
        if (raw) await storeProject(p.id, { ...raw, folder: movePath(p.folder, from, to) });
    }
    await writeFolders((await readFolders()).map(f => movePath(f, from, to)));
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
        //
        // The folder is kept across an overwrite: saving again must not move the project back to
        // the top. A new project goes where the client says - the folder open in the browser.
        const before = await readProject(id);
        const folder = normFolder(req.body?.folder ?? before?.folder ?? '');
        await storeProject(id, { id, name, folder, savedAt: new Date().toISOString(), data });
        res.json({ id, name, folder });
    }

    // List saved projects (metadata only).
    app.get('/api/projects', async (_req, res) => {
        try {
            res.json(await listJsonDir(DATA_DIR, async (f, full) => {
                const raw = JSON.parse(await fs.readFile(full, 'utf8'));
                const id = f.replace(/\.json$/, '');
                const thumb = await fs.stat(thumbFor(id)).then(() => true, () => false);
                return { id, name: raw.name || raw.data?.appName || f, savedAt: raw.savedAt || null, folder: normFolder(raw.folder), thumb };
            }));
        } catch (e) { sendError(res, e, 'GET /api/projects'); }
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
        } catch (e) { sendError(res, e, 'POST /api/projects'); }
    });

    // Overwrite an existing project.
    app.put('/api/projects/:id', async (req, res) => {
        try {
            await writeProject(req.params.id, req, res);
        } catch (e) { sendError(res, e, 'PUT /api/projects/:id'); }
    });

    // Rename a project or move it to another folder. Only the metadata changes: the drawing, the
    // saved time and the assets stay as they were.
    app.patch('/api/projects/:id', async (req, res) => {
        try {
            const id = safeId(req.params.id), raw = await readProject(id);
            if (!raw) { res.status(404).json({ error: 'not found' }); return; }
            const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 120) : raw.name;
            const folder = req.body?.folder !== undefined ? normFolder(req.body.folder) : normFolder(raw.folder);
            await storeProject(id, { ...raw, name, folder });
            res.json({ id, name, folder });
        } catch (e) { sendError(res, e, 'PATCH /api/projects/:id'); }
    });

    // The preview: a small image of the frame open when the project was saved, rendered by the
    // client (the server draws nothing) and kept beside the project file.
    app.put('/api/projects/:id/thumb', express.raw({ type: 'image/*', limit: '4mb' }), async (req, res) => {
        try {
            if (!await readProject(req.params.id)) { res.status(404).json({ error: 'not found' }); return; }
            if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: 'no image' }); return; }
            await fs.writeFile(thumbFor(req.params.id), req.body);
            res.json({ ok: true });
        } catch (e) { sendError(res, e, 'PUT /api/projects/:id/thumb'); }
    });
    app.get('/api/projects/:id/thumb', async (req, res) => {
        try {
            const buf = await fs.readFile(thumbFor(req.params.id));
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'no-cache');
            res.send(buf);
        } catch { res.status(404).json({ error: 'not found' }); }
    });

    // Folders: every folder a project names, every folder created empty, and the folders above them.
    app.get('/api/folders', async (_req, res) => {
        try {
            res.json(withAncestors([...await readFolders(), ...(await projectFolders()).map(p => p.folder)]));
        } catch (e) { sendError(res, e, 'GET /api/folders'); }
    });
    app.post('/api/folders', async (req, res) => {
        try {
            const p = normFolder(req.body?.path);
            if (!p) { res.status(400).json({ error: 'no folder name' }); return; }
            await writeFolders([...await readFolders(), p]);
            res.json({ path: p });
        } catch (e) { sendError(res, e, 'POST /api/folders'); }
    });
    // Rename or move a folder, with everything in it. A folder cannot go inside itself.
    app.patch('/api/folders', async (req, res) => {
        try {
            const from = normFolder(req.body?.from), to = normFolder(req.body?.to);
            if (!from || !to) { res.status(400).json({ error: 'from and to are both needed' }); return; }
            if (to !== from && isInside(to, from)) { res.status(400).json({ error: 'a folder cannot go inside itself' }); return; }
            if (to !== from) await moveFolder(from, to);
            res.json({ path: to });
        } catch (e) { sendError(res, e, 'PATCH /api/folders'); }
    });
    // Remove a folder. Nothing in it is deleted: its projects and folders move up to its parent.
    app.delete('/api/folders', async (req, res) => {
        try {
            const p = normFolder(req.query.path);
            if (!p) { res.status(400).json({ error: 'no folder' }); return; }
            const up = parentOf(p);
            for (const pr of await projectFolders()) {
                if (!isInside(pr.folder, p)) continue;
                const raw = await readProject(pr.id);
                if (raw) await storeProject(pr.id, { ...raw, folder: removedPath(pr.folder, p) });
            }
            await writeFolders((await readFolders()).filter(f => f !== p).map(f => removedPath(f, p)));
            res.json({ ok: true, parent: up });
        } catch (e) { sendError(res, e, 'DELETE /api/folders'); }
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
        } catch (e) { sendError(res, e, 'PUT /api/projects/:id/asset/:assetId'); }
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
        } catch (e) { sendError(res, e, 'GET /api/projects/:id/assets'); }
    });


    app.delete('/api/projects/:id', async (req, res) => {
        try {
            await fs.unlink(fileFor(req.params.id)).catch(() => { });
            await fs.rm(assetsDirFor(req.params.id), { recursive: true, force: true }).catch(() => { });
            await fs.unlink(thumbFor(req.params.id)).catch(() => { });
            res.json({ ok: true });
        }
        catch { res.status(404).json({ error: 'not found' }); }
    });
}
