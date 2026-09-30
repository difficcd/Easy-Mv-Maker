// Small geometry, and the one array helper everything reaches for.

import type { Point } from './types.ts';

export function pointInPolygon(point: readonly number[], vs: ReadonlyArray<readonly number[]>): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i];
        const [xj, yj] = vs[j];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

export function dist(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

export function safeArray<T = any>(v: unknown): T[] {
    return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * The pixel box a stroke's ink can occupy: its points, grown by `pad`, clamped to the canvas.
 *
 * `pad` is what the drawing adds beyond the path itself - half the widest line, plus whatever
 * the brush scatters past that. Too small clips the stroke; too large only costs area, so the
 * callers round up.
 *
 * Integers, because it sizes a canvas and offsets a blit: left and top round down, right and
 * bottom round up, so a stroke is never cut by a fraction of a pixel.
 *
 * Null when there is nothing to draw - no points, or a box clamped away to nothing off-canvas -
 * so the caller can skip the work entirely rather than allocating a zero-sized scratch.
 */
export function inkBounds(points: readonly Point[] | null | undefined, pad: number, w: number, h: number): { x: number, y: number, w: number, h: number } | null {
    if (!Array.isArray(points) || !points.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return null;
    const g = Math.max(0, pad);
    const x = Math.max(0, Math.floor(minX - g));
    const y = Math.max(0, Math.floor(minY - g));
    const right = Math.min(w, Math.ceil(maxX + g));
    const bottom = Math.min(h, Math.ceil(maxY + g));
    const bw = right - x, bh = bottom - y;
    return bw > 0 && bh > 0 ? { x, y, w: bw, h: bh } : null;
}
