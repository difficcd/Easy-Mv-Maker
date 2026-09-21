// Constructors for the pieces of a document.
//
// A cut was written out as a literal in four places - the initial state, a new project, the add
// button and the timeline's click-in-a-gap - and they had drifted: one had no texts array, and
// one took its id from Date.now() rather than nextId, which is the one thing nextId exists to
// guard against (two ids in the same millisecond). One constructor, one shape.

import { mkLayer } from './layerOps.js';
import type { Id } from './types.ts';


/**
 * A cut with one blank layer and no text.
 *
 * @param {{id: number, name: string, startTime: number, endTime: number, track?: number}} args
 */
export function mkCut({ id, name, startTime, endTime, track = 0 }: { id: Id, name: string, startTime: number, endTime: number, track?: number }): Cut {
    return { id, name, startTime, endTime, track, layers: [mkLayer(1)], activeLayerId: 1, texts: [] };
}

/** The cut a new project opens with. */
export const firstCut = () => mkCut({ id: 1, name: 'Cut 1', startTime: 0, endTime: 1, track: 0 });
