// Where things live on disk, and what they are called - the one place a path is built.
//
// Every id that reaches the filesystem goes through safeId first: it is the only defence the
// server has against a path in a project id, and it is here so that no route can forget it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');

export const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
export const fileFor = (id) => path.join(DATA_DIR, `${safeId(id)}.json`);
export const assetsDirFor = (id) => path.join(DATA_DIR, `${safeId(id)}.assets`);
export const newId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const ASSET_MIME = {
    webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
    webm: 'video/webm', mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime',
};
// webm/mp4/ogg are ambiguous (audio vs video) — the asset id tells us which.
export const AUDIO_MIME = { webm: 'audio/webm', mp4: 'audio/mp4', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', opus: 'audio/ogg', wav: 'audio/wav' };
export const BACKUP_KEEP = 12;
export const backupDirFor = (key) => path.join(DATA_DIR, `${safeId(key)}.backups`);
export const safeStamp = (s) => String(s).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 40);
/** Content type for an extracted audio file, by extension. */
export const audioType = (ext) => ({ '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.opus': 'audio/ogg', '.ogg': 'audio/ogg' }[ext] || 'application/octet-stream');
/** Content type for a downloaded video file, by extension. */
export const videoType = (ext) => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime' }[ext] || 'video/mp4');
