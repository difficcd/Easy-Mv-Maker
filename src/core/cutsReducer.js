// The cuts state, as a reducer.
//
// `cuts` is the document: everything the user has drawn, arranged and animated. It was changed
// from forty-odd places, each passing its own lambda to setCuts, so "what can happen to a cut"
// had no answer short of reading all of them. This gives that a vocabulary.
//
// Two things this buys beyond tidiness:
//
//  - Invariants can be enforced in one place. A change that moves coordinates without changing
//    the number of strokes is invisible to the cached canvas signature, so it has to bump the
//    layer's `rev` or the canvas keeps drawing the old positions. Remembering that at every call
//    site is how it gets forgotten; here it is part of the action.
//  - The transitions are pure, so they can be tested without a browser. Everything below takes
//    the current cuts and returns the next ones.
//
// Actions are built by the exported creators rather than written as object literals, so a
// mistyped action name is a missing function - a type error - instead of a silent no-op.
//
// `patchCut` remains for the handful of operations that are genuinely one-off. Reach for a named
// action first; a lambda here is a note that something has not been given a name yet.

import { offsetLayers, mergeDown } from './layerOps.js';
import { assignPart, renamePartIn, ungroupPartIn, removeVideoBatch } from './partOps.js';
import { ANIM_DEFAULT, LAYER_ANIM_DEFAULT, safeArray } from '../canvas/canvasUtils.js';

// ── action creators ────────────────────────────────────────────────────────

/** Replace the whole document: opening a file, undo/redo, starting over. */
export const replaceCuts = (cuts) => ({ type: 'replaceCuts', cuts });
/** Append cuts: a new cut, a tween, an imported video's frames. */
export const addCuts = (cuts) => ({ type: 'addCuts', cuts });
/** Change fields on one cut (name, start/end time, track, activeLayerId). */
export const updateCut = (cutId, patch) => ({ type: 'updateCut', cutId, patch });
/** Merge into a cut's animation, over the defaults. */
export const setCutAnim = (cutId, patch) => ({ type: 'setCutAnim', cutId, patch });
/** Empty a cut's drawing and text, keeping its layers. */
export const clearCut = (cutId) => ({ type: 'clearCut', cutId });

/** Change fields on one layer. */
export const updateLayer = (cutId, layerId, patch) => ({ type: 'updateLayer', cutId, layerId, patch });
/** Merge into a layer's animation, over the defaults. */
export const setLayerAnim = (cutId, layerId, patch) => ({ type: 'setLayerAnim', cutId, layerId, patch });
/** Flatten a layer into the one below it. */
export const mergeLayerDown = (cutId, layerId, flattenVisibleLeaves) => ({ type: 'mergeLayerDown', cutId, layerId, flattenVisibleLeaves });
/** Shift whole layers (and optionally the cut's texts) by a pixel offset. Bumps rev. */
export const moveLayers = (cutId, layerIds, dx, dy, withTexts) => ({ type: 'moveLayers', cutId, layerIds, dx, dy, withTexts });

/** Add a text if it is new, otherwise update it in place. */
export const upsertText = (cutId, text) => ({ type: 'upsertText', cutId, text });
/** Move a text to an absolute position. */
export const moveText = (cutId, textId, x, y) => ({ type: 'moveText', cutId, textId, x, y });
export const deleteText = (cutId, textId) => ({ type: 'deleteText', cutId, textId });
export const toggleTextVisible = (cutId, textId) => ({ type: 'toggleTextVisible', cutId, textId });

export const assignPartTo = (cutIds, partId, name) => ({ type: 'assignPartTo', cutIds, partId, name });
export const renamePart = (partId, name) => ({ type: 'renamePart', partId, name });
export const ungroupPart = (partId) => ({ type: 'ungroupPart', partId });
export const removeBatch = (batchId) => ({ type: 'removeBatch', batchId });

/**
 * Insert cuts at a point on a track, pushing everything later on that track along to make room.
 * Duplicating a cut and filling a gap with tweened frames are the same operation.
 */
export const insertCutsShifting = (track, at, shift, newCuts, exceptId) =>
    ({ type: 'insertCutsShifting', track, at, shift, newCuts, exceptId });
/** Delete a track, closing the gap by pulling every track below it up one. */
export const deleteTrack = (track) => ({ type: 'deleteTrack', track });
/** Move several cuts together, keeping their relative layout and staying in bounds. */
export const moveCutGroup = (group, dt, trackOff, numTracks) => ({ type: 'moveCutGroup', group, dt, trackOff, numTracks });
/** Replace the cuts imported from one video source with a fresh set. */
export const replaceBatchCuts = (videoSrc, newCuts) => ({ type: 'replaceBatchCuts', videoSrc, newCuts });

/** Escape hatch: run a function over one cut. Prefer a named action. */
export const patchCut = (cutId, fn) => ({ type: 'patchCut', cutId, fn });
/** Escape hatch: run a function over the whole list. Prefer a named action. */
export const patchCuts = (fn) => ({ type: 'patchCuts', fn });

// ── helpers ────────────────────────────────────────────────────────────────

const mapCut = (cuts, cutId, fn) => cuts.map(c => c.id === cutId ? fn(c) : c);
const mapLayer = (cut, layerId, fn) => ({ ...cut, layers: safeArray(cut.layers).map(l => l.id === layerId ? fn(l) : l) });
const mapTexts = (cut, fn) => ({ ...cut, texts: fn(safeArray(cut.texts)) });

