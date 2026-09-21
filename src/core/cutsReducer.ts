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

import { offsetLayers, mergeDown } from './layerOps.ts';
import { assignPart, renamePartIn, ungroupPartIn, removeVideoBatch } from './partOps.ts';
import { CAMERA_DEFAULT } from './camera.ts';
import { ANIM_DEFAULT } from './cutAnim.ts';
import { safeArray } from './geometry.ts';
import { LAYER_ANIM_DEFAULT } from './layerAnim.ts';
import type { Id } from './types.ts';
import type { CutAnimSettings } from './cutAnim.ts';
import type { CameraSettings } from './camera.ts';
import type { LayerAnimSettings } from './layerAnim.ts';

// ── action creators ────────────────────────────────────────────────────────

/** Replace the whole document: opening a file, undo/redo, starting over. */
export const replaceCuts = (cuts: Cut[]) => ({ type: 'replaceCuts' as const, cuts });
/** Append cuts: a new cut, a tween, an imported video's frames. */
export const addCuts = (cuts: Cut[]) => ({ type: 'addCuts' as const, cuts });
/** Change fields on one cut (name, start/end time, track, activeLayerId). */
export const updateCut = (cutId: Id, patch: Partial<Cut>) => ({ type: 'updateCut' as const, cutId, patch });
/** Merge into a cut's animation, over the defaults. */
export const setCutAnim = (cutId: Id, patch: Partial<CutAnimSettings>) => ({ type: 'setCutAnim' as const, cutId, patch });
/**
 * Merge into a cut's camera move. Passing null clears it, which is not the same as setting every
 * field back to its default: the renderer skips the transform entirely when there is no camera
 * object at all, and that is the state every existing project is in.
 */
export const setCutCamera = (cutId: Id, patch: Partial<CameraSettings> | null) => ({ type: 'setCutCamera' as const, cutId, patch });
/** Empty a cut's drawing and text, keeping its layers. */
export const clearCut = (cutId: Id) => ({ type: 'clearCut' as const, cutId });

/** Change fields on one layer. */
export const updateLayer = (cutId: Id, layerId: Id, patch: Partial<Layer>) => ({ type: 'updateLayer' as const, cutId, layerId, patch });
/**
 * Clip a layer to the one below it, or stop clipping.
 *
 * No rev bump: clipping changes how the layer is composited, not what is drawn on it, so its own
 * cached canvas is still correct. What has to be invalidated is the frame, and paintFrame already
 * re-runs when cuts change.
 */
export const setLayerClipped = (cutId: Id, layerId: Id, clipped: boolean) => ({ type: 'setLayerClipped' as const, cutId, layerId, clipped });
/** Merge into a layer's animation, over the defaults. */
export const setLayerAnim = (cutId: Id, layerId: Id, patch: Partial<LayerAnimSettings>) => ({ type: 'setLayerAnim' as const, cutId, layerId, patch });
/** Flatten a layer into the one below it. */
export const mergeLayerDown = (cutId: Id, layerId: Id, flattenVisibleLeaves: (layers: Layer[]) => Layer[]) => ({ type: 'mergeLayerDown' as const, cutId, layerId, flattenVisibleLeaves });
/** Shift whole layers (and optionally the cut's texts) by a pixel offset. Bumps rev. */
export const moveLayers = (cutId: Id, layerIds: Iterable<Id>, dx: number, dy: number) => ({ type: 'moveLayers' as const, cutId, layerIds, dx, dy });

/** Add a text if it is new, otherwise update it in place. */
export const upsertText = (cutId: Id, text: CutText) => ({ type: 'upsertText' as const, cutId, text });
/** Move a text to an absolute position. */
export const moveText = (cutId: Id, textId: Id, x: number, y: number) => ({ type: 'moveText' as const, cutId, textId, x, y });
export const deleteText = (cutId: Id, textId: Id) => ({ type: 'deleteText' as const, cutId, textId });
export const toggleTextVisible = (cutId: Id, textId: Id) => ({ type: 'toggleTextVisible' as const, cutId, textId });

export const assignPartTo = (cutIds: Iterable<Id>, partId: Id, name: string) => ({ type: 'assignPartTo' as const, cutIds, partId, name });
export const renamePart = (partId: Id, name: string) => ({ type: 'renamePart' as const, partId, name });
export const ungroupPart = (partId: Id) => ({ type: 'ungroupPart' as const, partId });
export const removeBatch = (batchId: Id) => ({ type: 'removeBatch' as const, batchId });

