import React from 'react';
import { tr } from '../../i18n';
import { Modal } from '../Modal.jsx';

// Link input. This used window.prompt, but once the browser blocks dialogs - one tick of
// "prevent additional dialogs" and it sticks - prompt silently returns null and nothing
// happens, so the button looks dead. Asking inside the app avoids that entirely.
export function LinkPromptModal({ title, placeholder, onSubmit, onClose }) {
    const [url, setUrl] = React.useState('');
    const inputRef = React.useRef(null);
    React.useEffect(() => { inputRef.current?.focus(); }, []);
    const submit = () => { const v = url.trim(); if (v) onSubmit(v); };
    return (
        <Modal title={title} onClose={onClose} width={460} z={1200} panelStyle={{ borderRadius: 10 }}>
            <input ref={inputRef} className="time-input" style={{ width: '100%', height: 34 }}
                placeholder={placeholder} value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') onClose(); }} />
            <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{tr('유튜브 주소를 붙여넣고 Enter를 누르세요.')}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
                <button className="button" onClick={onClose}>{tr('취소')}</button>
                <button className="button button-primary" style={{ background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }}
                    disabled={!url.trim()} onClick={submit}>{tr('가져오기')}</button>
            </div>
        </Modal>
    );
}
