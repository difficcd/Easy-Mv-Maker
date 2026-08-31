// Which addresses the importer will hand to yt-dlp.
//
// The two YouTube endpoints pass a URL straight to yt-dlp, which fetches it. They used to accept
// anything matching /^https?:\/\//, which made the server a general-purpose downloader on behalf
// of whoever could reach it - including for hosts only this machine can see, which is the part
// that makes it more than a bandwidth problem.
//
// It is a YouTube importer. It takes YouTube addresses.
//
// This lives in its own file rather than inside index.js so it can be tested without starting a
// server. It guards a boundary, so the awkward inputs are worth stating out loud.

/** Hosts yt-dlp is allowed to be pointed at. */
export const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

/**
 * @param {unknown} raw
 * @returns {boolean} whether this is a YouTube address worth handing to yt-dlp
 */
export function isYouTubeUrl(raw) {
    if (typeof raw !== 'string') return false;
    let u;
    // Parsed, not pattern-matched. A regex looking for the domain anywhere in the string accepts
    // https://evil.test/?next=youtube.com, and one anchored at the start accepts
    // https://youtube.com.evil.test/ - the hostname is the only part worth comparing, and the
    // URL parser is the only thing that knows where it ends.
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return YOUTUBE_HOSTS.has(u.hostname.toLowerCase());
}
