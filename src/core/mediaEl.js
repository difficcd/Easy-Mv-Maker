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

/**
 * A URL that is safe to hand a media element, or null.
 *
 * Opening a project means reading a URL out of a file and assigning it to `<audio>.src` or
 * `<video>.src`. The file can say anything - it is a document, not code we wrote - and a `.emv`
 * is a thing people send each other. CodeQL flags both assignments as `js/xss-through-dom` for
 * exactly that reason, and the honest answer is a check rather than a dismissal.
 *
 * Two shapes are legitimate and nothing else is:
 *
 *   blob:...            made by URL.createObjectURL from bytes already held
 *   data:audio/...      the base64 copy an .emv carries so it is self-contained
 *
 * `javascript:` is the case the rule is really about. A media element will not run one, so this
 * is not a live hole today - but "the sink happens to ignore it" is a property of the browser,
 * not of this code, and the same value is one refactor away from an <a href> or an <iframe>.
 *
 * Rejecting also catches a duller and likelier failure: a project whose audio field holds a
 * server error page or a truncated string then fails visibly here instead of becoming an element
 * that silently never plays.
 *
 * @param {unknown} url
 * @param {'audio'|'video'} kind
 * @returns {string | null}
 */
export function safeMediaSrc(url, kind) {
    if (typeof url !== 'string' || !url) return null;
    if (url.startsWith('blob:')) return url;
    // The prefix must be the whole scheme-and-type, so `data:audio/mp3` passes and
    // `data:text/html;x=audio/` - which contains the same substring - does not.
    if (new RegExp(`^data:${kind}/[a-z0-9.+-]+[;,]`, 'i').test(url)) return url;
    return null;
}
