import test from 'node:test';
import assert from 'node:assert/strict';
import { drawMarquee, drawHandle, HANDLE_PX, HANDLE_GRAB_PX } from '../../src/canvas/marquee.js';

/** Records widths and dash patterns at each stroke, which is all the marquee is about. */
function fakeCtx() {
    const strokes = [];
    const c = {
        lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: '', lineJoin: '', dash: [],
        save() { }, restore() { }, beginPath() { }, closePath() { c.closed = true; }, moveTo() { }, lineTo() { }, rect() { }, fill() { },
        setLineDash(d) { c.dash = d; },
        stroke() { strokes.push({ width: c.lineWidth, style: c.strokeStyle, dash: [...c.dash] }); },
        closed: false, strokes,
    };
    return c;
}

test('the outline is a dark solid line with a light dashed one on top, sized for the screen', () => {
    const ctx = fakeCtx();
    drawMarquee(ctx, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.25, true);
    assert.equal(ctx.strokes.length, 2);
    const [under, over] = ctx.strokes;
    assert.deepEqual(under.dash, [], 'the underlay is solid, so the gaps in the dashes stay visible');
    assert.equal(under.width, 12, '3 screen px at quarter zoom');
    assert.equal(over.width, 6, '1.5 screen px at quarter zoom');
    assert.ok(over.dash.length === 2 && over.dash[0] === 24, 'dashes scale with the zoom too');
    assert.ok(under.width > over.width, 'the dark line shows either side of the light one');
    assert.equal(ctx.closed, true);
});

test('a single point is nothing to outline; an open path is left open', () => {
    const ctx = fakeCtx();
    drawMarquee(ctx, [{ x: 0, y: 0 }], 1);
    assert.equal(ctx.strokes.length, 0);
    drawMarquee(ctx, [{ x: 0, y: 0 }, { x: 5, y: 5 }], 1);
    assert.equal(ctx.closed, false);
});

test('a handle is drawn at screen size, and is grabbed within a wider radius than it is drawn', () => {
    const ctx = fakeCtx();
    let rect = null;
    ctx.rect = (x, y, w, h) => { rect = { x, y, w, h }; };
    drawHandle(ctx, 100, 50, 0.5);
    assert.deepEqual(rect, { x: 88, y: 38, w: 24, h: 24 }, '6 screen px half-size at half zoom is 12 canvas px');
    assert.ok(HANDLE_GRAB_PX > HANDLE_PX, 'a finger beside the handle still gets it');
});

// ── the two gesture previews, which use the same marquee ───────────────────
import { drawMosaicMarquee, drawCurveAnchors } from '../../src/canvas/editChrome.js';

test('the mosaic marquee tints the rectangle and outlines it with a real colour', () => {
    // The border used to be set to the string 'var(--accent-soft)', which a canvas cannot parse -
    // so strokeStyle kept whatever the last drawing left. Every colour set here must be one the
    // canvas can actually read.
    const ctx = fakeCtx();
    const styles = [];
    ctx.fillRect = () => styles.push(['fill', ctx.fillStyle]);
    const realStroke = ctx.stroke.bind(ctx);
    ctx.stroke = () => { styles.push(['stroke', ctx.strokeStyle]); realStroke(); };
    drawMosaicMarquee(ctx, { x0: 30, y0: 20, x1: 10, y1: 0 }, 1, 'rgba(120,140,255,0.18)');
    assert.ok(styles.length >= 3, 'a tint and the marquee\'s two strokes');
    for (const [what, style] of styles) assert.ok(!String(style).includes('var('), `${what} uses ${style}`);
});

test('the mosaic marquee normalises a drag made in any direction', () => {
    const ctx = fakeCtx();
    let rect = null;
    ctx.fillRect = (x, y, w, h) => { rect = { x, y, w, h }; };
    drawMosaicMarquee(ctx, { x0: 30, y0: 20, x1: 10, y1: 0 }, 1, 'rgba(120,140,255,0.18)');
    assert.deepEqual(rect, { x: 10, y: 0, w: 20, h: 20 });
});

test('curve anchors are sized for the screen, and the first one is marked', () => {
    const ctx = fakeCtx();
    const arcs = [];
    ctx.arc = (x, y, r) => arcs.push({ x, y, r, fill: ctx.fillStyle });
    drawCurveAnchors(ctx, [{ x: 0, y: 0 }, { x: 10, y: 10 }], 0.5);
    assert.equal(arcs.length, 2);
    assert.equal(arcs[0].r, 10, '5 screen px at half zoom');
    assert.notEqual(arcs[0].fill, arcs[1].fill, 'the first anchor is marked');
});
