import { useEffect, useRef } from 'react';
import { keyOf, shortcutFor } from '../core/shortcuts.js';

/**
 * The document-level keydown listener, wired to what each shortcut does.
 *
 * Which key means what is core/shortcuts (shortcutFor), where it is tested; this only reads the
 * event, asks, and calls. The actions are read through a ref at event time, so the listener is
 * attached once per keymap rather than re-attached on every render of App - which is what the
 * old effect did, with a dependency list that could not name half of what it used.
 *
 * @param {Record<string, string>} keymap
 * @param {object} actions one function per action name shortcutFor can return, plus
 *   `state()` returning what there is to act on
 */
export function useShortcuts(keymap, actions) {
    const latest = useRef(actions);
    latest.current = actions;
    useEffect(() => {
        const onKey = (e) => {
            const t = /** @type {HTMLElement} */ (e.target);
            const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
            const press = { key: e.key, combo: keyOf(e), ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, inField };
            const hit = shortcutFor(press, keymap, latest.current.state());
            if (!hit) return;
            e.preventDefault();
            const fn = latest.current[hit.action];
            if (typeof fn === 'function') fn(hit.arg);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [keymap]);
}
