// The conventional-commit type a subject line opens with: feat, fix, perf, refactor, ...
//
// Shared by the process metrics and the fix-needs-a-test gate, which must agree on what counts as
// a fix - if they did not, the gate could pass a change the metrics then count as an untested fix.

/**
 * @param {string} subject a commit subject or PR title
 * @returns {string} the type in lower case, or 'other' when there is no prefix
 */
export function kindOf(subject) {
    const m = /^(\w+)(\(.+?\))?!?:/.exec(String(subject || '').trim());
    return m ? m[1].toLowerCase() : 'other';
}

/**
 * The reason a fix carries no test, when its message gives one: a `No-Test: <reason>` line.
 *
 * Shared for the same reason as kindOf. The gate accepts a waived fix; the metrics used to count
 * the same fix as untested, so the gate working as designed read as the gate failing (cycle 2,
 * finding N3).
 *
 * @param {string} body a commit message body
 * @returns {string | null}
 */
export function waiverOf(body) {
    const m = /^No-Test:[ \t]*(\S.*)$/mi.exec(String(body || ''));
    return m ? m[1].trim() : null;
}
