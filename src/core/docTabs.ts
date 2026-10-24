// Rules for the document tabs that do not need React: whether a tab holds anything worth a tab of
// its own, and what "where this document saves to" consists of.

import { safeArray } from './geometry.ts';

/**
 * Where an open document saves to: the file it came from, its browser-storage record, its server
 * project. One per tab. While these were one set for the whole app, a project opened in a second
 * tab took them over, and saving in the first tab wrote the first tab's drawing over the second
 * tab's project.
 */
export interface DocIdentity {
    fileHandle: any;
    localId: string | null;
    localName: string;
    serverId: string | null;
    serverName: string;
}

/** A document nothing is saved to - a new tab. */
export const BLANK_IDENTITY: DocIdentity = { fileHandle: null, localId: null, localName: '', serverId: null, serverName: '' };

/** Whether a document saves anywhere at all. */
export const hasIdentity = (id: DocIdentity): boolean => !!(id.fileHandle || id.localId || id.serverId);

/**
 * Whether a document is as a new tab leaves it: one cut, nothing drawn, no text, no audio or video.
 * Opening a project into such a tab replaces it rather than adding another, the way a drawing app
 * reuses its untitled blank canvas.
 */
export function isBlankDocument(data: any): boolean {
    if (!data || !Array.isArray(data.cuts)) return true;
    if (data.audio || data.video) return false;
    if (data.cuts.length > 1) return false;
    return !data.cuts.some((c: any) => safeArray<any>(c.layers).some(l => safeArray(l.strokes).length) || safeArray(c.texts).length);
}
