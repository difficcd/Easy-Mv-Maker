import test from 'node:test';
import assert from 'node:assert/strict';
import { frameExportPlan, exportFileInfo, GIF_MAX_EDGE, LONG_EXPORT_FRAMES } from '../src/core/frameExport.js';

const hd = { cw: 1920, ch: 1080 };

test('a GIF is scaled to fit the long edge; a PNG sequence keeps full size', () => {
    const gif = frameExportPlan({ format: 'gif', ...hd, from: 0, to: 1 });
    assert.equal(Math.max(gif.gw, gif.gh), GIF_MAX_EDGE);
    assert.equal(gif.gw, 720);
    assert.equal(gif.gh, 405);

    const png = frameExportPlan({ format: 'png', ...hd, from: 0, to: 1 });
    assert.equal(png.scale, 1);
    assert.equal(png.gw, 1920);
    assert.equal(png.gh, 1080);
});

test('a portrait canvas is fitted on its own long edge', () => {
    const p = frameExportPlan({ format: 'gif', cw: 1080, ch: 1920, from: 0, to: 1 });
    assert.equal(p.gh, GIF_MAX_EDGE);
    assert.equal(p.gw, 405);
});

test('a canvas already smaller than the limit is not scaled up', () => {
    const p = frameExportPlan({ format: 'gif', cw: 640, ch: 360, from: 0, to: 1 });
    assert.equal(p.scale, 1);
    assert.equal(p.gw, 640);
    assert.equal(p.gh, 360);
});

test('the two rates, and the delay that follows from them', () => {
    assert.equal(frameExportPlan({ format: 'gif', ...hd }).fps, 12);
    assert.equal(frameExportPlan({ format: 'png', ...hd }).fps, 30);
    assert.equal(frameExportPlan({ format: 'gif', ...hd }).delayMs, 83);
    assert.equal(frameExportPlan({ format: 'png', ...hd }).delayMs, 33);
});

test('the frame count follows the range and the rate', () => {
    assert.equal(frameExportPlan({ format: 'png', ...hd, from: 0, to: 2 }).total, 60);
    assert.equal(frameExportPlan({ format: 'gif', ...hd, from: 0, to: 2 }).total, 24);
    // A range that does not start at zero counts its own length, not its end.
    assert.equal(frameExportPlan({ format: 'png', ...hd, from: 3, to: 5 }).total, 60);
});

test('a range shorter than one frame still produces a frame', () => {
    // Rounding 0.01s * 30 to zero would write a file with nothing in it.
    const p = frameExportPlan({ format: 'png', ...hd, from: 0, to: 0.01 });
    assert.equal(p.total, 1);
    assert.equal(p.empty, false);
});

test('no range at all is empty, and says so instead of writing a file', () => {
    for (const [from, to] of [[0, 0], [5, 5], [5, 1]]) {
        const p = frameExportPlan({ format: 'png', ...hd, from, to });
        assert.equal(p.empty, true, `for ${from}..${to}`);
        assert.equal(p.total, 0);
    }
});

test('a junk canvas size does not produce a zero or negative output size', () => {
    // The failure this guards: a writer created with width 0 accepts frames and produces bytes
    // no decoder will open.
    for (const size of [0, -100, NaN, undefined, null]) {
        const p = frameExportPlan({ format: 'gif', cw: /** @type {any} */(size), ch: /** @type {any} */(size), from: 0, to: 1 });
        assert.ok(p.gw >= 1 && p.gh >= 1, `for ${String(size)}`);
        assert.ok(Number.isFinite(p.gw) && Number.isFinite(p.gh));
    }
});

test('the file name and type follow the format', () => {
    assert.deepEqual(exportFileInfo(true), { type: 'image/gif', name: 'mv_export.gif' });
    assert.deepEqual(exportFileInfo(false), { type: 'application/zip', name: 'mv_frames.zip' });
});

test('a queue names its output differently, because both land in the same folder', () => {
    const pieces = { gif: 'mv_pieces', zip: 'mv_pieces' };
    assert.deepEqual(exportFileInfo(true, pieces), { type: 'image/gif', name: 'mv_pieces.gif' });
    assert.deepEqual(exportFileInfo(false, pieces), { type: 'application/zip', name: 'mv_pieces.zip' });
});

test('a piece planned on its own size would not match the document - so a queue plans once', () => {
    // A file has one frame size and each piece has its own canvas. Planning per piece gives
    // different outputs for the same file, which is why handleExportPieces plans from the open
    // document and fits every piece to that. A 16:9 piece happens to agree with a 16:9 document;
    // a square one does not, and that is the case that would have produced a broken file.
    const doc = frameExportPlan({ format: 'gif', ...hd, from: 0, to: 1 });
    const sameAspect = frameExportPlan({ format: 'gif', cw: 1280, ch: 720, from: 0, to: 1 });
    const square = frameExportPlan({ format: 'gif', cw: 1000, ch: 1000, from: 0, to: 1 });
    assert.deepEqual([sameAspect.gw, sameAspect.gh], [doc.gw, doc.gh]);
    assert.notDeepEqual([square.gw, square.gh], [doc.gw, doc.gh]);
    assert.deepEqual([square.gw, square.gh], [720, 720]);
});

test('the long-export threshold is a number the caller can compare against', () => {
    const p = frameExportPlan({ format: 'png', ...hd, from: 0, to: 40 });
    assert.equal(p.total, 1200);
    assert.ok(p.total > LONG_EXPORT_FRAMES);
});
