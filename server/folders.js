// Folders for saved projects.
//
// A folder is a path - "Songs/Chorus" - stored on each project as `folder`, "" being the top. It
// is not a directory on disk: moving a project or renaming a folder is then a metadata write, and
// a project's id, its assets and its backups never move. The folder list (FOLDERS_FILE) exists
// only so an empty folder survives; every folder a project names is a folder whether it is listed
// or not.
//
// Nothing here deletes a project. Removing a folder moves what was in it up to its parent.

import { promises as fs } from 'node:fs';
import { FOLDERS_FILE } from './paths.js';

/** Deepest a folder may nest - a brake on a runaway client, not a design limit. */
const MAX_DEPTH = 16;

/**
 * A folder path as it is stored: segments trimmed, characters a file manager would refuse
 * removed, empty segments dropped. Anything at all comes back as a valid path, "" at worst.
 */
export function normFolder(p) {
    return String(p ?? '').split('/')
        .map(seg => seg.replace(/[\<>:"|?*\u0000-\u001f]/g, '').trim().slice(0, 60))
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .slice(0, MAX_DEPTH).join('/');
}

/** The folder a folder is in; "" for one at the top. */
export const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Whether `p` is `folder` or somewhere beneath it. */
export const isInside = (p, folder) => folder === '' || p === folder || p.startsWith(folder + '/');

/** `p` with the folder `from` renamed or moved to `to`; any other path unchanged. */
export const movePath = (p, from, to) => (p === from ? to : p.startsWith(from + '/') ? (to ? to + p.slice(from.length) : p.slice(from.length + 1)) : p);

/** Every folder, with the folders above each one: "a/b" brings "a" with it. Sorted. */
export function withAncestors(paths) {
    const all = new Set();
    for (const raw of paths) {
        for (let p = normFolder(raw); p; p = parentOf(p)) all.add(p);
    }
    return [...all].sort((a, b) => a.localeCompare(b));
}

export async function readFolders() {
    try {
        const list = JSON.parse(await fs.readFile(FOLDERS_FILE, 'utf8'));
        return Array.isArray(list) ? list.map(normFolder).filter(Boolean) : [];
    } catch { return []; }
}

export async function writeFolders(list) {
    const tmp = `${FOLDERS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(withAncestors(list)));
    await fs.rename(tmp, FOLDERS_FILE);
}

/** Where `p` ends up when the folder `removed` is removed: what was in it moves up a level. */
export const removedPath = (p, removed) => movePath(p, removed, parentOf(removed));
