// Keyboard shortcuts: the default bindings, and turning a key event into something comparable.
//
// Shortcut matching fails quietly - the key simply does nothing - so the rules are worth stating
// rather than leaving implied by a string concatenation.

/** Bindings a user has not changed. */
export const DEFAULT_KEYS = {
    undo: 'j', redo: 'k',
    brushDown: '[', brushUp: ']',
    zoomOut: 'ctrl+[', zoomIn: 'ctrl+]',
    resetView: 'ctrl+0',
};

/** What each binding is called in the settings panel. */
export const KEY_LABELS = {
    undo: '실행 취소', redo: '다시 실행',
    brushDown: '브러시 작게', brushUp: '브러시 크게',
    zoomOut: '캔버스 축소', zoomIn: '캔버스 확대', resetView: '줌 초기화',
};

/**
 * Render a key event as a string such as "ctrl+shift+k".
 *
 * Three rules make two spellings of the same chord compare equal:
 *  - the modifiers are always in this order, whatever order they were pressed in;
 *  - Command counts as Ctrl, so a binding works on a Mac without being rebound;
 *  - a printable key is lowercased, while a named one (Tab, ArrowLeft, F5) keeps its spelling,
 *    since those are already canonical and lowercasing them would lose the distinction.
 */
export function keyOf(e) {
    const p = [];
    if (e.ctrlKey || e.metaKey) p.push('ctrl');
    if (e.altKey) p.push('alt');
    if (e.shiftKey) p.push('shift');
    const k = String(e.key ?? '');
    p.push(k.length === 1 ? k.toLowerCase() : k);
    return p.join('+');
}

/**
 * Which binding, if any, a combo triggers.
 *
 * Compared case-insensitively so a binding stored as "Ctrl+[" still matches; they are written
 * lowercase now, but a shortcut saved by an older version is not going to be rewritten.
 *
 * @returns {string|null} the action name, or null
 */
export function matchShortcut(keymap, combo) {
    if (!keymap || !combo) return null;
    const want = String(combo).toLowerCase();
    for (const action of Object.keys(keymap)) {
        const bound = keymap[action];
        if (bound && String(bound).toLowerCase() === want) return action;
    }
    return null;
}

/** The saved bindings, with anything missing filled in from the defaults. */
export function loadKeymap(storage = typeof localStorage === 'undefined' ? null : localStorage) {
    try {
        const v = JSON.parse(storage.getItem('mv_keymap'));
        // A binding the user removed should stay removed, but one that never existed - a shortcut
        // added since they last saved - has to come from the defaults or it would be unreachable.
        return v && typeof v === 'object' ? { ...DEFAULT_KEYS, ...v } : { ...DEFAULT_KEYS };
    } catch {
        return { ...DEFAULT_KEYS };
    }
}
