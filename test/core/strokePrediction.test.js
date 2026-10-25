import test from 'node:test';
import assert from 'node:assert/strict';
import { withPrediction, PREDICTION_MAX, PREDICTION_REACH } from '../../src/core/strokePrediction.ts';

// The pen's line trailed the pen on a PC tablet (2026-10-25); the preview draws to where the
// browser predicts the pen is going. The guess must stay a short tail.

const real = [{ x: 0, y: 0, pressure: 0.3 }, { x: 10, y: 0, pressure: 0.6 }];

test('predicted points follow the real ones, at the last real pressure', () => {
    const out = withPrediction(real, [{ x: 14, y: 0, pressure: 0 }, { x: 18, y: 1, pressure: 1 }]);
    assert.deepEqual(out.map(p => [p.x, p.y, p.pressure]), [[0, 0, 0.3], [10, 0, 0.6], [14, 0, 0.6], [18, 1, 0.6]]);
});

test('the real points are never changed, and nothing to predict leaves them as they are', () => {
    const before = JSON.stringify(real);
    withPrediction(real, [{ x: 12, y: 0, pressure: 0.5 }]);
    assert.equal(JSON.stringify(real), before);
    assert.deepEqual(withPrediction(real, []), real);
    assert.deepEqual(withPrediction(real, null), real);
    assert.deepEqual(withPrediction([], [{ x: 1, y: 1, pressure: 0.5 }]), []);
});

test(`no more than ${PREDICTION_MAX} are drawn`, () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ x: 11 + i, y: 0, pressure: 0.5 }));
    assert.equal(withPrediction(real, many).length, real.length + PREDICTION_MAX);
});

test(`a guess more than ${PREDICTION_REACH}px away ends the tail there`, () => {
    const out = withPrediction(real, [{ x: 15, y: 0, pressure: 0.5 }, { x: 10 + PREDICTION_REACH + 5, y: 0, pressure: 0.5 }, { x: 16, y: 0, pressure: 0.5 }]);
    assert.deepEqual(out.map(p => p.x), [0, 10, 15]);
});
