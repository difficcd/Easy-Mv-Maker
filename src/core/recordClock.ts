// Which frame a recording should take next.
//
// Recording used to let the canvas stream sample itself thirty times a second while the paint
// loop ran at the display's rate. The two rates do not divide, so one recorded frame stood for
// two paints and the next for three, and that unevenness is what read as judder in the file
// (#156). The recorder now takes frames only when asked, and this decides when to ask: the
// clock is quantised to a fixed grid, and a frame is requested once per grid step, painted at
// exactly the grid time rather than wherever the clock happened to be.
//
// Audio stays the master clock. If the machine falls behind, the grid step that comes back is
// the latest one the clock has reached - a frame is skipped rather than the picture drifting
// away from the sound, because a skipped frame is a flicker and drift is the whole recording.

/** Frames per second of a recorded video. Also the grid the paint is quantised to. */
export const EXPORT_FPS = 30;

/**
 * The frame to record at clock time `t`, or null if the grid has not advanced since `lastIdx`.
 *
 * @param {number} t the playback clock, in seconds
 * @param {number} start where the recording began, in seconds
 * @param {number} fps
 * @param {number} lastIdx the index recorded last, or -1 before the first
 * @returns {{idx: number, time: number} | null} the index and the exact time to paint for it
 */
export function nextRecordFrame(t: number, start: number, fps: number, lastIdx: number): { idx: number, time: number } | null {
    if (!(fps > 0)) return null;
    // The epsilon absorbs float error in an audio clock that reports 0.99999 for a time that is
    // meant to be 1.0; without it a frame on the boundary would be painted a step early.
    const idx = Math.floor((t - start) * fps + 1e-6);
    if (idx < 0 || idx <= lastIdx) return null;
    return { idx, time: start + idx / fps };
}
