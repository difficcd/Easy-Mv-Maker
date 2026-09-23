// The artwork and the picture that comes out of it, as two sizes rather than one.
//
// Everywhere else in the app `cw`/`ch` means both: the surface you draw on and the size of the
// exported video. That is why core/camera says, in its own header, that a pan at zoom 1 shows the
// edge of the artwork - there is nothing outside the canvas, so every pan preset has to zoom in
// first and pan within what the zoom buys. The move is always a crop of one still picture.
//
// #327 asks for the other thing: draw a long background, and let the camera travel across it.
// That needs two sizes. The **canvas** is the artwork, as wide as it wants to be. The **frame**
// is what the camera sees and what the file is - normally 1920x1080 however long the canvas is.
//
// A document that never sets a frame has frame == canvas, which is every project that exists
// today, and every function here is the identity in that case. That is the point: this module
// can go in ahead of the UI and the render path, and prove it changes nothing while it does.
//
// Coordinates: the canvas is the coordinate system, origin at its top-left. A camera centre is a
// point in it. The frame is not a coordinate system - it is a window's size, and where it sits is
// exactly what the camera centre says.

import type { Point } from './types.ts';

/** The artwork's size and the output picture's size, in pixels. */
export interface FrameGeometry {
    /** the artwork */
    cw: number; ch: number;
    /** the picture that comes out */
    fw: number; fh: number;
}
/** How far the camera's centre may travel and still see only artwork. Empty on an axis means centred. */
export interface CameraBounds { minX: number; maxX: number; minY: number; maxY: number }

/** A size that can be used: finite, positive, whole. Junk from a loaded document lands here. */
const size = (v: unknown, fallback: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * The geometry of a document, with the frame defaulting to the canvas.
 *
 * Reading it through here rather than off the document is what makes the default free: an old
 * project has no frame fields, gets frame == canvas, and behaves as it always did.
 *
 * @param cw @param ch the artwork
 * @param frame the document's frame, if it has set one
 */
export function frameGeometry(cw: number, ch: number, frame?: { w?: number, h?: number } | null): FrameGeometry {
    const w = size(cw, 1920), h = size(ch, 1080);
    return { cw: w, ch: h, fw: size(frame?.w, w), fh: size(frame?.h, h) };
}

/**
 * Whether there is anywhere to go: artwork outside the frame on at least one axis.
 *
 * The question worth asking before offering a camera move, and the one the pan presets will ask
 * to decide whether they need to zoom in to make room or already have it.
 */
export function hasRoom(g: FrameGeometry): boolean {
    return g.cw > g.fw || g.ch > g.fh;
}

/**
 * The zoom at which the whole canvas is visible inside the frame.
 *
 * Below 1 when the canvas is bigger, which is the case this exists for: it is what an editor's
 * "show me the whole thing" does, and what a camera would have to be set to to shoot the lot.
 */
export function fitZoom(g: FrameGeometry): number {
    return Math.min(g.fw / g.cw, g.fh / g.ch);
}

/**
 * How much canvas the frame covers at a zoom: the window, in canvas pixels.
 *
 * Zoom is the frame's magnification, so a zoom of 2 shows half as much artwork. Guarded against
 * zero and against nonsense, because it divides and because zoom arrives from a saved document.
 */
export function windowSize(g: FrameGeometry, zoom: number): { w: number, h: number } {
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    return { w: g.fw / z, h: g.fh / z };
}

/**
 * Where the camera's centre may sit without the frame running off the artwork.
 *
 * On an axis where the window is wider than the artwork there is no such position - whatever you
 * do, blank paper shows on both sides - so the interval collapses to the middle of the canvas and
 * min equals max. Callers do not need to special-case that: clamping to a collapsed interval
 * centres, which is the right answer anyway.
 */
export function cameraBounds(g: FrameGeometry, zoom: number): CameraBounds {
    const { w, h } = windowSize(g, zoom);
    const span = (canvas: number, window: number) => {
        const half = window / 2;
        // Wider than the artwork: nowhere to hide the edges, so sit in the middle.
        if (window >= canvas) return [canvas / 2, canvas / 2] as const;
        return [half, canvas - half] as const;
    };
    const [minX, maxX] = span(g.cw, w);
    const [minY, maxY] = span(g.ch, h);
    return { minX, maxX, minY, maxY };
}

/**
 * The nearest camera centre that shows only artwork.
 *
 * Applied to a drawn path and to a preset alike, so a move that overshoots the edge slides along
 * it instead of showing blank paper. That is a better failure than refusing the move: the camera
 * still travels, it just stops at the wall.
 */
export function clampCameraCentre(p: Point, g: FrameGeometry, zoom: number): Point {
    const b = cameraBounds(g, zoom);
    const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
    return { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) };
}

/** The middle of the artwork: where a camera that has not been told otherwise looks. */
export function restingCentre(g: FrameGeometry): Point {
    return { x: g.cw / 2, y: g.ch / 2 };
}

/**
 * Where the frame's top-left sits in canvas coordinates, for a camera at `centre` and `zoom`.
 *
 * What a renderer needs to place the window, and what a UI needs to draw the frame guide over the
 * artwork while editing.
 */
export function frameRect(g: FrameGeometry, centre: Point, zoom: number): { x: number, y: number, w: number, h: number } {
    const { w, h } = windowSize(g, zoom);
    return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
}
