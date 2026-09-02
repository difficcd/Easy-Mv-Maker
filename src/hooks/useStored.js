import { useEffect, useRef, useState } from 'react';
import { readStored, writeStored } from '../core/persist.js';

/**
 * State that remembers itself in localStorage.
 *
 * Reads once, on first render, and writes whenever the value changes - which is what the nine
 * hand-written pairs it replaces did, so a preference set in this tab is there in the next one.
 *
 * The codec is held in a ref rather than listed as a dependency: every call site passes an object
 * literal, so depending on it would write on every render. What it encodes cannot change for a
 * given key anyway.
 *
 * @template T
 * @param {string} key
 * @param {T} fallback used when nothing is stored, or when what is stored will not decode
 * @param {{ decode?: (raw: string) => T | undefined, encode?: (value: T) => string }} [codec]
 * @returns {[T, (next: T | ((prev: T) => T)) => void]}
 */
export function useStored(key, fallback, codec = {}) {
    const [value, setValue] = useState(() => readStored(key, fallback, codec.decode));
    const encode = useRef(codec.encode);
    encode.current = codec.encode;
    useEffect(() => { writeStored(key, value, encode.current); }, [key, value]);
    return [value, setValue];
}
