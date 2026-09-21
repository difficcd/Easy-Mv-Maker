// Keyboard shortcuts: the default bindings, and turning a key event into something comparable.
//
// Shortcut matching fails quietly - the key simply does nothing - so the rules are worth stating
// rather than leaving implied by a string concatenation.

/** A key press as the shortcut table reads it. */
export interface KeyPress { key: string; ctrl: boolean; shift: boolean; alt: boolean; inField: boolean; combo: string }
/** What the app is doing, for the shortcuts that only make sense in a state. */
export interface ShortcutState { currentCut?: unknown; clipboard?: unknown; selection?: unknown; textEdit?: unknown }
/** An action to take, with its argument for the tool switch. */
export interface Shortcut { action: string; arg?: string }

/**
 * Selecting a tool is a binding like any other, distinguished by this prefix so the handler can
 * route it without a list of tool ids to keep in step with the toolbar.
 */
export const TOOL_PREFIX = 'tool.';

/** The tool a binding selects, or null if it is not a tool binding. */
export const toolFromAction = (action: unknown): string | null =>
    (typeof action === 'string' && action.startsWith(TOOL_PREFIX)) ? action.slice(TOOL_PREFIX.length) : null;

/**
 * Bindings a user has not changed.
 *
 * Single keys, no modifiers: the other hand is on the pen. The letters follow the common drawing
 * ones where they exist (b for brush, e for eraser, g for the bucket, v for move) so anyone
 * coming from another app guesses right, and avoid the four already taken by undo, redo and the
 * brush-size keys.
 */
export type Keymap = Record<string, string>;

export const DEFAULT_KEYS: Keymap = {
    undo: 'j', redo: 'k',
    brushDown: '[', brushUp: ']',
    zoomOut: 'ctrl+[', zoomIn: 'ctrl+]',
    resetView: 'ctrl+0',
    selectAll: 'ctrl+t',

    'tool.brush': 'b',
    'tool.pen': 'd',
    'tool.pencil': 'n',
    'tool.soft': 'a',
    'tool.marker': 'm',
    'tool.eraser': 'e',
    'tool.fill': 'g',
    'tool.ruler': 'r',
    'tool.mosaic': 'o',
    'tool.liquify': 'w',
    'tool.lasso': 'l',
    'tool.move': 'v',
    'tool.text': 't',
};

/** What each binding is called in the settings panel. */
export const KEY_LABELS: Record<string, string> = {
    undo: '실행 취소', redo: '다시 실행',
    brushDown: '브러시 작게', brushUp: '브러시 크게',
    zoomOut: '캔버스 축소', zoomIn: '캔버스 확대', resetView: '줌 초기화',
    selectAll: '레이어 전체 선택 (올가미)',

    'tool.brush': '도구: 펜',
    'tool.pen': '도구: 점',
    'tool.pencil': '도구: 연필',
    'tool.soft': '도구: 에어',
    'tool.marker': '도구: 마커',
    'tool.eraser': '도구: 지우개',
    'tool.fill': '도구: 채우기',
    'tool.ruler': '도구: 도형',
    'tool.mosaic': '도구: 모자이크',
    'tool.liquify': '도구: 유동화',
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
export function keyOf(e: { key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }): string {
    const p: string[] = [];
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
export function matchShortcut(keymap: Keymap | null | undefined, combo: string | null | undefined): string | null {
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
export function findConflicts(keymap: Keymap | null | undefined): Record<string, string[]> {
    const byKey = new Map<string, string[]>();
    const map = keymap || {};
    for (const action of Object.keys(map)) {
        const bound = map[action];
        if (!bound) continue;
        const k = String(bound).toLowerCase();
        byKey.set(k, [...(byKey.get(k) || []), action]);
    }
    const out: Record<string, string[]> = {};
    for (const [k, actions] of byKey) if (actions.length > 1) out[k] = actions;
    return out;
}

/**
 * A stored keymap, with anything missing filled in from the defaults.
 *
 * A binding the user removed should stay removed, but one that never existed - a shortcut added
 * since they last saved - has to come from the defaults or it would be unreachable.
 *
 * It used to read localStorage itself. It does not any more: reading and guarding storage is
 * readStored's job, and having a second reader meant a second try/catch to keep in step.
 *
 * @param {unknown} value whatever was stored, already parsed
 * @returns {Record<string, string>} always a fresh object, so editing it cannot touch the defaults
 */
export function keymapFrom(value: unknown): Keymap {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...DEFAULT_KEYS, ...(value as Keymap) }
        : { ...DEFAULT_KEYS };
}

/**
 * What a key press should do, given the bindings and what the app is in the middle of.
 *
 * The order is the whole of the rule set:
 *
 *  1. Save is claimed before the input guard. A text field has no save of its own, so Ctrl+S
 *     typed while editing used to fall through to the browser and offer to save the page.
 *  2. Inside a field, nothing else is claimed - undo and redo there belong to the field.
 *  3. Plain Tab folds the panels; Ctrl/Alt/Shift+Tab stay with the browser.
 *  4. The user's bindings, tools included.
 *  5. The conventional Ctrl+Z / Y / C / V / D, then Escape and Enter for a selection, and
 *     Delete for the current cut when nothing else would take it.
 *
 * Returns the action's name and whether the browser default should be suppressed, or null to
 * leave the key alone. Pure, so every rule above has a test.
 *
 * @param {{key: string, combo: string, ctrl: boolean, shift: boolean, alt: boolean, inField: boolean}} press
 * @param {Record<string, string>} keymap
 * @param {{selection: boolean, textEdit: boolean, currentCut: boolean, clipboard: boolean}} state
 * @returns {{action: string, arg?: string} | null}
 */
export function shortcutFor(press: KeyPress, keymap: Keymap, state: ShortcutState): Shortcut | null {
    const { key, ctrl, shift, alt, inField } = press;
    if (ctrl && (key === 's' || key === 'S')) return { action: 'save' };
    if (inField) return null;
    if (key === 'Tab' && !ctrl && !alt && !shift) return { action: 'togglePanels' };
    const hit = matchShortcut(keymap, press.combo);
    if (hit) {
        const toolId = toolFromAction(hit);
        return toolId ? { action: 'tool', arg: toolId } : { action: hit };
    }
    if (ctrl && key === 'z' && !shift) return { action: 'undo' };
    if (ctrl && (key === 'Z' || (key === 'z' && shift) || key === 'y')) return { action: 'redo' };
    if (ctrl && key === 'c') return state.currentCut ? { action: 'copyCut' } : null;
    if (ctrl && key === 'v') return state.clipboard ? { action: 'pasteCut' } : null;
    if (ctrl && (key === 'd' || key === 'D')) return state.currentCut ? { action: 'duplicateCut' } : null;
    if (key === 'Escape') return state.selection ? { action: 'cancelSelection' } : null;
    if (key === 'Enter') return state.selection ? { action: 'commitSelection' } : null;
    if ((key === 'Delete' || key === 'Backspace') && !state.selection && !state.textEdit && state.currentCut) return { action: 'deleteCut' };
    return null;
}
