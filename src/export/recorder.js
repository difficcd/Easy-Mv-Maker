// The pieces of recording the canvas to a video file that do not depend on the app.
//
// Which container and codec to ask for, where the frames come from, and how the recorder is
// made and torn down. handleExport in App is left with what only it knows: the range, the
// audio graph, and the playback loop that paints the frames.

/** Preferred first: an MP4 plays everywhere the user is likely to send it. */
const CANDIDATES = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/**
 * The best type this browser will record, and the file extension to go with it.
 *
 * An empty mimeType means "let MediaRecorder choose" - the file is then called .webm, which is
 * what every browser falls back to.
 *
 * @param {(type: string) => boolean} isTypeSupported MediaRecorder.isTypeSupported, injected so
 *   the choice can be checked without a browser
 * @returns {{mimeType: string, ext: 'mp4' | 'webm'}}
 */
export function pickRecordingType(isTypeSupported) {
    const mimeType = CANDIDATES.find(t => { try { return !!isTypeSupported(t); } catch { return false; } }) || '';
    return { mimeType, ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
}

/**
 * A video stream from the canvas that takes a frame only when asked - so the recording can be
 * painted on a fixed frame grid rather than sampled off the paint loop (#156). Where
 * requestFrame does not exist the stream samples itself at `fps` and `requestFrame` is null.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} fps the fallback rate
 * @returns {{stream: MediaStream, requestFrame: (() => void) | null}}
 */
export function frameSource(canvas, fps) {
    let stream = canvas.captureStream(0);
    const track = /** @type {any} */ (stream.getVideoTracks()[0]);
    const s = /** @type {any} */ (stream);
    const requestFrame = typeof track?.requestFrame === 'function' ? () => track.requestFrame()
        : typeof s.requestFrame === 'function' ? () => s.requestFrame() : null;
    if (!requestFrame) stream = canvas.captureStream(fps);
    return { stream, requestFrame };
}

/**
 * A recorder over the tracks, already started, that hands the finished file to `onDone`.
 *
 * Tried first with the chosen type and again with none, because a browser that reports a type
 * as supported can still refuse it at construction. Throws only when both fail.
 *
 * @param {MediaStreamTrack[]} tracks
 * @param {string} mimeType from pickRecordingType; may be empty
 * @param {(blob: Blob) => void} onDone
 * @returns {MediaRecorder}
 */
export function startRecorder(tracks, mimeType, onDone) {
    let mr;
    try { mr = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined); }
    catch { mr = new MediaRecorder(new MediaStream(tracks)); }
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mr.onstop = () => onDone(new Blob(chunks, { type: mimeType || 'video/webm' }));
    mr.start();
    return mr;
}
