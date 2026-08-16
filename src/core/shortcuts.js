// Keyboard shortcuts: the default bindings, and turning a key event into something comparable.
//
// Shortcut matching fails quietly - the key simply does nothing - so the rules are worth stating
// rather than leaving implied by a string concatenation.

/**
 * Selecting a tool is a binding like any other, distinguished by this prefix so the handler can
 * route it without a list of tool ids to keep in step with the toolbar.
 */
export const TOOL_PREFIX = 'tool.';

/** The tool a binding selects, or null if it is not a tool binding. */
export const toolFromAction = (action) =>
    (typeof action === 'string' && action.startsWith(TOOL_PREFIX)) ? action.slice(TOOL_PREFIX.length) : null;

/**
 * Bindings a user has not changed.
 *
 * Single keys, no modifiers: the other hand is on the pen. The letters follow the common drawing
 * ones where they exist (b for brush, e for eraser, g for the bucket, v for move) so anyone
 * coming from another app guesses right, and avoid the four already taken by undo, redo and the
 * brush-size keys.
 */
export const DEFAULT_KEYS = {
    undo: 'j', redo: 'k',
    brushDown: '[', brushUp: ']',
    zoomOut: 'ctrl+[', zoomIn: 'ctrl+]',
    resetView: 'ctrl+0',

    'tool.brush': 'b',
    'tool.pen': 'd',
    'tool.pencil': 'n',
    'tool.soft': 'a',
    'tool.marker': 'm',
    'tool.eraser': 'e',
    'tool.fill': 'g',
    'tool.ruler': 'r',
    'tool.mosaic': 'o',
    'tool.lasso': 'l',
    'tool.move': 'v',
    'tool.text': 't',
};

/** What each binding is called in the settings panel. */
export const KEY_LABELS = {
    undo: '실행 취소', redo: '다시 실행',
    brushDown: '브러시 작게', brushUp: '브러시 크게',
    zoomOut: '캔버스 축소', zoomIn: '캔버스 확대', resetView: '줌 초기화',

    'tool.brush': '도구: 펜',
    'tool.pen': '도구: 점',
    'tool.pencil': '도구: 연필',
    'tool.soft': '도구: 에어',
    'tool.marker': '도구: 마커',
    'tool.eraser': '도구: 지우개',
    'tool.fill': '도구: 채우기',
    'tool.ruler': '도구: 자',
    'tool.mosaic': '도구: 모자이크',
    'tool.lasso': '도구: 올가미',
    'tool.move': '도구: 이동',
    'tool.text': '도구: 텍스트',
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

/**
 * Actions sharing a key, as { key: [action, ...] } — only the keys with more than one.
 *
 * With a binding per tool this stopped being hypothetical. matchShortcut returns whichever comes
 * first, so a clash means one of the two silently never fires; showing it is the difference
 * between a broken key and a confusing one.
 */
export function findConflicts(keymap) {
    const byKey = new Map();
    for (const action of Object.keys(keymap || {})) {
        const bound = keymap[action];
        if (!bound) continue;
        const k = String(bound).toLowerCase();
        byKey.set(k, [...(byKey.get(k) || []), action]);
    }
    const out = {};
    for (const [k, actions] of byKey) if (actions.length > 1) out[k] = actions;
    return out;
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
