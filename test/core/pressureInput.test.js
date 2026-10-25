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

// --- the pressure range (#394) -----------------------------------------------------------------------
import { mapPressure, PRESSURE_RANGE_DEFAULT } from '../../src/core/pressureInput.ts';

test('the default range changes nothing: what the pen reports is what is stored', () => {
    for (const p of [0.05, 0.3, 0.5, 0.9, 1]) assert.equal(mapPressure(p, PRESSURE_RANGE_DEFAULT), p);
});

test('the lightest touch draws the minimum width and the hardest press the maximum', () => {
    // Width is size x pressure x 2, so 20% of the size is pressure 0.1 and 150% is 0.75.
    const r = { light: 20, heavy: 150 };
    assert.equal(mapPressure(0, r), 0.1);
    assert.equal(mapPressure(1, r), 0.75);
    assert.equal(mapPressure(0.5, r), 0.425);
});

test('a range given backwards, or out of bounds, is brought into shape', () => {
    assert.equal(mapPressure(1, { light: 150, heavy: 20 }), 0.75, 'the ends swap rather than invert the pen');
    assert.equal(mapPressure(1, { light: 0, heavy: 900 }), 1.5, 'at most three times the size');
    assert.equal(mapPressure(0, { light: -50, heavy: 100 }), 0, 'at least nothing');
    assert.equal(mapPressure(2, PRESSURE_RANGE_DEFAULT), 1, 'a reading past 1 counts as 1');
});
