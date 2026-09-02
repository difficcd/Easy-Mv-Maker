import test from 'node:test';
import assert from 'node:assert/strict';
import { readStored, writeStored, jsonCodec, arrayCodec, onOffCodec, oneZeroCodec, numberCodec }
    from '../src/core/persist.js';

/** A localStorage stand-in. `throws` makes it behave like a browser with site data blocked. */
function fakeStorage({ throws = false, data = {} } = {}) {
    return {
        data,
        getItem(k) { if (throws) throw new DOMException('denied'); return k in data ? data[k] : null; },
        setItem(k, v) { if (throws) throw new DOMException('denied'); data[k] = String(v); },
    };
}

function withStorage(storage, fn) {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    try { return fn(); } finally {
        Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
    }
}

test('a key that was never written gives the fallback', () => {
    withStorage(fakeStorage(), () => {
        assert.equal(readStored('nope', 'default'), 'default');
    });
});

test('a stored value comes back', () => {
    withStorage(fakeStorage({ data: { k: 'hello' } }), () => {
        assert.equal(readStored('k', 'default'), 'hello');
    });
});

test('a storage that throws gives the fallback instead of taking the app down', () => {
    // This is the bug the helper exists for: one of the nine reads had no guard, so a private
    // window or blocked site data stopped the app mounting.
    withStorage(fakeStorage({ throws: true }), () => {
        assert.equal(readStored('k', 3, numberCodec.decode), 3);
    });
});

test('writing to a storage that throws is silent', () => {
    withStorage(fakeStorage({ throws: true }), () => {
        assert.doesNotThrow(() => writeStored('k', 'v'));
    });
});

test('a decoder that throws gives the fallback', () => {
    withStorage(fakeStorage({ data: { k: 'not json' } }), () => {
        assert.deepEqual(readStored('k', [], arrayCodec.decode), []);
    });
});

test('a decoder can reject a value it does not like by returning undefined', () => {
    withStorage(fakeStorage({ data: { k: '{"a":1}' } }), () => {
        assert.deepEqual(readStored('k', ['fallback'], arrayCodec.decode), ['fallback'],
            'an object is not an array, so it is treated as absent');
    });
});

test('an empty string is a stored value, not an absent one', () => {
    withStorage(fakeStorage({ data: { k: '' } }), () => {
        assert.equal(readStored('k', 'default'), '');
    });
});

test('a value written comes back through the same codec', () => {
    const s = fakeStorage();
    withStorage(s, () => {
        writeStored('k', { a: [1, 2] }, jsonCodec.encode);
        assert.deepEqual(readStored('k', null, jsonCodec.decode), { a: [1, 2] });
    });
});

// --- the codecs -------------------------------------------------------------------------------

test('onOff defaults to on: only the literal off turns it off', () => {
    assert.equal(onOffCodec.decode('off'), false);
    assert.equal(onOffCodec.decode('on'), true);
    assert.equal(onOffCodec.decode('anything'), true);
    assert.equal(onOffCodec.encode(true), 'on');
    assert.equal(onOffCodec.encode(false), 'off');
});

test('oneZero defaults to off: only the literal 1 turns it on', () => {
    assert.equal(oneZeroCodec.decode('1'), true);
    assert.equal(oneZeroCodec.decode('0'), false);
    assert.equal(oneZeroCodec.decode('on'), false);
    assert.equal(oneZeroCodec.encode(true), '1');
});

test('the two flag spellings are kept apart, because changing one would reset it for everyone', () => {
    // 'mv_pressure' stores on/off and defaults to on; 'mv_transparent_bg' stores 1/0 and defaults
    // to off. Migrating either spelling would silently discard what a user had set.
    assert.notEqual(onOffCodec.encode(true), oneZeroCodec.encode(true));
    assert.equal(onOffCodec.decode('0'), true, 'an on/off flag does not read 0 as off');
    assert.equal(oneZeroCodec.decode('on'), false, 'a 1/0 flag does not read on as true');
});

test('number treats anything unparseable as absent', () => {
    assert.equal(numberCodec.decode('2.5'), 2.5);
    assert.equal(numberCodec.decode('abc'), undefined);
    assert.equal(numberCodec.decode(''), undefined);
    assert.equal(numberCodec.encode(3), '3');
});

test('zero is a number, not an absent value', () => {
    withStorage(fakeStorage({ data: { k: '0' } }), () => {
        assert.equal(readStored('k', 3, numberCodec.decode), 0);
    });
});

test('an empty array is a stored value, not an absent one', () => {
    withStorage(fakeStorage({ data: { k: '[]' } }), () => {
        assert.deepEqual(readStored('k', ['x'], arrayCodec.decode), []);
    });
});
