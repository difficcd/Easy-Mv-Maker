import test from 'node:test';
import assert from 'node:assert/strict';
import { driftOf } from '../../scripts/deps-installed.mjs';

// The case this exists for, as npm ls reported it on 2026-10-21: a dependency PR had merged and
// been pulled, the packages were never reinstalled, and the local gate ran on an older eslint
// than CI's.
const STALE = {
    problems: [
        'invalid: eslint@10.10.0 C:\\repo\\node_modules\\eslint',
        'invalid: wait-on@9.1.0 C:\\repo\\node_modules\\wait-on',
    ],
};

test('a package below its declared range is drift', () => {
    assert.equal(driftOf(STALE).length, 2);
});

test('a package that is not installed at all is drift', () => {
    assert.deepEqual(driftOf({ problems: ['missing: vite@^8.3.4, required by easy-mv-maker@1.0.0'] }).length, 1);
});

test('an extraneous package is not', () => {
    // Clutter in node_modules does not change which toolchain the checks run on.
    assert.deepEqual(driftOf({ problems: ['extraneous: left-pad@1.3.0 C:\\repo\\node_modules\\left-pad'] }), []);
});

test('a clean tree, or no output at all, is not drift', () => {
    assert.deepEqual(driftOf({ problems: [] }), []);
    assert.deepEqual(driftOf({}), []);
    assert.deepEqual(driftOf(null), []);
});
