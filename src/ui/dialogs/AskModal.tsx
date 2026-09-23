import React from 'react';
import { tr } from '../../i18n.ts';
import { Modal } from '../Modal.tsx';

// The app's own confirm and prompt.
//
// Not a style preference. A browser told to prevent additional dialogs - one tick of a checkbox,
// and it sticks for the origin - makes `confirm()` return false and `prompt()` return null for
// ever after. Every guarded action then silently does nothing: delete asks nothing and deletes
// nothing, save asks for no name and saves nothing. There is no error, and no way for the app to
// tell. LinkPromptModal was written for exactly this reason; this is the same fix for the rest.
//
// Presentational on purpose. The promise that makes it usable as `await ask.confirm(...)` lives
// in hooks/useAsk, so a hook with no JSX of its own can still ask a question.
//
// No Modal header: .panel-title is a 10px uppercase section label, and a question set in it reads
// as a heading rather than as a sentence. The question is the content here, so it is the content.
// Modal's close button goes with the header, which costs nothing - Escape, the backdrop and an
// explicit cancel button all still decline.

/** What is being asked, and how it is answered. */
export interface AskRequest {
    kind: 'confirm' | 'prompt';
    /** The question itself, in the user's words. */
    title: string;
    /** The consequence, when it does not belong in the question. */
    body?: string;
    /** prompt only: what the field starts with, selected so typing replaces it. */
    value?: string;
    placeholder?: string;
    /** The accept button's label; the verb ("Delete") reads better than "OK". */
    okLabel?: string;
}

/**
 * @param p.request what to ask, or null to show nothing
 * @param p.onDone the answer: false/null for cancel, true or the typed string for accept
 */
export function AskModal({ request, onDone }: { request: AskRequest | null, onDone: (answer: boolean | string | null) => void }) {
    const [value, setValue] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    // Each question starts from its own default, selected, so Enter alone answers it - which is
    // what a native prompt did and what the hands already expect.
    React.useEffect(() => {
        if (request?.kind !== 'prompt') return;
        setValue(request.value ?? '');
        const id = requestAnimationFrame(() => inputRef.current?.select());
        return () => cancelAnimationFrame(id);
    }, [request]);

    if (!request) return null;
    const isPrompt = request.kind === 'prompt';
    const cancel = () => onDone(isPrompt ? null : false);
    // A blank name is the one answer a prompt cannot return - it would save a project called
    // nothing. Cancel is how you decline.
    const okDisabled = isPrompt && !value.trim();
    const ok = () => { if (!okDisabled) onDone(isPrompt ? value.trim() : true); };

    return (
        <Modal onClose={cancel} width={420} z={1300} panelStyle={{ borderRadius: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#ddd', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{request.title}</div>
            {request.body && <div style={{ fontSize: 12, color: '#999', marginTop: 6, whiteSpace: 'pre-line' }}>{request.body}</div>}
            {isPrompt && (
                <input ref={inputRef} className="time-input" style={{ width: '100%', height: 34, marginTop: 10 }}
                    placeholder={request.placeholder} value={value}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); ok(); }
                        if (e.key === 'Escape') cancel();
                    }} />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
                <button className="button" onClick={cancel}>{tr('취소')}</button>
                <button className="button button-primary" style={{ background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }}
                    disabled={okDisabled} onClick={ok}>{request.okLabel || tr('확인')}</button>
            </div>
        </Modal>
    );
}
