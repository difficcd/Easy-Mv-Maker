// Reading and writing the small preferences that live in localStorage.
//
// Nine pieces of state were persisted, and each wrote out its own try/catch twice - once to read
// on first render, once to write when it changed. Eighteen copies of the same two lines, which
// would be merely noisy if they all agreed. They did not: the UI saturation was read with a bare
//
//     parseFloat(localStorage.getItem('mv_ui_sat'))
//
// with no guard at all, so in a browser where localStorage throws - a private window, or site
// data blocked - the app failed to mount rather than falling back to its default. Every other
// read had the guard. That is what a copied idiom costs: the one place it was left off is
// invisible until someone opens the app in the wrong window.
//
// Anything that must survive reliably belongs in the project file or IndexedDB. This is for
// preferences: which panels are open, the theme, the recent colours.

/**
 * A stored preference, or the fallback.
 *
 * The fallback is returned for a key that was never written, for one that cannot be parsed, and
 * for a decode that rejects what it found - so a decoder can validate by returning undefined and
 * a hand-edited or half-written value cannot take the app down with it.
 *
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @param {(raw: string) => T | undefined} [decode] defaults to the raw string
 * @returns {T}
 */
export function readStored(key, fallback, decode) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const value = decode ? decode(raw) : /** @type {any} */ (raw);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

/**
 * Write a preference, or quietly do nothing.
 *
 * Failing to save which panel was open is not worth interrupting anybody over, and localStorage
 * throws for reasons the user chose: a private window, blocked site data, a full quota.
 *
 * @template T
 * @param {string} key
 * @param {T} value
 * @param {(value: T) => string} [encode] defaults to String
 */
export function writeStored(key, value, encode) {
    try {
        localStorage.setItem(key, encode ? encode(value) : String(value));
    } catch {
        // Deliberately silent - see above.
    }
}

/** JSON, for the preferences that are objects or arrays. */
export const jsonCodec = {
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
};

/**
 * JSON that must decode to an array, for the lists. A stored value of the wrong shape is treated
 * as absent rather than handed on to code that will index into it.
 */
export const arrayCodec = {
    decode: (raw) => { const v = JSON.parse(raw); return Array.isArray(v) ? v : undefined; },
    encode: (value) => JSON.stringify(value),
};

/**
 * An on/off preference that defaults to on: only the literal 'off' turns it off.
 *
 * The two flags in the app disagreed about this - one stored 'on'/'off' and defaulted to on, the
 * other stored '1'/'0' and defaulted to off - so both spellings are kept rather than migrated,
 * because changing the spelling would silently reset the preference for everyone who had set it.
 */
export const onOffCodec = {
    decode: (raw) => raw !== 'off',
    encode: (value) => (value ? 'on' : 'off'),
};

/** An on/off preference that defaults to off: only the literal '1' turns it on. */
export const oneZeroCodec = {
    decode: (raw) => raw === '1',
    encode: (value) => (value ? '1' : '0'),
};

/** A number, treating anything unparseable as absent. */
export const numberCodec = {
    decode: (raw) => { const v = parseFloat(raw); return Number.isNaN(v) ? undefined : v; },
    encode: (value) => String(value),
};