// ── the reducer ────────────────────────────────────────────────────────────

export function cutsReducer(cuts, action) {
    const list = Array.isArray(cuts) ? cuts : [];
    switch (action.type) {
        case 'replaceCuts':
            return Array.isArray(action.cuts) ? action.cuts : [];
        case 'addCuts':
            return [...list, ...safeArray(action.cuts)];

        case 'updateCut':
            return mapCut(list, action.cutId, c => ({ ...c, ...action.patch }));
        case 'setCutAnim':
            return mapCut(list, action.cutId, c => ({ ...c, anim: { ...ANIM_DEFAULT, ...c.anim, ...action.patch } }));
        case 'clearCut':
            // The layers stay - emptying a cut is not deleting its structure - but everything
            // drawn on them goes, redo included, since those strokes can no longer be restored
            // onto anything the user can see.
            return mapCut(list, action.cutId, c => ({
                ...c,
                texts: [],
                layers: safeArray(c.layers).map(l => l.type === 'layer' ? { ...l, strokes: [], redoStrokes: [] } : l),
            }));

        case 'updateLayer':
            return mapCut(list, action.cutId, c => mapLayer(c, action.layerId, l => ({ ...l, ...action.patch })));
        case 'setLayerAnim':
            return mapCut(list, action.cutId, c => mapLayer(c, action.layerId,
                l => ({ ...l, anim: { ...LAYER_ANIM_DEFAULT, ...l.anim, ...action.patch } })));
        case 'moveLayers':
            // offsetLayers bumps rev, which is what stops the cached canvas drawing the layer at
            // its old position: only coordinates changed, and the cache signature cannot see that.
            return mapCut(list, action.cutId, c => ({ ...c, ...offsetLayers(c, action.layerIds, action.dx, action.dy, action.withTexts) }));

        case 'mergeLayerDown':
            return mapCut(list, action.cutId, c => {
                const merged = mergeDown(c.layers, action.layerId, action.flattenVisibleLeaves);
                // null means there was nothing underneath to merge into; leaving the cut alone is
                // better than silently deleting the layer.
                return merged ? { ...c, ...merged } : c;
            });

        case 'upsertText':
            return mapCut(list, action.cutId, c => mapTexts(c, texts =>
                texts.some(t => t.id === action.text.id)
                    ? texts.map(t => t.id === action.text.id ? { ...t, ...action.text } : t)
                    : [...texts, action.text]));
        case 'moveText':
            return mapCut(list, action.cutId, c => mapTexts(c, texts =>
                texts.map(t => t.id === action.textId ? { ...t, x: action.x, y: action.y } : t)));
        case 'deleteText':
            return mapCut(list, action.cutId, c => mapTexts(c, texts => texts.filter(t => t.id !== action.textId)));
        case 'toggleTextVisible':
            // Absent counts as visible, so the first toggle has to hide rather than show.
            return mapCut(list, action.cutId, c => mapTexts(c, texts =>
                texts.map(t => t.id === action.textId ? { ...t, visible: t.visible === false } : t)));

        case 'assignPartTo':
            return assignPart(list, action.cutIds, action.partId, action.name);
        case 'renamePart':
            return renamePartIn(list, action.partId, action.name);
        case 'ungroupPart':
            return ungroupPartIn(list, action.partId);
        case 'removeBatch':
            return removeVideoBatch(list, action.batchId);

        case 'insertCutsShifting': {
            const { track, at, shift, exceptId } = action;
            // The epsilon keeps a cut that starts exactly where the new ones end from being left
            // behind by floating-point noise in the times.
            const shifted = list.map(c => (c.track === track && c.id !== exceptId && c.startTime >= at - 1e-9)
                ? { ...c, startTime: c.startTime + shift, endTime: c.endTime + shift }
                : c);
            return [...shifted, ...safeArray(action.newCuts)];
        }
        case 'deleteTrack':
            return list
                .filter(c => c.track !== action.track)
                .map(c => c.track > action.track ? { ...c, track: c.track - 1 } : c);
        case 'moveCutGroup': {
            const group = safeArray(action.group);
            if (!group.length) return list;
            // Clamped as a group, not per cut: the whole selection stops when its leading edge
            // reaches t=0 or its outermost cut reaches the last track, so the layout is kept.
            const minStart = Math.min(...group.map(g => g.startTime));
            const minTrack = Math.min(...group.map(g => g.track));
            const maxTrack = Math.max(...group.map(g => g.track));
            const dt = Math.max(action.dt, -minStart);
            const trackOff = Math.max(-minTrack, Math.min(action.numTracks - 1 - maxTrack, action.trackOff));
            const byId = new Map(group.map(g => [g.id, g]));
            return list.map(c => {
                const g = byId.get(c.id);
                if (!g) return c;
                const start = Math.max(0, g.startTime + dt);
                return { ...c, startTime: start, endTime: start + (g.endTime - g.startTime), track: g.track + trackOff };
            });
        }
        case 'replaceBatchCuts':
            return [...list.filter(c => c.videoSrc !== action.videoSrc), ...safeArray(action.newCuts)];

        case 'patchCut':
            return mapCut(list, action.cutId, c => ({ ...c, ...action.fn(c) }));
        case 'patchCuts':
            return action.fn(list);

        default:
            // An unknown action leaves the document alone rather than blanking it, which is the
            // difference between a bug and a lost afternoon of work.
            return list;
    }
}
