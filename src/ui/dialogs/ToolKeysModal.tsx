import { AlertTriangle } from 'lucide-react';
import { tr } from '../../i18n';
import { TOOL_PREFIX } from '../../core/shortcuts.ts';
import { Modal } from '../Modal.tsx';
import type { Keymap } from '../../core/shortcuts.ts';

/** What both keymap editors share: the bindings, their defaults and labels, and the one waiting for a key. */
export interface KeymapEditorProps {
    keymap: Keymap;
    setKeymap: (next: Keymap) => void;
    defaultKeys: Keymap;
    keyLabels: Record<string, string>;
    /** the binding waiting for a keypress, if any */
    rebinding: string | null;
    setRebinding: (id: string | null) => void;
}


/**
 * The tool bindings, on their own.
 *
 * Twelve of them next to the seven general ones made the shortcuts list long enough that neither
 * group could be scanned, and they are looked for at different times: the general ones once, the
 * tool ones while deciding how to work.
 */
export function ToolKeysModal({ keymap, setKeymap, defaultKeys, keyLabels, conflicts, rebinding, setRebinding, onClose }: KeymapEditorProps & { conflicts: Record<string, string[]>, onClose: () => void }) {
    const ids = Object.keys(defaultKeys).filter(id => id.startsWith(TOOL_PREFIX));
    return (
        <Modal title={tr('도구 단축키')} onClose={onClose} width={400} maxHeight="80vh" z={1001}
            closeOnEscape={!rebinding} panelStyle={{ color: '#ccc', fontSize: 12.5 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                {rebinding ? tr('원하는 키를 누르세요 (Esc = 취소)') : tr('바꿀 항목을 누르세요')}
            </div>
            <KeyConflicts conflicts={conflicts} keyLabels={keyLabels} />
            <KeyRows ids={ids} keymap={keymap} defaultKeys={defaultKeys} keyLabels={keyLabels}
                rebinding={rebinding} setRebinding={setRebinding} setKeymap={setKeymap} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
                <button className="button" onClick={() => setKeymap({ ...keymap, ...Object.fromEntries(ids.map(id => [id, defaultKeys[id]])) })}>{tr('도구 기본값')}</button>
                <button className="button button-primary" onClick={onClose}>{tr('닫기')}</button>
            </div>
        </Modal>
    );
}/**

 * Which keys are bound to more than one thing.
 *
 * Both keymap editors showed this and both wrote it out, which is how the two lists came to
 * differ in ways nobody chose.
 *
 * @param {object} props
 * @param {Record<string, string[]>} props.conflicts
 * @param {Record<string, string>} props.keyLabels
 */
export function KeyConflicts({ conflicts, keyLabels }: { conflicts: Record<string, string[]>, keyLabels: Record<string, string> }) {
    return Object.entries(conflicts || {}).map(([key, actions]) => (
        <div key={key} style={{ fontSize: 11, color: '#e0a84e', padding: '4px 0' }}>
            <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} />{' '}
            {tr('{0} 키가 겹칩니다: {1} — 하나만 동작합니다.', key, actions.map(a => tr(keyLabels[a] || a)).join(', '))}
        </div>
    ));
}

/**
 * The bindings, one row each: what it does, the key it is on, and a way back to the default.
 *
 * The two editors drew these separately and had drifted apart: the tool list showed its key in a
 * monospace font and the general list did not, and the general list highlighted the row being
 * rebound while the tool list did not. Neither difference was a decision. Both good halves are
 * kept here, so both lists now do both.
 *
 * A list rather than a single row because the caller would otherwise have to put a `key` on a
 * component, which this project's type checking does not allow - inside, the key sits on the div
 * where it belongs.
 *
 * @param {object} props
 * @param {string[]} props.ids the bindings to show, in order
 * @param {Record<string, string>} props.keymap
 * @param {Record<string, string>} props.defaultKeys
 * @param {Record<string, string>} props.keyLabels
 * @param {string|null} props.rebinding the binding waiting for a keypress, if any
 * @param {(id: string|null) => void} props.setRebinding
 * @param {(next: Record<string, string>) => void} props.setKeymap
 */
export function KeyRows({ ids, keymap, defaultKeys, keyLabels, rebinding, setRebinding, setKeymap }: KeymapEditorProps & { ids: string[] }) {
    return ids.map(id => {
        const waiting = rebinding === id;
        return (
            <div key={id} className="key-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)' }}>
                <span style={{ flex: 1, color: '#ddd' }}>{tr(keyLabels[id])}</span>
                <button className="button"
                    style={{ height: 30, minWidth: 110, justifyContent: 'center', fontFamily: 'monospace', background: waiting ? 'var(--accent)' : undefined }}
                    onClick={() => setRebinding(waiting ? null : id)}>
                    {waiting ? tr('키 입력 대기…') : (keymap[id] || tr('(없음)'))}
                </button>
                {keymap[id] !== defaultKeys[id] && (
                    <button className="small-btn" title={tr('기본값으로')}
                        onClick={() => setKeymap({ ...keymap, [id]: defaultKeys[id] })}>{tr('되돌리기')}</button>
                )}
            </div>
        );
    });
}
