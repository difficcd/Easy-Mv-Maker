// The DOM side of the media tracks. `mediaReducer` holds what the audio and video *are*; this
// holds the one thing that has to be done to the elements playing them.

/**
 * Let go of a media element's source.
 *
 * Three steps, and the order is the point: pause first or the browser keeps decoding a source
 * that is being taken away; remove the attribute rather than setting src to '' or the element
 * reloads the page URL as media and logs a failure; then load(), which is what actually drops
 * the buffered data - without it the bytes stay held and a project with a big import never
 * gives them back.
 *
 * Written out six times, three for audio and three for video, and they had drifted: the audio
 * copies left pause() outside the try, so a detached element would throw where the video
 * copies would not.
 *
 * @param {HTMLMediaElement | null | undefined} el
 */
export function detachMedia(el) {
    if (!el) return;
    try {
        el.pause();
        el.removeAttribute('src');
        el.load();
    } catch { }
}
