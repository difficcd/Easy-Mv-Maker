// Exporting several separately-made pieces as one file.
//
// Past a certain number of cuts the app lags, and that is not really fixable - lossless frames,
// a lot of data, a local machine or a free server tier. So the advice is to work in pieces and
// combine them at the end, and this is the part that makes combining possible.
//
// The rule the whole design follows: never hold more than one piece. An exporter that loads every
// piece and then renders would reintroduce exactly the state that made splitting necessary. So
// this file plans the work first - which output frame comes from which piece, at what time inside
// it - and the caller walks that plan one piece at a time, opening, drawing, and dropping each.
//
// Planning is separate from rendering because planning is arithmetic and rendering needs a
// browser. Everything here can be tested; nothing here touches a canvas.

import { playRange } from './playRange.js';

/**
 * How long one piece contributes to the output.
 *
 * The same range playback and export already use, so a piece exports as the piece's own author saw
 * it. A piece with nothing in it contributes nothing rather than a frame of blank - which matters
 * because an empty piece in the middle of a queue would otherwise put a gap in the result.
 *
 * @param {{cuts?: any[], audio?: any, video?: any}} doc a parsed project
 * @returns {{start: number, end: number, duration: number}}
 */
export function pieceRange(doc) {
    const { start, end } = playRange({ cuts: doc?.cuts, audio: doc?.audio, video: doc?.video });
    return { start, end, duration: Math.max(0, end - start) };
}

/**
 * The output frames, in order, each naming the piece it comes from and the time inside it.
 *
 * One fps for the whole output rather than per piece: the pieces are halves of one film, and a
 * file whose frame rate changed halfway through is not a thing most players will honour. A piece
 * authored at a different rate is resampled by being sampled at this one, which is what playing it
 * back at this rate would do anyway.
 *
 * Frames are placed at the START of each interval. Sampling at the end would drop the first frame
 * of every piece: at t = duration a cut has already finished, so the last sample of a piece would
 * land on nothing.
 *
 * @param {Array<{cuts?: any[], audio?: any, video?: any}>} docs the pieces, in order
 * @param {{fps?: number, maxFrames?: number}} [opts]
 * @returns {{frames: Array<{piece: number, t: number, index: number}>, pieces: Array<{start: number, end: number, duration: number, from: number, count: number}>, fps: number, duration: number, truncated: boolean}}
 */
export function planQueue(docs, { fps = 12, maxFrames = 0 } = {}) {
    const rate = Math.max(1, Number(fps) || 12);
    const step = 1 / rate;
    const list = Array.isArray(docs) ? docs : [];

    const pieces = [];
    const frames = [];
    let truncated = false;

    for (let p = 0; p < list.length; p++) {
        const { start, end, duration } = pieceRange(list[p]);
        const count = duration > 0 ? Math.max(1, Math.round(duration * rate)) : 0;
        const from = frames.length;
        for (let i = 0; i < count; i++) {
            if (maxFrames > 0 && frames.length >= maxFrames) { truncated = true; break; }
            frames.push({ piece: p, t: start + i * step, index: frames.length });
        }
        pieces.push({ start, end, duration, from, count: frames.length - from });
        if (truncated) break;
    }

    return { frames, pieces, fps: rate, duration: frames.length * step, truncated };
}

/**
 * Where each piece begins in the finished file, for a caller that needs to report progress or
 * write chapter marks.
 *
 * @param {ReturnType<typeof planQueue>} plan
 * @returns {number[]} one output time per piece, in seconds
 */
export function seamTimes(plan) {
    const step = 1 / plan.fps;
    return plan.pieces.map(p => p.from * step);
}

/**
 * A running estimate of how far through the queue a frame is, as 0..1.
 *
 * Reported against frames rather than pieces because pieces differ in length, and a bar that jumps
 * from a third to two thirds when a short piece finishes reads as broken.
 *
 * @param {ReturnType<typeof planQueue>} plan
 * @param {number} done how many frames have been written
 * @returns {number}
 */
export function queueProgress(plan, done) {
    if (!plan.frames.length) return 1;
    return Math.max(0, Math.min(1, done / plan.frames.length));
}
