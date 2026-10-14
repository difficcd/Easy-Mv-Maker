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