/**
 * Insert cuts at a point on a track, pushing everything later on that track along to make room.
 * Duplicating a cut and filling a gap with tweened frames are the same operation.
 */
export const insertCutsShifting = (track: number, at: number, shift: number, newCuts: Cut[], exceptId?: Id | null) =>
    ({ type: 'insertCutsShifting' as const, track, at, shift, newCuts, exceptId });
/** Delete a track, closing the gap by pulling every track below it up one. */
export const deleteTrack = (track: number) => ({ type: 'deleteTrack' as const, track });
/** Move several cuts together, keeping their relative layout and staying in bounds. */
export const moveCutGroup = (group: Cut[], dt: number, trackOff: number, numTracks: number) => ({ type: 'moveCutGroup' as const, group, dt, trackOff, numTracks });
/** Replace the cuts imported from one video source with a fresh set. */
export const replaceBatchCuts = (videoSrc: string | undefined, newCuts: Cut[]) => ({ type: 'replaceBatchCuts' as const, videoSrc, newCuts });

/** Escape hatch: run a function over one cut. Prefer a named action. */
export const patchCut = (cutId: Id, fn: (cut: Cut) => Partial<Cut>) => ({ type: 'patchCut' as const, cutId, fn });
/** Escape hatch: run a function over the whole list. Prefer a named action. */
export const patchCuts = (fn: (cuts: Cut[]) => Cut[]) => ({ type: 'patchCuts' as const, fn });

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Every action the reducer takes: the union of what the creators build. A case that reads a
 * field its creator does not set is a type error, which is what a reducer is for.
 */
export type CutsAction =
    | ReturnType<typeof replaceCuts>
    | ReturnType<typeof addCuts>
    | ReturnType<typeof updateCut>
    | ReturnType<typeof setCutAnim>
    | ReturnType<typeof setCutCamera>
    | ReturnType<typeof clearCut>
    | ReturnType<typeof updateLayer>
    | ReturnType<typeof setLayerClipped>
    | ReturnType<typeof setLayerAnim>
    | ReturnType<typeof mergeLayerDown>
    | ReturnType<typeof moveLayers>
    | ReturnType<typeof upsertText>
    | ReturnType<typeof moveText>
    | ReturnType<typeof deleteText>
    | ReturnType<typeof toggleTextVisible>
    | ReturnType<typeof assignPartTo>
    | ReturnType<typeof renamePart>
    | ReturnType<typeof ungroupPart>
    | ReturnType<typeof removeBatch>
    | ReturnType<typeof insertCutsShifting>
    | ReturnType<typeof deleteTrack>
    | ReturnType<typeof moveCutGroup>
    | ReturnType<typeof replaceBatchCuts>
    | ReturnType<typeof patchCut>
    | ReturnType<typeof patchCuts>;

const mapCut = (cuts: Cut[], cutId: Id, fn: (cut: Cut) => Cut): Cut[] => cuts.map(c => c.id === cutId ? fn(c) : c);
const mapLayer = (cut: Cut, layerId: Id, fn: (layer: Layer) => Layer): Cut => ({ ...cut, layers: safeArray(cut.layers).map(l => l.id === layerId ? fn(l) : l) });
const mapTexts = (cut: Cut, fn: (texts: CutText[]) => CutText[]): Cut => ({ ...cut, texts: fn(safeArray(cut.texts)) });

// ── the reducer ────────────────────────────────────────────────────────────

export function cutsReducer(cuts: Cut[] | null | undefined, action: CutsAction): Cut[] {
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
        case 'setCutCamera':
            return mapCut(list, action.cutId, c => (
                action.patch === null
                    ? { ...c, camera: null }
                    : { ...c, camera: { ...CAMERA_DEFAULT, ...c.camera, ...action.patch } }
            ));
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
        case 'setLayerClipped':
            return mapCut(list, action.cutId, c => ({
                ...c,
                layers: c.layers.map(l => (l.id === action.layerId ? { ...l, clipped: !!action.clipped } : l)),
            }));
        case 'setLayerAnim':
            return mapCut(list, action.cutId, c => mapLayer(c, action.layerId,
                l => ({ ...l, anim: { ...LAYER_ANIM_DEFAULT, ...l.anim, ...action.patch } })));
        case 'moveLayers':
            // offsetLayers bumps rev, which is what stops the cached canvas drawing the layer at
            // its old position: only coordinates changed, and the cache signature cannot see that.
            return mapCut(list, action.cutId, c => ({ ...c, ...offsetLayers(c, action.layerIds, action.dx, action.dy) }));

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
            const byId = new Map<Id, Cut>(group.map(g => [g.id, g]));
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
