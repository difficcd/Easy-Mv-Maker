import { Trash2 } from 'lucide-react';
import { tr } from '../../i18n';
import { Modal } from '../Modal.tsx';
/** One saved project or backup in the list: what a listing returns. */
export interface ProjectRow { id: string; name: string; savedAt?: number | string | null; [k: string]: any }


// Picker for the saved project and backup lists.
export function ProjectPicker({ title, items, onOpen, onDelete, onClose }: { title: string, items: ProjectRow[], onOpen: (id: string, name: string) => void, onDelete: (id: string) => void, onClose: () => void }) {
    return (
        <Modal title={title} onClose={onClose} width={420} maxHeight="70vh" panelStyle={{ padding: 16 }}>
            {items.length === 0 && <div style={{ fontSize: 12, color: '#888', padding: '12px 2px' }}>{tr('저장된 프로젝트가 없습니다.')}</div>}
            {items.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)' }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(p.id, p.name)}>
                        <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: '#777' }}>{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</div>
                    </div>
                    <button className="button" style={{ height: 28, padding: '0 10px' }} onClick={() => onOpen(p.id, p.name)}>{tr('열기')}</button>
                    <button className="icon-btn del-btn" onClick={() => onDelete(p.id)}><Trash2 size={13} /></button>
                </div>
            ))}
        </Modal>
    );
}
