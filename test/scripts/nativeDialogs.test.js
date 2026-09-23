import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDialogs, ALLOWED } from '../../scripts/native-dialogs.mjs';

// The sites this gate was written for, as they stood before the conversion. If it stops seeing
// any of these it has stopped being a gate, and the failure it guards against is a silent one:
// nothing throws when a blocked dialog is dropped, so nobody finds out from a test run.

const CONFIRM = `        if (!window.confirm(tr('이 로컬 프로젝트를 삭제할까요?'))) return;`;
const PROMPT = `            const name = window.prompt(tr('로컬 저장 이름:'), localNameRef.current || 'MV Project');`;
const ALERT = `            alert(tr('로컬에 저장했습니다.'));`;
// useExport's long-export warning was the one bare call, with no `window.` in front of it.
const BARE = `        if (total > LONG_EXPORT_FRAMES && !confirm(tr('오래 걸립니다. 계속할까요?'))) return;`;

test('the three native dialogs are caught, on window or bare', () => {
    for (const src of [CONFIRM, PROMPT, ALERT, BARE]) assert.equal(nativeDialogs(src).length, 1, src);
});

test('the replacements are not', () => {
    // The whole point is that ask.confirm reads like confirm. A gate that could not tell them
    // apart would fail on every line of the fix it exists to protect.
    assert.equal(nativeDialogs(`        if (!await ask.confirm(tr('삭제할까요?'), { okLabel: tr('삭제') })) return;`).length, 0);
    assert.equal(nativeDialogs(`        const n = await ask.prompt(tr('탭 이름'), { value: t.name });`).length, 0);
    assert.equal(nativeDialogs(`            setToast(tr('로컬에 저장했습니다.'));`).length, 0);
});

test('a name that merely ends in one is left alone', () => {
    for (const src of ['myalert(x);', 'nativeConfirm(x);', 'obj.alert(x);', 'a.b.prompt(c);']) {
        assert.equal(nativeDialogs(src).length, 0, src);
    }
});

test('a comment about one is not one', () => {
    // native-dialogs.mjs documents what to use instead, and names all three while doing it.
    assert.equal(nativeDialogs(`// confirm() returns false once dialogs are blocked`).length, 0);
    assert.equal(nativeDialogs(` *   prompt   await ask.prompt(question)`).length, 0);
    assert.equal(nativeDialogs(`/* alert(x) */`).length, 0);
});

test('the line number points at the call', () => {
    const hits = nativeDialogs(['const a = 1;', 'const b = 2;', ALERT].join('\n'));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 3);
});

test('nothing is exempt', () => {
    // An entry here is a site that kept a native dialog. There is no reason for one - the two
    // that looked like reasons (the recording countdown, the YouTube link) both became dialogs
    // of our own - so a new entry should have to argue for itself in review.
    assert.deepEqual(ALLOWED, []);
});
