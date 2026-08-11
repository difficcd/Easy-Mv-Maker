import React from 'react';
import { Plus, FolderPlus, Trash2, Copy, CopyPlus, ClipboardPaste, Eye, EyeOff, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import { safeArray } from './canvasUtils';
import { CutAnimPanel } from './AnimPanels';
import { tr } from './i18n';

// CUT / LAYER panel: the cut list, each cut's layer tree, cut animation and text list.
// The layer rows themselves are drawn by App's renderLayers - the drag state lives in App,
// so that part stays delegated.
export function CutLayerPanel({
    collapsedCutIds, copiedCut, currentCutId, cuts, deleteTextObject,
    deleteVideoBatch, dragLayerInfo, expandedCuts, handleAddCut, handleAddFolder,
    handleAddLayer, handleCopyCut, handleCutClick, handleDeleteCut, handleDuplicateCut,
    handlePasteCut, handleSetTool, openEditText, renameCut, renamingCutId,
    renderLayers, rightW, selectedCutIds, selectedText, setDragLayerInfo,
    setDropInfo, setRenamingCutId, setSelectedText, setShowRight, showRight,
    toggleCutCollapse, toggleCutSettings, toggleTextVisible, updCutAnim, updCutTime,
    updLayers, videoBatches,
}) {
    return (
            <div className="right-panel" style={{ width: rightW, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">CUT / LAYER</span>
                    <button className="icon-btn" onClick={() => setShowRight(false)}><ChevronRight size={14} /></button>
                </div>
                <div className="cut-list">
                    {[...cuts].sort((a, b) => (a.track || 0) - (b.track || 0) || a.startTime - b.startTime).map((cut, _i, _arr) => { const isCur = currentCutId === cut.id; const collapsed = collapsedCutIds.has(cut.id); const layerCount = cut.layers.filter(l => l.type === 'layer').length; const showTrackHeader = _i === 0 || (_arr[_i - 1].track || 0) !== (cut.track || 0); return (
                        <React.Fragment key={cut.id}>
                        {showTrackHeader && <div className="track-group-header">Track {cut.track || 0}</div>}
                        <div className={`cut-item${currentCutId === cut.id ? ' cut-active' : ''}${selectedCutIds.has(cut.id) && selectedCutIds.size > 1 ? ' cut-multi' : ''}`} onClick={e => handleCutClick(e, cut.id)}>
                            <div className="cut-header">
                                {isCur
                                    ? <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutCollapse(cut.id); }} title={collapsed ? '펼치기' : tr('접기')}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
                                    : <span style={{ width: 22, flexShrink: 0, fontSize: 9, color: '#666', textAlign: 'center' }}>L{layerCount}</span>}
                                {renamingCutId === cut.id
                                    ? <input className="time-input" style={{ flex: 1, minWidth: 0 }} autoFocus defaultValue={cut.name}
                                        onClick={e => e.stopPropagation()}
                                        onBlur={e => { renameCut(cut.id, e.target.value.trim() || cut.name); setRenamingCutId(null); }}
                                        onKeyDown={e => { if (e.key === 'Enter') { renameCut(cut.id, e.target.value.trim() || cut.name); setRenamingCutId(null); } if (e.key === 'Escape') setRenamingCutId(null); }} />
                                    : <span className="cut-name" onDoubleClick={e => { e.stopPropagation(); setRenamingCutId(cut.id); }} title={tr('더블클릭으로 이름 변경')}>{cut.name}</span>}
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); handleDuplicateCut(cut.id); }} title={tr('다음 프레임으로 복제 (Ctrl+D)')}><CopyPlus size={12} /></button>
                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); handleCopyCut(cut.id); }} title={tr('컷 복사 (Ctrl+C)')}><Copy size={12} /></button>
                                    <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleCutSettings(cut.id); }} title={tr('설정')}><Settings size={12} /></button>
                                    <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteCut(cut.id); }}><Trash2 size={12} /></button>
                                </div>
                            </div>
                            {isCur && !collapsed && (<>
                            {expandedCuts.has(cut.id) && (
                                <div className="cut-settings" onClick={e => e.stopPropagation()}>
                                    <div className="time-row">
                                        <label>Start<input type="number" step="0.5" min="0" className="time-input" value={cut.startTime} onChange={e => updCutTime(cut.id, 'startTime', e.target.value)} /></label>
                                        <label>End<input type="number" step="0.5" min="0" className="time-input" value={cut.endTime} onChange={e => updCutTime(cut.id, 'endTime', e.target.value)} /></label>
                                    </div>
                                    <CutAnimPanel cut={cut} updCutAnim={updCutAnim} />
                                </div>
                            )}
                            <div className="layer-list" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragLayerInfo && dragLayerInfo.cutId === cut.id) { updLayers(cut.id, c => { const layers = [...c.layers], di = layers.findIndex(l => l.id === dragLayerInfo.layerId), dragged = { ...layers[di], parentId: null }; layers.splice(di, 1); layers.push(dragged); return { layers }; }); setDragLayerInfo(null); setDropInfo(null); } }}>
                                {renderLayers(cut)}
                            </div>
                            {cut.id === currentCutId && (
                                <div className="text-panel">
                                    <div className="text-panel-title">
                                        <span>TEXT</span>
                                        <button className="small-btn" onClick={e => { e.stopPropagation(); handleSetTool('text'); }}>+ Text</button>
                                    </div>
                                    {safeArray(cut.texts).length === 0 && (
                                        <div style={{ fontSize: 11, color: '#666', padding: '6px 2px' }}>{tr('텍스트 없음')}</div>
                                    )}
                                    {safeArray(cut.texts).map(t => (
                                        <div
                                            key={t.id}
                                            className={`text-item${selectedText?.cutId === cut.id && selectedText?.textId === t.id ? ' active' : ''}`}
                                            onClick={e => { e.stopPropagation(); setSelectedText({ cutId: cut.id, textId: t.id }); }}
                                        >
                                            <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTextVisible(cut.id, t.id); }} title={tr('표시')}>
                                                {t.visible === false ? <EyeOff size={10} style={{ color: '#555' }} /> : <Eye size={10} />}
                                            </button>
                                            <div className="text-item-name">{String(t.text ?? '').split('\n')[0] || tr('(빈 텍스트)')}</div>
                                            <button className="icon-btn" onClick={e => { e.stopPropagation(); openEditText(cut.id, t.id); }} title={tr('편집')}><Settings size={11} /></button>
                                            <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); deleteTextObject(cut.id, t.id); }} title={tr('삭제')}><Trash2 size={11} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                <button className="small-btn" onClick={e => handleAddLayer(e, cut.id)}><Plus size={11} /> {tr('레이어')}</button>
                                <button className="small-btn" onClick={e => handleAddFolder(e, cut.id)}><FolderPlus size={11} /> {tr('폴더')}</button>
                            </div>
                            </>)}
                        </div>
                        </React.Fragment>
                    ); })}
                </div>
                <button className="button button-primary" style={{ width: '100%', marginTop: 10, opacity: currentCutId ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }} onClick={() => handleDuplicateCut(currentCutId)} disabled={!currentCutId} title={tr('현재 컷을 다음 프레임으로 복제 (Ctrl+D)')}><CopyPlus size={14} /> {tr('다음 프레임 복제')}</button>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="button" style={{ flex: 1, minWidth: 0 }} onClick={handleAddCut}><Plus size={14} /> Add Cut</button>
                    <button className="button" style={{ flex: 1, minWidth: 0, opacity: copiedCut ? 1 : 0.4 }} onClick={handlePasteCut} disabled={!copiedCut} title={tr('컷 붙여넣기 (Ctrl+V)')}><ClipboardPaste size={14} /> Paste</button>
                </div>
                {selectedCutIds.size > 1 && (
                    <button className="button del-btn" style={{ width: '100%', marginTop: 6, borderColor: 'var(--accent-hi)' }} onClick={() => handleDeleteCut(currentCutId)} title={tr('선택한 컷 삭제 (Delete)')}>
                        <Trash2 size={14} /> 선택 {selectedCutIds.size}컷 삭제
                    </button>
                )}
                {videoBatches.length > 0 && (
                    <div style={{ marginTop: 10, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 8 }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{tr('가져온 영상 프레임')}</div>
                        {videoBatches.map(b => (
                            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#bbb', padding: '3px 0' }}>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                                <span style={{ color: '#777' }}>{b.count}컷</span>
                                <button className="icon-btn del-btn" title={tr('이 영상 프레임 전체 삭제')} onClick={() => deleteVideoBatch(b.id)}><Trash2 size={11} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
    );
}
