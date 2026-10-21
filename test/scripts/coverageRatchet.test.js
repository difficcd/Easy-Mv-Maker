import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, honestCoverage } from '../../scripts/coverage-ratchet.mjs';

// Inspection finding F1 (docs/process/2026-10-21.md): Node's report said 96.8% while half of src/
// was never loaded by a test, because a file no test loads is simply absent from the report.

const LCOV = [
    'TN:', 'SF:src\\core\\ids.ts', 'LF:57', 'LH:57', 'end_of_record',
    'TN:', 'SF:src/canvas/strokes.ts', 'LF:565', 'LH:443', 'end_of_record',
    'TN:', 'SF:scripts\\commitKind.mjs', 'LF:14', 'LH:14', 'end_of_record',
].join('\n');

test('lcov paths are read with either slash', () => {
    // Windows writes backslashes, Linux - where CI runs - forward ones.
    const m = parseLcov(LCOV);
    assert.deepEqual(m.get('src/core/ids.ts'), { lf: 57, lh: 57 });
    assert.deepEqual(m.get('src/canvas/strokes.ts'), { lf: 565, lh: 443 });
});

test('a file no test loads counts, at its full length, as uncovered', () => {
    // The whole finding. Leave App.tsx out and this layout reads 88%; counted in, it is 22%.
    const files = ['src/core/ids.ts', 'src/canvas/strokes.ts', 'src/App.tsx'];
    const r = honestCoverage(parseLcov(LCOV), files, (f) => (f === 'src/App.tsx' ? 2198 : 0));
    assert.deepEqual(r.untested, ['src/App.tsx']);
    assert.equal(r.lf, 57 + 565 + 2198);
    assert.equal(r.lh, 57 + 443);
    assert.equal(r.pct, Math.round(500 / 2820 * 10000) / 100);
});

test('only the files asked about are counted', () => {
    // scripts/ is in the report but not in src/, and must not lift the figure.
    const r = honestCoverage(parseLcov(LCOV), ['src/core/ids.ts'], () => 0);
    assert.equal(r.lf, 57);
    assert.equal(r.pct, 100);
});

test('moving tested logic out of an untested file raises the figure', () => {
    // How the ratchet is meant to be climbed: lines leave App.tsx and arrive, tested, in a module.
    const before = honestCoverage(new Map(), ['src/App.tsx'], () => 1000);
    const after = honestCoverage(new Map([['src/core/extracted.ts', { lf: 100, lh: 95 }]]),
        ['src/App.tsx', 'src/core/extracted.ts'], (f) => (f === 'src/App.tsx' ? 900 : 0));
    assert.ok(after.pct > before.pct, `${before.pct} -> ${after.pct}`);
});

test('an empty set is fully covered rather than a division by zero', () => {
    assert.equal(honestCoverage(new Map(), [], () => 0).pct, 100);
});
