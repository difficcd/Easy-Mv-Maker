import { useState } from 'react';
import { Folder, FolderPlus, Pencil, Scissors, Trash2, ChevronRight, ClipboardPaste, X, ImageOff } from 'lucide-react';
import { tr } from '../../i18n.ts';
import { Modal } from '../Modal.tsx';
import { childFolders, projectsIn, crumbs, folderName, joinFolder, parentFolder, canMoveFolder } from '../../core/serverFolders.ts';
import type { ServerProject } from '../../hooks/useServerStorage.ts';
import type { Ask } from '../../hooks/useAsk.ts';

/** Something picked up to be moved: a project or a folder. */
type Held = { kind: 'project', id: string, name: string, from: string } | { kind: 'folder', path: string };

export interface ServerBrowserProps {
    projects: ServerProject[];
    folders: string[];
    ask: Ask;
    onOpen: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onMove: (id: string, folder: string) => void;
    onCreateFolder: (path: string) => void;
    onMoveFolder: (from: string, to: string) => void;
    onDeleteFolder: (path: string) => void;
    /** told which folder is open, so "save as new" lands there */
    onBrowse: (folder: string) => void;
    onClose: () => void;
}

const DRAG_TYPE = 'application/x-mv-server-item';

/**
 * The projects saved on the server, as folders and preview cards - the way a drawing app's file
 * browser shows them. Folders nest. Moving works two ways: drag a card onto a folder or onto the
 * trail at the top (a mouse), or cut it and paste it in the folder it should go to (a pen or a
 * finger, where dragging scrolls instead).
 */
