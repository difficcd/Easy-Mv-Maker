// Project folders, as paths: "Songs/Chorus", "" for the top. What a project browser shows for a
// folder - the folders directly inside it, the projects in it, the trail back to the top - and,
// for the browser's own storage, how a path changes when a folder is renamed, moved or removed.
// The server keeps its own copies of the last three (server/folders.js), because it runs without
// the TypeScript loader. Everything here works on paths and holds no state.

/** The last part of a folder path: what its card is labelled. */
export const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The folder a folder is in; "" for one at the top. */
export const parentFolder = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** A folder named `name` inside `parent`. */
export const joinFolder = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);

/** Whether `path` is `folder` or somewhere beneath it. */
export const inFolder = (path: string, folder: string): boolean => folder === '' || path === folder || path.startsWith(folder + '/');

/** The folders directly inside `current`, sorted by name. */
export function childFolders(folders: readonly string[], current: string): string[] {
    return folders.filter(f => f !== current && parentFolder(f) === current).sort((a, b) => folderName(a).localeCompare(folderName(b)));
}

/** The projects stored in `current` itself, newest first as the server lists them. */
export function projectsIn<P extends { folder?: string }>(projects: readonly P[], current: string): P[] {
    return projects.filter(p => (p.folder || '') === current);
}

/** The trail from the top to `current`: each folder on the way, with its path. The top is "". */
export function crumbs(current: string): { name: string, path: string }[] {
    const out = [{ name: '', path: '' }];
    if (!current) return out;
    const parts = current.split('/');
    parts.forEach((name, i) => out.push({ name, path: parts.slice(0, i + 1).join('/') }));
    return out;
}

/**
 * A folder path as it is stored: segments trimmed, characters a file manager would refuse
 * removed, empty and dot segments dropped, at most 16 deep. Anything at all comes back valid.
 */
export function normFolder(p: unknown): string {
    return String(p ?? '').split('/')
        .map(seg => seg.replace(/[\\<>:"|?*\u0000-\u001f]/g, '').trim().slice(0, 60))
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .slice(0, 16).join('/');
}

/** `path` with the folder `from` renamed or moved to `to`; any other path unchanged. */
export const movePath = (path: string, from: string, to: string): string =>
    path === from ? to : path.startsWith(from + '/') ? (to ? to + path.slice(from.length) : path.slice(from.length + 1)) : path;

/** Where `path` ends up when the folder `removed` is removed: what was in it moves up a level. */
export const removedPath = (path: string, removed: string): string => movePath(path, removed, parentFolder(removed));

/** Every folder given plus the folders above each one, sorted. */
export function withAncestors(paths: readonly string[]): string[] {
    const all = new Set<string>();
    for (const raw of paths) for (let p = normFolder(raw); p; p = parentFolder(p)) all.add(p);
    return [...all].sort((a, b) => a.localeCompare(b));
}

/** Whether the folder `from` may move into `target`: not into itself or anything inside it, and not where it already is. */
export const canMoveFolder = (from: string, target: string): boolean => !inFolder(target, from) && parentFolder(from) !== target;
