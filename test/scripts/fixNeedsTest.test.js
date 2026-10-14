import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from '../../scripts/fix-needs-test.mjs';
import { kindOf } from '../../scripts/commitKind.mjs';

// Measured before this gate existed: 56% of all fix commits, and 40% of the last month's, landed
// without touching a test. The cases below are the ones that decide whether it actually closes
// that gap or only looks like it does.

const fix = (subject, body = '') => ({ subject, body });

test('a fix with no test is refused', () => {
    const v = verdict([fix('fix: the pencil keeps answering pressure')], ['src/canvas/strokes.ts']);
    assert.equal(v.ok, false);
    assert.deepEqual(v.fixes, ['fix: the pencil keeps answering pressure']);
});

test('a fix that changes a test passes', () => {
    const v = verdict([fix('fix: seek off the frame boundary')], ['src/canvas/videoFrames.ts', 'test/canvas/canvasHelpers.test.js']);
    assert.equal(v.ok, true);
});

test('a branch with no fix on it is not this gate\'s business', () => {
    assert.equal(verdict([fix('feat: drag the frame guide'), fix('docs: the map')], ['src/App.tsx']).ok, true);
    assert.equal(verdict([], []).ok, true, 'main itself, or a branch with nothing on it');
});

test('a scoped or breaking fix still counts as a fix', () => {
    // Otherwise `fix(export):` would walk straight past the rule.
    assert.equal(verdict([fix('fix(export): ask for mp4 by its real name')], ['src/export/recorder.ts']).ok, false);
    assert.equal(verdict([fix('fix!: change the save format')], ['src/core/projectFormat.ts']).ok, false);
});

test('a waiver passes, and only with a reason', () => {
    const waived = verdict([fix('fix: the panel colour', 'Slightly darker.\n\nNo-Test: colour only; nothing a test can observe')], ['src/styles/panel.css']);
    assert.equal(waived.ok, true);
    assert.match(waived.why, /colour only/);
    // An empty trailer is not a reason. It would let the waiver become a habit with nothing in
    // history saying why each one was allowed.
    assert.equal(verdict([fix('fix: x', 'No-Test:')], ['src/a.ts']).ok, false);
    assert.equal(verdict([fix('fix: x', 'No-Test:   ')], ['src/a.ts']).ok, false);
});

test('a file merely named like a test does not count', () => {
    // Only a change under test/ is a test. A source file with "test" in its name is not one.
    assert.equal(verdict([fix('fix: x')], ['src/core/testHelpers.ts', 'scripts/smoke-test.mjs']).ok, false);
});

test('the gate and the metrics agree on what a fix is', () => {
    // They share kindOf. If they drifted, the gate could pass a change the metrics then count
    // as an untested fix, and the number this gate exists to move would stop meaning anything.
    for (const [s, k] of [['fix: a', 'fix'], ['fix(scope): a', 'fix'], ['Fix: a', 'fix'], ['feat: a', 'feat'], ['hooks/ in TypeScript', 'other']]) {
        assert.equal(kindOf(s), k, s);
    }
});