export function ServerBrowser({ projects, folders, ask, onOpen, onDelete, onRename, onMove, onCreateFolder, onMoveFolder, onDeleteFolder, onBrowse, onClose }: ServerBrowserProps) {
    const [current, setCurrent] = useState('');
    const [held, setHeld] = useState<Held | null>(null);
    const [dropOn, setDropOn] = useState<string | null>(null);
    // A folder that no longer exists (renamed or removed from here) sends the view to the top.
    const here = current && !folders.includes(current) ? '' : current;

    const go = (path: string) => { setCurrent(path); onBrowse(path); };

    const canDrop = (item: Held, target: string) => item.kind === 'folder' ? canMoveFolder(item.path, target) : item.from !== target;
    const moveTo = (item: Held, target: string) => {
        if (!canDrop(item, target)) return;
        if (item.kind === 'project') onMove(item.id, target);
        else onMoveFolder(item.path, joinFolder(target, folderName(item.path)));
        setHeld(null);
    };

    const newFolder = async () => {
        const name = (await ask.prompt(tr('새 폴더 이름:'), { value: tr('새 폴더'), okLabel: tr('만들기') }))?.replace(/\//g, ' ').trim();
        if (name) onCreateFolder(joinFolder(here, name));
    };
    const renameFolder = async (path: string) => {
        const name = (await ask.prompt(tr('폴더 이름 바꾸기:'), { value: folderName(path), okLabel: tr('바꾸기') }))?.replace(/\//g, ' ').trim();
        if (name && name !== folderName(path)) onMoveFolder(path, joinFolder(parentFolder(path), name));
    };
    const renameProject = async (p: ServerProject) => {
        const name = (await ask.prompt(tr('프로젝트 이름 바꾸기:'), { value: p.name, okLabel: tr('바꾸기') }))?.trim();
        if (name && name !== p.name) onRename(p.id, name);
    };

    // Drag and drop, for a mouse. The item rides in dataTransfer; `held` is the touch path.
    const dragStart = (item: Held) => (e: React.DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'move'; };
    const dropTarget = (target: string) => ({
        onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDropOn(target); } },
        onDragLeave: () => setDropOn(d => (d === target ? null : d)),
        onDrop: (e: React.DragEvent) => {
            e.preventDefault(); setDropOn(null);
            try { moveTo(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)), target); } catch { /* not ours */ }
        },
    });

    const subFolders = childFolders(folders, here);
    const items = projectsIn(projects, here);
    const heldLabel = held ? (held.kind === 'project' ? held.name : folderName(held.path)) : '';

    return (
        <Modal title={tr('서버에서 열기')} onClose={onClose} width={760} maxHeight="82vh" panelStyle={{ padding: 16 }}>
            <div className="sb-bar">
                <div className="sb-trail">
                    {crumbs(here).map((c, i) => (
                        <span key={c.path} className="sb-crumb-wrap">
                            {i > 0 && <ChevronRight size={12} className="sb-sep" />}
                            <button className={`sb-crumb${c.path === here ? ' current' : ''}${dropOn === c.path ? ' drop' : ''}`}
                                onClick={() => go(c.path)} {...dropTarget(c.path)}>
                                {c.name || tr('최상위')}
                            </button>
                        </span>
                    ))}
                </div>
                <button className="button sb-btn" onClick={newFolder}><FolderPlus size={14} /> {tr('새 폴더')}</button>
            </div>

            {held && (
                <div className="sb-held">
                    <span className="sb-held-name">{tr('옮길 항목: {0}', heldLabel)}</span>
                    <button className="sb-paste" disabled={!canDrop(held, here)} onClick={() => moveTo(held, here)}>
                        <ClipboardPaste size={14} /> {tr('여기로 옮기기')}
                    </button>
                    <button className="icon-btn" onClick={() => setHeld(null)} title={tr('취소')}><X size={14} /></button>
                </div>
            )}

            {subFolders.length === 0 && items.length === 0 && (
                <div className="sb-empty">
                    {here ? tr('빈 폴더입니다. 여기를 연 채로 새로 저장하면 이 폴더에 들어갑니다.') : tr('저장된 프로젝트가 없습니다. 서버에 저장하면 여기에 미리보기와 함께 나타납니다.')}
                </div>
            )}

            <div className="sb-grid">
                {subFolders.map(f => (
                    <div key={f} className={`sb-card sb-folder${dropOn === f ? ' drop' : ''}${held?.kind === 'folder' && held.path === f ? ' held' : ''}`}
                        draggable onDragStart={dragStart({ kind: 'folder', path: f })} {...dropTarget(f)}
                        onClick={() => go(f)}>
                        <div className="sb-thumb sb-folder-icon"><Folder size={44} strokeWidth={1.5} /></div>
                        <div className="sb-name" title={folderName(f)}>{folderName(f)}</div>
                        <div className="sb-actions" onClick={e => e.stopPropagation()}>
                            <button className="icon-btn" title={tr('이름 바꾸기')} onClick={() => renameFolder(f)}><Pencil size={13} /></button>
                            <button className="icon-btn" title={tr('옮기기')} onClick={() => setHeld({ kind: 'folder', path: f })}><Scissors size={13} /></button>
                            <button className="icon-btn del-btn" title={tr('폴더 지우기')} onClick={() => onDeleteFolder(f)}><Trash2 size={13} /></button>
                        </div>
                    </div>
                ))}
                {items.map(p => (
                    <div key={p.id} className={`sb-card${held?.kind === 'project' && held.id === p.id ? ' held' : ''}`}
                        draggable onDragStart={dragStart({ kind: 'project', id: p.id, name: p.name, from: here })}
                        onClick={() => onOpen(p.id, p.name)}>
                        <div className="sb-thumb">
                            {p.thumb
                                ? <img src={`/api/projects/${p.id}/thumb?v=${encodeURIComponent(p.savedAt || '')}`} alt="" draggable={false} />
                                : <ImageOff size={24} className="sb-nothumb" />}
                        </div>
                        <div className="sb-name" title={p.name}>{p.name}</div>
                        <div className="sb-date">{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</div>
                        <div className="sb-actions" onClick={e => e.stopPropagation()}>
                            <button className="icon-btn" title={tr('이름 바꾸기')} onClick={() => renameProject(p)}><Pencil size={13} /></button>
                            <button className="icon-btn" title={tr('옮기기')} onClick={() => setHeld({ kind: 'project', id: p.id, name: p.name, from: here })}><Scissors size={13} /></button>
                            <button className="icon-btn del-btn" title={tr('삭제')} onClick={() => onDelete(p.id)}><Trash2 size={13} /></button>
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
