import test from 'node:test';
import assert from 'node:assert/strict';
import { splitProject, piecesAreSequential } from '../src/core/splitProject.js';
import { planQueue, pieceRange } from '../src/core/exportQueue.js';
import { playRange } from '../src/core/playRange.js';

// Splitting and combining are two features that only mean anything together, and each was written
// with the other in mind rather than against it. "Split it and put it back and you have the same
// film" is a claim both PRs make; this is where it has to hold.
//
// Deliberately not testing either half again - they have their own files. This tests the seam.

const cut = (id, partId, startTime, endTime) => ({
    id, partId, partName: partId, startTime, endTime, track: 0, texts: [],
    layers: [{ id: 1, strokes: [{ id: 1, tool: 'paste', bitmapId: `b${id}` }] }],
});

const project = () => ({
    appName: 'EasyMVMaker', numTracks: 2,
    cuts: [
        cut(1, 'p1', 0, 1), cut(2, 'p1', 1, 2), cut(3, 'p1', 2, 3),
        cut(4, 'p2', 3, 4), cut(5, 'p2', 4, 5),
        cut(6, 'p3', 5, 8),
    ],
    bitmaps: Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [`b${i}`, `data:image/webp;base64,B${i}`])),
});

const docsOf = (pieces) => pieces.map(p => p.doc);

test('the pieces together cover exactly the time the project did', () => {
    const whole = playRange({ cuts: project().cuts });
    const pieces = splitProject(project());
    const total = pieces.reduce((n, p) => n + pieceRange(p.doc).duration, 0);
    assert.equal(total, whole.end - whole.start,
        'a gap or an overlap here is a gap or an overlap in the finished film');
});

test('a queue over the pieces is the same length as one over the whole project', () => {
    const fps = 12;
    const whole = playRange({ cuts: project().cuts });
    const asOne = Math.round((whole.end - whole.start) * fps);
    const queued = planQueue(docsOf(splitProject(project())), { fps }).frames.length;
    assert.equal(queued, asOne, `${queued} frames from the pieces, ${asOne} from the whole`);
});

test('the pieces run in the order the parts did', () => {
    const pieces = splitProject(project());
    const plan = planQueue(docsOf(pieces), { fps: 4 });
    // The first frame of each piece, in output order, must climb through the original timeline.
    const firsts = plan.pieces.map((p, i) => (p.count ? plan.frames[p.from].t : null)).filter(t => t != null);
    for (let i = 1; i < firsts.length; i++) {
        assert.ok(firsts[i] > firsts[i - 1], `piece ${i} starts at ${firsts[i]}, after ${firsts[i - 1]}`);
    }
});

test('every frame of every piece lands inside a cut that piece actually has', () => {
    const pieces = splitProject(project());
    const plan = planQueue(docsOf(pieces), { fps: 12 });
    for (const f of plan.frames) {
        const cuts = pieces[f.piece].doc.cuts;
        const covered = cuts.some(c => f.t >= c.startTime && f.t < c.endTime);
        assert.ok(covered, `piece ${f.piece} has no cut at t=${f.t}`);
    }
});

// The reason splitting is worth doing at all: a piece must not drag the whole project's pixels
// with it. If it did, working on one piece would cost what working on the project cost.
test('no piece carries another piece pixels, and between them they carry all of them', () => {
    const pieces = splitProject(project());
    const seen = new Set();
    for (const p of pieces) {
        const ids = Object.keys(p.doc.bitmaps);
        const mine = new Set(p.doc.cuts.flatMap(c => c.layers.flatMap(l => l.strokes.map(s => s.bitmapId))));
        for (const id of ids) {
            assert.ok(mine.has(id), `piece "${p.name}" carries ${id}, which none of its cuts uses`);
            seen.add(id);
        }
    }
    assert.deepEqual([...seen].sort(), Object.keys(project().bitmaps).sort(), 'and nothing was dropped');
});

test('a project with cuts outside any part still round-trips whole', () => {
    const d = project();
    d.cuts.push(cut(7, null, 8, 9));
    d.bitmaps.b7 = 'data:image/webp;base64,B7';
    const pieces = splitProject(d);
    const ids = pieces.flatMap(p => p.doc.cuts.map(c => c.id)).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7]);
    const whole = playRange({ cuts: d.cuts });
    const total = pieces.reduce((n, p) => n + pieceRange(p.doc).duration, 0);
    assert.equal(total, whole.end - whole.start);
});

// A part whose cuts are not adjacent in time is legal - you can group any cuts you like - and it
// is the case where "the pieces cover the same time" stops being obvious.
test('parts that interleave in time still add up', () => {
    const d = {
        appName: 'EasyMVMaker',
        cuts: [cut(1, 'a', 0, 1), cut(2, 'b', 1, 2), cut(3, 'a', 2, 3), cut(4, 'b', 3, 4)],
        bitmaps: {},
    };
    const pieces = splitProject(d);
    assert.equal(pieces.length, 2);
    // Each piece spans from its first cut to its last, so interleaved parts overlap in time and
    // the total is longer than the original. Worth pinning: it is a real consequence of grouping
    // non-adjacent cuts, not a bug, and someone reading a doubled runtime should find this here.
    const total = pieces.reduce((n, p) => n + pieceRange(p.doc).duration, 0);
    assert.equal(total, 6, 'two pieces of three seconds each, from a four-second project');
    assert.ok(total > 4, 'interleaved parts cannot be laid end to end without repeating time');
});

test('interleaved parts are reported as such, so the surprise comes before the files do', () => {
    const inOrder = {
        appName: 'EasyMVMaker', bitmaps: {},
        cuts: [cut(1, 'a', 0, 1), cut(2, 'a', 1, 2), cut(3, 'b', 2, 3), cut(4, 'b', 3, 4)],
    };
    const interleaved = {
        appName: 'EasyMVMaker', bitmaps: {},
        cuts: [cut(1, 'a', 0, 1), cut(2, 'b', 1, 2), cut(3, 'a', 2, 3), cut(4, 'b', 3, 4)],
    };
    assert.equal(piecesAreSequential(splitProject(inOrder)), true);
    assert.equal(piecesAreSequential(splitProject(interleaved)), false);
    assert.equal(piecesAreSequential([]), true, 'nothing to split is not a warning');
});
