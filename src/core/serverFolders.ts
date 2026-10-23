// What the server project browser shows for a folder: the folders directly inside it, the
// projects in it, and the trail back to the top. The server stores a folder as a path on each
// project ("Songs/Chorus", "" for the top - server/folders.js); everything here works on those
// paths and holds no state.

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

/** Whether the folder `from` may move into `target`: not into itself or anything inside it, and not where it already is. */
export const canMoveFolder = (from: string, target: string): boolean => !inFolder(target, from) && parentFolder(from) !== target;
