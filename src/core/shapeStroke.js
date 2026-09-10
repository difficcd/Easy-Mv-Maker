// Ruler shapes: a rectangle and an ellipse, as points.
//
// Both are returned as an ordinary list of points, which is the whole idea. A shape drawn this
// way is a stroke like any other - it takes the current brush, it erases, it boils with the
// layer, it saves and loads, and it costs the renderer nothing new. A `kind: 'rect'` stroke would
// have needed a branch in every one of those places and a file format that older builds could not
// read.
//
// Both are built from the two corners of the drag, so the caller only ever has to hand over where
// the pointer went down and where it is now.

/** The drag's bounding box, normalised so dragging up or left works the same as down or right. */
function box(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * A rectangle through the two dragged corners, as a closed polyline.
 *
 * Five points, not four: the last repeats the first so the outline closes. Without it the brush
 * leaves a notch at the corner it started from, which is only visible on a thick line and so is
 * exactly the kind of thing that ships.
 *
 * @param {{x: number, y: number}} a where the drag began
 * @param {{x: number, y: number}} b where it is now
 * @returns {{x: number, y: number}[]}
 */
export function rectPoints(a, b) {
    if (!a || !b) return [];
    const { x0, y0, x1, y1 } = box(a, b);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
}

/** How far a chord may sag away from the curve before the polygon starts to show, in pixels. */
const FLATNESS = 0.2;

/**
 * How many segments an ellipse of this size needs.
 *
 * Not a fixed count, and not a fixed segment length either - both get this wrong, in opposite
 * directions. What is actually visible is how far the straight chord sags away from the curve,
 * and that is `c^2 / 8r`: the *same* chord on a bigger circle sags less. Holding the segment
 * length constant therefore over-tessellates large shapes badly - a canvas-sized circle came out
 * with a thousand points to fix a deviation of a hundredth of a pixel.
 *
 * So the chord is solved from the sag instead: `c = sqrt(8 * r * FLATNESS)`.
 *
 * `r` is the *smallest* radius of curvature on the ellipse, which for a squashed one is at the
 * ends of the long axis and is much tighter than the average - the one place a count chosen from
 * the average visibly corners.
 */
function segmentsFor(w, h) {
    const rx = w / 2, ry = h / 2;
    const big = Math.max(rx, ry), small = Math.min(rx, ry);
    // Degenerate drags (a tap, or a perfectly flat one) have no curvature to resolve; the floor
    // below is what they get, and it costs nothing.
    const rMin = big > 0 ? (small * small) / big : 0;
    if (!(rMin > 0)) return 24;
    const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const chord = Math.sqrt(8 * rMin * FLATNESS);
    const n = Math.max(24, Math.min(360, Math.round(perimeter / chord)));
    // Rounded up to a multiple of four so that points land exactly on all four extremes of the
    // ellipse. Otherwise the outline stops a fraction short of the box the user dragged, and the
    // ellipse and the rectangle ruler - which do fill it - disagree about what the drag meant.
    return n + ((4 - (n % 4)) % 4);
}

/**
 * An ellipse inscribed in the two dragged corners, as a closed polyline.
 *
 * Inscribed rather than centred on the first corner, so it fills the same box the rectangle would
 * - which is what makes the two rulers feel like one tool with a shape setting, and what lets a
 * drag be judged by where it ends rather than by guessing outwards from where it started.
 *
 * @param {{x: number, y: number}} a where the drag began
 * @param {{x: number, y: number}} b where it is now
 * @param {number} [segments] override, for tests
 * @returns {{x: number, y: number}[]}
 */
export function ellipsePoints(a, b, segments) {
    if (!a || !b) return [];
    const { x0, y0, w, h } = box(a, b);
    const rx = w / 2, ry = h / 2;
    const cx = x0 + rx, cy = y0 + ry;
    const n = segments || segmentsFor(w, h);
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    // Closed by repeating the first point rather than by relying on the last one landing on it,
    // which floating point does not guarantee.
    pts.push({ ...pts[0] });
    return pts;
}

/** Points for whichever ruler shape is in effect, or null if this tool is not one of them. */
export function shapePoints(etool, a, b) {
    if (etool === 'rect') return rectPoints(a, b);
    if (etool === 'ellipse') return ellipsePoints(a, b);
    return null;
}
