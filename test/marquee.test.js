import test from 'node:test';
import assert from 'node:assert/strict';
import { drawMarquee, drawHandle, HANDLE_PX, HANDLE_GRAB_PX } from '../src/canvas/marquee.js';

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
