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
