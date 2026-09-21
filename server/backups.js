// Backups: rotating snapshots of a project's JSON, and the pruning of assets nothing retained
// still names.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeId, assetsDirFor, backupDirFor, safeStamp, BACKUP_KEEP } from './paths.js';
import { listJsonDir } from './projects.js';

/** @param {import('express').Express} app */
export function backupRoutes(app) {
    // --- Autosave backups -------------------------------------------------------------------
    // Rotating, timestamped snapshots kept as separate files on disk, so a corrupted or
    // mistakenly overwritten project can be rolled back. Binary assets are NOT copied per
    // snapshot; they live in the shared asset dir for the same key and are referenced by id.

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
}
