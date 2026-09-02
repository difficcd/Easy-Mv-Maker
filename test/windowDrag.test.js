import test from 'node:test';
import assert from 'node:assert/strict';
import { dragOnWindow } from '../src/core/windowDrag.js';

/** A stand-in for window that remembers what is still listening. */
function fakeTarget() {
    const live = new Map();
    return {
        addEventListener: (type, fn) => { live.set(type + ':' + fn.name + live.size, { type, fn }); },
        removeEventListener: (type, fn) => {
            for (const [k, v] of live) if (v.type === type && v.fn === fn) live.delete(k);
        },
        /** @param {string} type */
        fire(type, e = {}) {
            for (const v of [...live.values()]) if (v.type === type) v.fn({ type, ...e });
        },
        types: () => [...live.values()].map(v => v.type).sort(),
        count: () => live.size,
    };
}

test('moves are delivered until the pointer is released', () => {
    const t = fakeTarget();
    const moves = [];
    dragOnWindow(e => moves.push(e.x), undefined, t);

    t.fire('pointermove', { x: 1 });
    t.fire('pointermove', { x: 2 });
    t.fire('pointerup');
    t.fire('pointermove', { x: 3 });

    assert.deepEqual(moves, [1, 2]);
});

test('a release removes every listener', () => {
    const t = fakeTarget();
    dragOnWindow(() => { }, undefined, t);
    assert.deepEqual(t.types(), ['pointercancel', 'pointermove', 'pointerup']);

    t.fire('pointerup');
    assert.equal(t.count(), 0, 'listeners left on window after the drag ended');
});

test('a cancelled pointer removes them too', () => {
    // The case all five hand-written copies missed. A system gesture or a palm landing sends
    // pointercancel and never pointerup, so the move listener stayed for the rest of the session
    // - and nothing looks wrong until the next drag has two handlers, then three.
    const t = fakeTarget();
    const moves = [];
    dragOnWindow(() => moves.push(1), undefined, t);

    t.fire('pointercancel');
    assert.equal(t.count(), 0, 'a cancelled pointer leaked its listeners');

    t.fire('pointermove');
    assert.equal(moves.length, 0, 'still moving after a cancel');
});

test('onEnd runs for a release and for a cancel alike', () => {
    for (const type of ['pointerup', 'pointercancel']) {
        const t = fakeTarget();
        const ends = [];
        dragOnWindow(() => { }, e => ends.push(e.type), t);
        t.fire(type);
        assert.deepEqual(ends, [type]);
    }
});

test('the returned stop ends the drag early', () => {
    const t = fakeTarget();
    const moves = [];
    const stop = dragOnWindow(() => moves.push(1), undefined, t);

    t.fire('pointermove');
    stop();
    t.fire('pointermove');

    assert.equal(moves.length, 1);
    assert.equal(t.count(), 0);
});

test('stopping twice, or after the drag ended, is harmless', () => {
    const t = fakeTarget();
    const stop = dragOnWindow(() => { }, undefined, t);
    stop();
    stop();
    t.fire('pointerup');
    assert.equal(t.count(), 0);
});

test('onEnd does not run again for a pointerup after an early stop', () => {
    // Otherwise a caller that ends a drag itself would still get its cleanup run a second time
    // when the pointer eventually comes up.
    const t = fakeTarget();
    let ends = 0;
    const stop = dragOnWindow(() => { }, () => { ends++; }, t);
    stop();
    t.fire('pointerup');
    assert.equal(ends, 0);
});

test('two drags at once do not remove each other listeners', () => {
    const t = fakeTarget();
    const a = [], b = [];
    dragOnWindow(() => a.push(1), undefined, t);
    dragOnWindow(() => b.push(1), undefined, t);
    assert.equal(t.count(), 6);

    t.fire('pointermove');
    assert.deepEqual([a.length, b.length], [1, 1]);

    t.fire('pointerup');
    assert.equal(t.count(), 0);
});

test('with no target at all it does nothing rather than throwing', () => {
    const stop = dragOnWindow(() => { }, undefined, null);
    assert.equal(typeof stop, 'function');
    stop();
});
