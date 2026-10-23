import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeHasPressure, missingPressure } from '../../src/core/pressureInput.ts';

const pts = (...pr) => pr.map((pressure, i) => ({ x: i, y: 0, pressure }));

test('a mouse, or a tablet the browser sees as one, stores 0.5 everywhere - no pressure', () => {
    assert.equal(strokeHasPressure(pts(0.5, 0.5, 0.5)), false);
    assert.equal(missingPressure(true, { pen: false, points: pts(0.5, 0.5) }), true);
});

test('any point off 0.5 is pressure', () => {
    assert.equal(strokeHasPressure(pts(0.5, 0.31, 0.5)), true);
    assert.equal(missingPressure(true, { pen: false, points: pts(0.2, 0.8) }), false);
});

test('a pen stroke, or pressure turned off, is never flagged', () => {
    assert.equal(missingPressure(true, { pen: true, points: pts(0.5, 0.5) }), false);
    assert.equal(missingPressure(false, { pen: false, points: pts(0.5, 0.5) }), false);
});
