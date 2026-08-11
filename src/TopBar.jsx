import React from 'react';
import { ChevronDown, Download, Upload, Film, Settings } from 'lucide-react';
import { tr } from './i18n';

// Top menu bar: the File and Media menus, resolution, canvas zoom, save state, Export.
export function TopBar({
    doNew, doSave, doOpen, doLocalSave, openLocalList,
    doServerSave, openServerList, doServerBackup, openBackupList, backupBusy,
    handleAudioUpload, loadYoutubeAudio, handleDeleteAudio, audioFile, openVideoImport,
    loadYoutubeVideo, videoFileRef, recentVideos, reimportRecent, serverAvailable,
    showFileMenu, setShowFileMenu, showMediaMenu, setShowMediaMenu, fileMenuRef,
    mediaMenuRef, canvasW, canvasH, setCanvasSize, setShowHelp,
    setShowSettings, keymap, view, zoomCanvas, resetView,
    autoSavedAt, autosaveErr, backupAt, storageInfo, handleExport,
}) {
    return (
        <div className="top-bar">
            <h1 className="title">Easy MV Maker</h1>
            <div className="menu-divider" />
            {/* File menu. */}
            <div style={{ position: 'relative' }} ref={fileMenuRef}>
                <button className="button" onClick={() => setShowFileMenu(v => !v)}>{tr('파일')} <ChevronDown size={12} /></button>
                {showFileMenu && (
                    <div className="file-menu">
                        <button className="file-menu-item" onClick={() => { doNew(); setShowFileMenu(false); }}>{tr('새 프로젝트')}</button>
                        <div className="file-menu-sep" />
                        <button className="file-menu-item" onClick={() => { doSave(false); setShowFileMenu(false); }}>{tr('저장 (Ctrl+S)')}</button>
                        <button className="file-menu-item" onClick={() => { doSave(true); setShowFileMenu(false); }}>{tr('다른 이름으로 저장...')}</button>
                        <div className="file-menu-sep" />
                        <button className="file-menu-item" onClick={() => { doOpen(); setShowFileMenu(false); }}>{tr('로컬 파일 열기...')}</button>
                        <div className="file-menu-sep" />
                        <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('로컬 (브라우저 저장)')}</div>
                        <button className="file-menu-item" onClick={() => { doLocalSave(false); setShowFileMenu(false); }}>{tr('로컬에 저장')}</button>
                        <button className="file-menu-item" onClick={() => { doLocalSave(true); setShowFileMenu(false); }}>{tr('로컬에 새 이름으로 저장...')}</button>
                        <button className="file-menu-item" onClick={() => { openLocalList(); setShowFileMenu(false); }}>{tr('로컬에서 열기...')}</button>
                        {serverAvailable && <>
                            <div className="file-menu-sep" />
                            <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('서버 (DB)')}</div>
                            <button className="file-menu-item" onClick={() => { doServerSave(false); setShowFileMenu(false); }}>{tr('서버에 저장')}</button>
                            <button className="file-menu-item" onClick={() => { doServerSave(true); setShowFileMenu(false); }}>{tr('서버에 새 이름으로 저장...')}</button>
                            <button className="file-menu-item" onClick={() => { openServerList(); setShowFileMenu(false); }}>{tr('서버에서 열기...')}</button>
                            <div className="file-menu-sep" />
                            <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('자동 백업 (되돌리기용)')}</div>
                            <button className="file-menu-item" onClick={() => { doServerBackup(false); setShowFileMenu(false); }} disabled={backupBusy}>
                                {backupBusy ? tr('백업 중…') : tr('지금 서버에 백업')}
                            </button>
                            <button className="file-menu-item" onClick={() => { openBackupList(); setShowFileMenu(false); }}>{tr('백업에서 되돌리기...')}</button>
                        </>}
                    </div>
                )}
            </div>
            {/* Media menu: audio, video and YouTube. */}
            <div style={{ position: 'relative' }} ref={mediaMenuRef}>
                <button className="button" onClick={() => setShowMediaMenu(v => !v)}>{tr('미디어')} <ChevronDown size={12} /></button>
                {showMediaMenu && (
                    <div className="file-menu" style={{ minWidth: 220 }}>
                        <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('음원')}</div>
                        <label className="file-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <Upload size={14} /> {audioFile ? audioFile.name : tr('음원 불러오기...')}
                            <input type="file" accept="audio/*" onChange={e => { handleAudioUpload(e); setShowMediaMenu(false); }} style={{ display: 'none' }} />
                        </label>
                        {serverAvailable && <button className="file-menu-item" onClick={() => { loadYoutubeAudio(); setShowMediaMenu(false); }}>{tr('유튜브에서 음원 추출')}</button>}
                        {audioFile && <button className="file-menu-item" onClick={() => { handleDeleteAudio(); setShowMediaMenu(false); }}>{tr('음원 삭제')}</button>}
                        <div className="file-menu-sep" />
                        <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('영상')}</div>
                        <label className="file-menu-item" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title={tr('영상을 프레임별 컷으로 가져오기')}>
                            <Film size={14} /> {tr('영상 프레임 가져오기...')}
                            <input type="file" accept="video/*" ref={videoFileRef} style={{ display: 'none' }}
                                onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) { openVideoImport(f); setShowMediaMenu(false); } }} />
                        </label>
                        {serverAvailable && <button className="file-menu-item" onClick={() => { loadYoutubeVideo(); setShowMediaMenu(false); }}>{tr('유튜브 영상 프레임 추출')}</button>}
                        {recentVideos.length > 0 && <>
                            <div className="file-menu-sep" />
                            <div style={{ fontSize: 10, color: '#777', padding: '4px 12px 2px' }}>{tr('다시 가져오기 (프레임 교체)')}</div>
                            {recentVideos.map(v => <button key={v.id} className="file-menu-item" style={{ fontSize: 11 }} onClick={() => { reimportRecent(v); setShowMediaMenu(false); }}>↻ {v.name.slice(0, 26)}</button>)}
                        </>}
                    </div>
                )}
            </div>
            <div className="menu-divider" />
            {/* Resolution. */}
            <select className="time-input" style={{ height: 30, width: 116 }} title={tr('캔버스 해상도')}
                value={`${canvasW}x${canvasH}`}
                onChange={e => {
                    if (e.target.value === 'custom') {
                        const s = window.prompt(tr('캔버스 크기 (가로x세로)'), `${canvasW}x${canvasH}`);
                        if (!s) return;
                        const m = s.match(/(\d+)\s*[xX*,\s]\s*(\d+)/);
                        if (!m) { alert(tr('예: 1920x1080')); return; }
                        setCanvasSize({ w: Math.max(64, Math.min(8192, +m[1])), h: Math.max(64, Math.min(8192, +m[2])) });
                    } else {
                        const [w, h] = e.target.value.split('x').map(Number);
                        setCanvasSize({ w, h });
                    }
                }}>
                {['1280x720', '1920x1080', '2560x1440', '3840x2160', '1080x1080', '2048x2048', '1080x1920', '2160x3840'].map(v => <option key={v} value={v}>{v}{v === '3840x2160' ? ' (4K)' : ''}</option>)}
                {!['1280x720', '1920x1080', '2560x1440', '3840x2160', '1080x1080', '2048x2048', '1080x1920', '2160x3840'].includes(`${canvasW}x${canvasH}`) && <option value={`${canvasW}x${canvasH}`}>{canvasW}x{canvasH}</option>}
                <option value="custom">{tr('직접 입력…')}</option>
            </select>
            <button className="icon-btn" onClick={() => setShowHelp(true)} title={tr('단축키 · 도움말')} style={{ fontSize: 13, fontWeight: 700, width: 24, height: 24 }}>?</button>
            {/* Canvas zoom, to the right of the resolution picker and the help button. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} title={tr('캔버스 확대/축소 ({0} / {1})', keymap.zoomOut, keymap.zoomIn)}>
                <button className="icon-btn" style={{ width: 24, height: 24, fontSize: 15 }} onClick={() => zoomCanvas(1 / 1.25)}>−</button>
                <button className="button" style={{ height: 24, padding: '0 6px', fontSize: 11, minWidth: 46, justifyContent: 'center' }}
                    onClick={resetView} title={tr('클릭하면 100%로')}>{Math.round(view.zoom * 100)}%</button>
                <button className="icon-btn" style={{ width: 24, height: 24, fontSize: 15 }} onClick={() => zoomCanvas(1.25)}>＋</button>
            </div>
            <button className="icon-btn" onClick={() => setShowSettings(true)} title={tr('단축키 직접 설정')} style={{ width: 24, height: 24 }}><Settings size={13} /></button>
            <div className="menu-spacer" />
            {audioFile && <span style={{ fontSize: 11, color: 'var(--accent-pale)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={audioFile.name}>♪ {audioFile.name}</span>}
            {autosaveErr
                ? <span style={{ fontSize: 11, color: '#f66', fontWeight: 700 }} title={tr('자동저장 실패: {0}\n저장공간이 가득 찼을 수 있습니다. 파일로 내보내기 또는 서버 저장을 권장합니다.', autosaveErr)}>{tr('⚠ 자동저장 실패')}</span>
                : autoSavedAt && <span style={{ fontSize: 11, color: 'var(--accent-soft)' }} title={tr('브라우저에 자동저장됨')}>● {tr('자동저장')} {new Date(autoSavedAt).toLocaleTimeString()}</span>}
            {/* Say plainly that without a server the work stays local. Working on unaware and
                then losing it is the worst outcome here. */}
            {!serverAvailable
                ? <span style={{ fontSize: 11, color: '#e0a84e' }} title={tr('API 서버에 연결할 수 없어 서버 저장/백업이 비활성화됩니다. 작업은 이 브라우저에만 저장됩니다.')}>{tr('⚠ 로컬 전용')}</span>
                : backupAt && <span style={{ fontSize: 11, color: 'var(--accent-pale)' }} title={tr('서버에 백업된 시각 (파일 > 백업에서 되돌리기)')}>⛁ {tr('백업')} {new Date(backupAt).toLocaleTimeString()}</span>}
            {storageInfo && storageInfo.pct > 0.8 && (
                <span style={{ fontSize: 11, color: storageInfo.pct > 0.92 ? '#f66' : '#e0a84e' }}
                    title={tr('브라우저 저장공간 {0}GB / {1}GB 사용 중. 가득 차면 자동저장이 실패할 수 있으니 서버 저장 또는 파일로 내보내기를 권장합니다.', (storageInfo.usage / 1073741824).toFixed(2), (storageInfo.quota / 1073741824).toFixed(2))}>
                    ⚠ {tr('저장공간')} {Math.round(storageInfo.pct * 100)}%
                </span>
            )}
            <button className="button button-primary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }}><Download size={15} /> Export</button>
        </div>
    );
}
