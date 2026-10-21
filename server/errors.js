// What the server says when something it did not expect goes wrong.
//
// Nine handlers answered with `String(e)`. For the project and backup routes nothing in the
// client ever reads that text - apiFetch reports only the status - so it reached exactly one
// audience: whoever called the API directly. With the dev server proxying /api onto the LAN (see
// SECURITY.md), that is anyone on the same network, and a filesystem error carries absolute
// paths - the home directory, the project folder, file names.
//
// The YouTube routes are the exception that shaped this: the client does show their message, and
// "the disk is full" is worth seeing. So an error's *code* becomes a sentence, the path is never
// sent, and the whole error goes to the server's own log, where the person who owns the machine
// reads it.
//
// The sentences are Korean because they reach the screen unchanged, like the other messages the
// server writes for the user (friendlyYtError).

const BY_CODE = {
    ENOSPC: '디스크 공간이 부족합니다.',
    EACCES: '파일에 접근할 권한이 없습니다.',
    EPERM: '파일에 접근할 권한이 없습니다.',
    EROFS: '읽기 전용 위치라 쓸 수 없습니다.',
    EMFILE: '열린 파일이 너무 많습니다. 잠시 후 다시 시도하세요.',
    ENOENT: '필요한 파일을 찾을 수 없습니다.',
};

/** What is sent when the error is not one with a known code. */
export const GENERIC = '서버가 요청을 처리하지 못했습니다.';

/**
 * The part of an error that is safe to send: a sentence for a known code, otherwise a generic one.
 * Never the message, which is where paths live.
 *
 * @param {unknown} e
 * @returns {string}
 */
export function publicMessage(e) {
    const code = e && typeof e === 'object' && 'code' in e ? e.code : undefined;
    return (typeof code === 'string' && BY_CODE[code]) || GENERIC;
}

/**
 * Log the whole error here, send the safe part there.
 *
 * @param {{headersSent?: boolean, status: (n: number) => any}} res
 * @param {unknown} e
 * @param {string} where the route, so the log line says which handler failed
 * @param {(...a: any[]) => void} [log]
 */
export function sendError(res, e, where, log = console.error) {
    log(`[mv-api] ${where} failed:`, e);
    // A route that had started streaming a file cannot change its status any more; the log line
    // is all that can be done, and trying would throw on top of the original error.
    if (!res.headersSent) res.status(500).json({ error: publicMessage(e) });
}
