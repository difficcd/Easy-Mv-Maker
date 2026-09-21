// How many bits a second to ask the recorder for.
//
// Left unset, MediaRecorder picks - Chrome settles around 2.5 Mbps whatever the canvas size,
// which at 1920x1080 is well under what this app's output needs (#229). Flat colour with hard
// ink lines is the worst case for a starved encoder: the line edges grow mosquito noise and the
// large flat areas band, so the file looks worse than what the user watched in the app.
//
// The number is per pixel per frame rather than a fixed ceiling, because the canvas size is a
// setting here and ranges from 720p to 4K. A fixed figure would either starve 4K or waste most
// of the file at 720p.

/** The three encoders a browser recorder can hand back, by the bits each needs per pixel. */
export type CodecFamily = 'h264' | 'vp8' | 'vp9';

/**
 * Bits per pixel per frame.
 *
 * Above what live video needs, because drawings are not live video: a hard black line on white
 * is a high-frequency edge that survives no quantisation, while the flat regions either side
 * compress almost for free. Paying for the edges is the whole point.
 *
 * VP9 gets less for the same result - it is roughly a generation ahead of H.264 at this kind of
 * content. VP8 is not, so it is grouped with H.264 rather than with the codec it shares a
 * container with.
 */
const BPP: Record<CodecFamily, number> = { h264: 0.12, vp8: 0.12, vp9: 0.08 };

/** Below this, even a small canvas looks chewed. Above it, the file is bigger for no visible gain. */
const FLOOR = 2_000_000;
const CEILING = 48_000_000;

/** Enough for stereo music at a quality nobody will question; the video dwarfs it either way. */
export const AUDIO_BITRATE = 192_000;

/**
 * Which codec family a MediaRecorder mimeType names.
 *
 * An empty string means the browser was left to choose, which in practice is VP8 in a WebM
 * container - the conservative assumption, since guessing VP9 there would under-provision.
 *
 * @param {string} mimeType from pickRecordingType
 * @returns {'h264' | 'vp8' | 'vp9'}
 */
export function codecFamily(mimeType: string | null | undefined): CodecFamily {
    const t = (mimeType || '').toLowerCase();
    if (t.includes('vp9')) return 'vp9';
    if (t.includes('h264') || t.includes('avc') || t.includes('mp4')) return 'h264';
    return 'vp8';
}

/**
 * @param {object} opts
 * @param {number} opts.width canvas width in pixels
 * @param {number} opts.height
 * @param {number} opts.fps
 * @param {string} [opts.mimeType] what the recorder was asked for
 * @returns {number} bits per second, clamped
 */
export function videoBitrate({ width, height, fps, mimeType }: { width: number, height: number, fps: number, mimeType?: string | null }): number {
    const pixels = Math.max(1, width) * Math.max(1, height);
    const raw = pixels * Math.max(1, fps) * BPP[codecFamily(mimeType)];
    return Math.round(Math.min(CEILING, Math.max(FLOOR, raw)));
}
