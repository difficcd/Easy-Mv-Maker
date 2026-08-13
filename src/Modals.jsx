import React from 'react';
import { Trash2 } from 'lucide-react';
import { tr } from './i18n';
import { targetCanvasFor } from './canvasUtils';

// Overlays and dialogs split out of App.jsx. All state arrives as props; these only display.
// (App.jsx had grown to 4,800 lines, so the screens moved into files you can actually read.)

// Picker for the saved project and backup lists.
export function ProjectPicker({ title, items, onOpen, onDelete, onClose }) {
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 420, maxHeight: '70vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{title}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
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
            </div>
        </div>
    );
}

// Progress for opening or uploading a large project. total 0 means the length is unknown,
// which shows as an indeterminate bar.
export function ProgressOverlay({ progress }) {
    if (!progress) return null;
    const { label, done, total } = progress;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 340, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 10, padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
                <div style={{ fontSize: 13, color: '#ddd', marginBottom: 10 }}>{label}…</div>
                <div style={{ height: 8, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={pct == null
                        ? { height: '100%', width: '40%', borderRadius: 99, background: 'var(--accent)', animation: 'mvIndet 1.1s ease-in-out infinite' }
                        : { height: '100%', width: `${pct}%`, borderRadius: 99, background: 'var(--accent)', transition: 'width .12s linear' }} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{pct == null ? tr('잠시만 기다려 주세요') : `${done} / ${total}`}</span>
                    <span>{pct == null ? '' : `${pct}%`}</span>
                </div>
            </div>
        </div>
    );
}

// Settings (theme and shortcuts). To rebind, click an entry then press the key you want.
export function SettingsModal({
    tab, setTab, onClose,
    themeColor, setThemeColor, themeRecent, defaultTheme,
    uiSat, setUiSat,
    keymap, setKeymap, defaultKeys, keyLabels, rebinding, setRebinding,
    lang, changeLang,
}) {
    const saveKeymap = (next) => { setKeymap(next); try { localStorage.setItem('mv_keymap', JSON.stringify(next)); } catch { } };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ width: 520, maxHeight: '80vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 26%)', borderRadius: 10, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{tr('설정')}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                <div className="pal-tabs" style={{ marginBottom: 10 }}>
                    <button className={`pal-tab${tab === 'theme' ? ' active' : ''}`} onClick={() => { setTab('theme'); setRebinding(null); }}>{tr('테마')}</button>
                    <button className={`pal-tab${tab === 'keys' ? ' active' : ''}`} onClick={() => setTab('keys')}>{tr('단축키')}</button>
                </div>

                {tab === 'theme' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('언어')}</div>
                            <div className="pal-tabs">
                                <button className={`pal-tab${lang === 'en' ? ' active' : ''}`} onClick={() => changeLang('en')}>English</button>
                                <button className={`pal-tab${lang === 'ko' ? ' active' : ''}`} onClick={() => changeLang('ko')}>한국어</button>
                            </div>
                        </div>
                        <div>
                            <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('테마색')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input type="color" className="color-swatch-lg" style={{ width: 46, height: 34 }} value={themeColor} onChange={e => setThemeColor(e.target.value)} title={tr('테마색 직접 선택')} />
                                <span style={{ fontSize: 12, color: '#aaa', flex: 1 }}>{themeColor}</span>
                                <button className="button" style={{ height: 30, padding: '0 12px' }} onClick={() => setThemeColor(defaultTheme)}>{tr('기본')}</button>
                            </div>
                            {/* Recent theme colours: ten fixed slots, empty to begin with. */}
                            <div className="color-section-label" style={{ margin: '10px 0 6px' }}>{tr('최근 사용한 테마색')}</div>
                            <div className="slot-grid" style={{ gridTemplateColumns: 'repeat(10, 1fr)', maxWidth: 320 }}>
                                {Array.from({ length: 10 }, (_, i) => {
                                    const c = themeRecent[i];
                                    return c
                                        ? <button key={i} className={`slot filled${c.toLowerCase() === String(themeColor).toLowerCase() ? ' sel' : ''}`}
                                            style={{ background: c }} title={c} onClick={() => setThemeColor(c)} />
                                        : <span key={i} className="slot empty" />;
                                })}
                            </div>
                        </div>
                        <div>
                            <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('UI 채도 — 패널·버튼 배경에 테마색이 섞이는 정도')}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="range" min="0" max="60" step="1" value={uiSat} onChange={e => setUiSat(+e.target.value)} style={{ flex: 1 }} />
                                <input type="number" className="time-input" style={{ width: 60 }} min="0" max="60" value={uiSat}
                                    onChange={e => setUiSat(Math.max(0, Math.min(60, +e.target.value || 0)))} />
                                <span style={{ fontSize: 11, color: '#888' }}>%</span>
                            </div>
                            <div style={{ fontSize: 10, color: '#777', marginTop: 4 }}>{tr('0%로 두면 완전한 무채색 회색 UI가 됩니다.')}</div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                            {rebinding ? tr('원하는 키를 누르세요 (Esc = 취소)') : tr('바꿀 항목을 누른 뒤 새 키를 누르세요.')}
                        </div>
                        {Object.keys(defaultKeys).map(id => (
                            <div key={id} className="key-row" style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)' }}>
                                <span style={{ flex: 1, color: '#ddd' }}>{tr(keyLabels[id])}</span>
                                <button className="button" style={{ height: 30, minWidth: 110, justifyContent: 'center', background: rebinding === id ? 'var(--accent)' : undefined }}
                                    onClick={() => setRebinding(rebinding === id ? null : id)}>
                                    {rebinding === id ? tr('키 입력 대기…') : (keymap[id] || tr('(없음)'))}
                                </button>
                                {keymap[id] !== defaultKeys[id] && (
                                    <button className="small-btn" title={tr('기본값으로')} onClick={() => saveKeymap({ ...keymap, [id]: defaultKeys[id] })}>{tr('되돌리기')}</button>
                                )}
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                            <span style={{ fontSize: 10, color: '#777' }}>{tr('Ctrl+S 저장 · Ctrl+Z/Y 등 기본 조합은 항상 동작합니다')}</span>
                            <button className="button" onClick={() => saveKeymap({ ...defaultKeys })}>{tr('전체 기본값')}</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// Shortcut and gesture help.
export function HelpModal({ keymap, onClose }) {
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: '80vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 8, padding: 18, fontSize: 12.5, color: '#ccc', lineHeight: 1.7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{tr('단축키 · 제스처')}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                <b style={{ color: '#9aa' }}>{tr('키보드')}</b>
                <div>{tr('Ctrl+Z 실행취소 · Ctrl+Shift+Z / Ctrl+Y 다시실행')}</div>
                <div>{tr('Ctrl+C 컷 복사 · Ctrl+V 붙여넣기 · Ctrl+D 다음 프레임 복제')}</div>
                <div>{tr('Ctrl+S 저장 · Esc 선택 취소 · Enter 선택 적용')}</div>
                <div><b>{keymap.undo}</b> {tr('실행취소 ·')} <b>{keymap.redo}</b> {tr('다시실행 ·')} <b>{keymap.brushDown}</b>/<b>{keymap.brushUp}</b> {tr('브러시 크기 ·')} <b>{keymap.zoomOut}</b>/<b>{keymap.zoomIn}</b> {tr('캔버스 축소/확대 (상단 ⚙에서 변경)')}</div>
                <div>{tr('move 도구: 빈 곳을 끌면')} <b>{tr('그림 전체가 이동')}</b>{tr('합니다(선택 범위 불필요).')} <b>{tr('Alt+드래그')}</b> {tr('= 활성 레이어만')}</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('펜 / 손가락')}</b></div>
                <div>{tr('펜(S펜)·마우스 = 그리기 / 손가락은 그려지지 않음(팜 리젝션)')}</div>
                <div>{tr('캔버스: 손가락 1개 = 이동, 2개 = 핀치 줌 (우상단 ⟲ 초기화)')}</div>
                <div>PC: <b>{tr('스페이스바 + 드래그 = 화면 이동')}</b> {tr('· 휠 클릭 드래그도 이동 · 휠 = 줌')}</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('타임라인')}</b></div>
                <div>{tr('1손가락 드래그 = 이동, 탭 = 재생위치 / 2손가락 = 확대·축소')}</div>
                <div>PC: <b>{tr('휠(가운데) 클릭 드래그 = 타임라인 이동')}</b></div>
                <div>{tr('컷: 길게 눌러 이동 · 가장자리 드래그로 길이조절 · 더블클릭 이름변경 · Ctrl/Shift+클릭 다중선택')}</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('팁')}</b></div>
                <div>{tr('애니메이션(컷·파츠)은 ▶ 재생 시에만 보입니다. 올가미 → "파츠로 분리"로 부분 애니메이션.')}</div>
            </div>
        </div>
    );
}

// The video-to-frame-cuts import dialog. While extracting it shows only progress;
// pressing "Send to background" closes it and the work continues in the corner chip.
export function VideoImportModal({
    videoImport, setVideoImport, videoBusy, setVideoBusyBg, videoStopRef,
    runVideoImport, loadVideoOverlay, loadAudioUrl, parseClock, setShowHelp, canvasW, canvasH, setCanvasSize,
}) {
    return (
        <div onClick={() => { if (!videoBusy) setVideoImport(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 420, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid #333', borderRadius: 8, padding: 18, color: '#ccc', fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span className="panel-title">{tr('영상 → 프레임 컷')}</span>
                    {!videoBusy && <button className="icon-btn" onClick={() => setVideoImport(null)}>✕</button>}
                </div>
                <div style={{ marginBottom: 10, color: '#9aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{videoImport.file.name}</div>
                {videoBusy ? (
                    <>
                        <div style={{ marginBottom: 8 }}>{tr('프레임 추출 중…')} {videoBusy.done}/{videoBusy.total || '?'}{videoBusy.skipped ? ' ' + tr('(중복 {0}컷 통합)', videoBusy.skipped) : ''}</div>
                        <div style={{ height: 8, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: 'var(--accent-soft)' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                            <span style={{ color: '#888', fontSize: 11 }}>{tr('백그라운드로 두고 다른 작업을 계속할 수 있어요.')}</span>
                            <span style={{ display: 'flex', gap: 6 }}>
                                <button className="button" onClick={() => setVideoBusyBg(true)}>{tr('백그라운드로')}</button>
                                <button className="button" onClick={() => { videoStopRef.current = true; }}>{tr('중지')}</button>
                            </span>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ width: 76 }}>{tr('초당 프레임')}</span>
                            <select className="time-input" style={{ width: 80 }} value={videoImport.fps} onChange={e => setVideoImport(v => ({ ...v, fps: +e.target.value }))}>
                                {[1, 2, 3, 4, 6, 8, 12, 15, 24].map(v => <option key={v} value={v}>{v} fps</option>)}
                            </select>
                            {videoImport.quality === 'compressed' && <>
                                <span style={{ width: 50, marginLeft: 6 }}>{tr('배율')}</span>
                                <select className="time-input" style={{ width: 80 }} value={videoImport.scale} onChange={e => setVideoImport(v => ({ ...v, scale: +e.target.value }))}>
                                    {[[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.35, '35%'], [0.25, '25%']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                            </>}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="checkbox" checked={videoImport.whole} onChange={e => setVideoImport(v => ({ ...v, whole: e.target.checked }))} /> {tr('영상 전체')}
                            </label>
                            {!videoImport.whole && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('가져올 컷 개수 (중복 병합분은 제외한 실제 컷 수)')}>
                                    <input type="number" className="time-input" style={{ width: 70 }} min={1} max={5000} value={videoImport.maxFrames}
                                        onChange={e => setVideoImport(v => ({ ...v, maxFrames: Math.max(1, Math.min(5000, Math.floor(+e.target.value) || 1)) }))} />
                                    <span style={{ color: '#888' }}>{tr('컷')}</span>
                                </label>
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="checkbox" checked={videoImport.withAudio} onChange={e => setVideoImport(v => ({ ...v, withAudio: e.target.checked }))} /> {tr('음원도 같이')}
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('영상의 일부 구간만 가져오기 (mm:ss)')}>
                                <input type="checkbox" checked={videoImport.rangeOn} onChange={e => setVideoImport(v => ({ ...v, rangeOn: e.target.checked }))} /> {tr('구간만')}
                            </label>
                            {videoImport.rangeOn && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <input className="time-input" style={{ width: 60 }} placeholder="0:00" value={videoImport.startText} onChange={e => setVideoImport(v => ({ ...v, startText: e.target.value }))} />
                                    <span style={{ color: '#888' }}>~</span>
                                    <input className="time-input" style={{ width: 60 }} placeholder={tr('끝')} value={videoImport.endText} onChange={e => setVideoImport(v => ({ ...v, endText: e.target.value }))} />
                                </span>
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('화질/용량 선택. 고화질=원본 해상도 WebP(거의 무손실, 용량 적당) / 무손실=PNG(픽셀 완전 보존, 용량 큼)')}>
                                <span style={{ color: '#888' }}>{tr('화질')}</span>
                                <select className="time-input" style={{ width: 118 }} value={videoImport.quality} onChange={e => setVideoImport(v => ({ ...v, quality: e.target.value }))}>
                                    <option value="compressed">{tr('압축(작음)')}</option>
                                    <option value="high">{tr('고화질 WebP')}</option>
                                    <option value="lossless">{tr('무손실 PNG')}</option>
                                </select>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('긴 영상을 여러 파트로 나눠서 가져오기 (재생 시 파트별/전체 선택 가능)')}>
                                <input type="number" className="time-input" style={{ width: 46 }} min={1} max={50} value={videoImport.parts}
                                    onChange={e => setVideoImport(v => ({ ...v, parts: Math.max(1, Math.min(50, Math.floor(+e.target.value) || 1)) }))} />
                                <span style={{ color: 'var(--accent-soft)' }}>{tr('파트로 나누기')}</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('세로 영상(쇼츠)을 가로 캔버스에 넣으면 대부분이 여백이 됩니다. 영상에 맞추거나 직접 고르세요.')}>
                                <span style={{ color: '#888' }}>{tr('캔버스 크기')}</span>
                                <select className="time-input" style={{ width: 150 }} value={videoImport.canvasMode || 'source'}
                                    onChange={e => setVideoImport(v => ({ ...v, canvasMode: e.target.value }))}>
                                    <option value="source">{tr('영상 크기대로')}</option>
                                    <option value="landscape">{tr('일반 (가로 1920×1080)')}</option>
                                    <option value="portrait">{tr('쇼츠 (세로 1080×1920)')}</option>
                                    <option value="keep">{tr('현재 캔버스 유지')}</option>
                                </select>
                            </label>
                            <span style={{ marginLeft: 'auto' }}>{tr('중복 통합')}</span>
                            <select className="time-input" style={{ width: 100 }} value={videoImport.dedupe} onChange={e => setVideoImport(v => ({ ...v, dedupe: e.target.value === 'exact' ? 'exact' : +e.target.value }))}>
                                {[['0', tr('끄기')], ['exact', tr('완전 동일')], ['3', tr('거의 같음')], ['8', tr('느슨')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </div>
                        <div style={{ color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                            {(() => {
                                const t = targetCanvasFor(videoImport, canvasW, canvasH);
                                const changes = t.w !== canvasW || t.h !== canvasH;
                                return <>
                                    {tr('캔버스({0}×{1})에 비율 유지로 넣고, 현재 트랙 뒤에 이어서 생성됩니다.', t.w, t.h)}
                                    {changes && <> <b style={{ color: 'var(--accent-soft)' }}>{tr('가져오면 캔버스가 {0}×{1}로 바뀝니다.', t.w, t.h)}</b></>}
                                </>;
                            })()}<br />
                            {videoImport.quality === 'lossless'
                                ? <><b style={{ color: 'var(--accent-soft)' }}>{tr('무손실 PNG')}</b> {tr('— 픽셀 완전 보존, 장당 용량이 큽니다(수 MB). 긴 영상은')} <b>{tr('고화질 WebP')}</b>{tr('를 권장.')}</>
                                : videoImport.quality === 'high'
                                    ? <>{tr('원본 해상도')} <b style={{ color: 'var(--accent-soft)' }}>{tr('고화질 WebP(거의 무손실)')}</b> {tr('— 무손실 대비 용량 약 1/5~1/8, 화질 차이는 거의 없음.')}</>
                                    : <>{tr('프레임은')} <b style={{ color: '#9b9' }}>{tr('WebP로 압축 저장')}</b>{tr('되어 원본 대비 용량이 크게 줄어듭니다')}{videoImport.scale < 1 ? ' ' + tr('(배율 {0}%로 추가 절감)', Math.round(videoImport.scale * 100)) : ''}.</>}
                            {videoImport.dedupe === 'exact'
                                ? <><br /><b style={{ color: '#9b9' }}>{tr('완전히 똑같은 프레임만')}</b> {tr('한 컷으로 합칩니다 (픽셀 단위 비교).')}</>
                                : videoImport.dedupe > 0 && <><br />{tr('이어지는')} <b style={{ color: '#9b9' }}>{tr('비슷한 화면을 한 컷으로 합칩니다')}</b> {tr('— 정지 구간이 길수록 컷 수·용량이 줄어듭니다.')}</>}
                            {!videoImport.whole && <><br />{tr('지정한 {0}컷은 중복 병합을 제외한 실제 컷 수입니다 (합쳐진 프레임은 개수에 안 셉니다).', videoImport.maxFrames)}</>}
                            {videoImport.rangeOn && <><br /><b style={{ color: 'var(--accent-soft)' }}>{videoImport.startText || '0:00'} ~ {videoImport.endText || tr('끝')}</b> {tr('구간만 가져옵니다 (mm:ss).')}</>}
                            {videoImport.parts > 1 && <><br /><b style={{ color: 'var(--accent-soft)' }}>{tr('{0}개 파트', videoImport.parts)}</b>{' '}{tr('로 나눠 가져옵니다 — 재생 시 파트별 또는 전체로 볼 수 있습니다.')}</>}
                            {videoImport.whole && <><br /><span style={{ color: '#c99' }}>{tr('전체 추출: 길이가 길면 컷이 매우 많아집니다. fps를 낮게(1~4) 두는 것을 권장합니다.')}</span></>}
                        </div>
                        {/* The text must be allowed to shrink and the button not to: without flex:1 and
                            min-width:0 the longer English copy collapses into a one-word column. */}
                        <div style={{ background: 'hsl(var(--ui-h) var(--ui-s) 12%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 6, padding: '8px 10px', marginBottom: 10, color: 'var(--accent-pale)', fontSize: 11.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ flex: '1 1 240px', minWidth: 0 }}><b style={{ color: '#8de' }}>{tr('영상 위에 덧그리기')}</b> {tr('— 프레임으로 쪼개지 않고 원본 영상을 트랙으로 깔고 그 위에 그림·텍스트. 24fps 장편도 매끄럽게 재생.')} <b style={{ color: '#8de' }}>{tr('음원도 함께')}</b> {tr('들어갑니다.')}</span>
                            <button className="button" style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }} onClick={() => {
                                const useRange = videoImport.rangeOn && parseClock(videoImport.endText) > parseClock(videoImport.startText);
                                const off = useRange ? parseClock(videoImport.startText) : 0;
                                const clip = useRange ? (parseClock(videoImport.endText) - parseClock(videoImport.startText)) : null;
                                // The canvas-size choice above applies here too. Without it a
                                // portrait clip laid down as-is is letterboxed into a landscape
                                // canvas - the same thing the frame importer does with it.
                                const tgt = targetCanvasFor(videoImport, canvasW, canvasH);
                                if (tgt.w !== canvasW || tgt.h !== canvasH) setCanvasSize({ w: tgt.w, h: tgt.h });
                                loadVideoOverlay(videoImport.file, videoImport.label || videoImport.file.name, 0, off, clip);
                                // The overlay <video> is muted; always bring the audio via a synced audio track.
                                loadAudioUrl(URL.createObjectURL(videoImport.file), (videoImport.label || tr('영상')) + tr(' (음원)'), 0, off, clip);
                                setVideoImport(null);
                            }}>{tr('영상 그대로 깔기(+음원)')}</button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button className="button" onClick={() => setVideoImport(null)}>{tr('취소')}</button>
                            <button className="button button-primary" onClick={runVideoImport}>{tr('프레임으로 가져오기')}</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// Scene-change detection settings. Only opens when there is a video overlay.
export function SceneDetectModal({ sceneCfg, setSceneCfg, sceneDetect, runSceneDetect }) {
    return (
        <div onClick={() => setSceneCfg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 360, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid #333', borderRadius: 8, padding: 18, color: '#ccc', fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span className="panel-title">{tr('🎯 장면(컷) 감지')}</span>
                    <button className="icon-btn" onClick={() => setSceneCfg(null)}>✕</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 56 }}>{tr('민감도')}</span>
                    <input type="range" min={6} max={30} step={1} value={30 - sceneCfg.threshold + 6} onChange={e => setSceneCfg(v => ({ ...v, threshold: 30 - (+e.target.value) + 6 }))} style={{ flex: 1 }} />
                    <span style={{ width: 60, color: '#888', textAlign: 'right' }}>{sceneCfg.threshold <= 10 ? tr('민감') : sceneCfg.threshold >= 20 ? tr('둔감') : tr('보통')}</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <input type="checkbox" checked={sceneCfg.rangeOn} onChange={e => setSceneCfg(v => ({ ...v, rangeOn: e.target.checked }))} /> {tr('구간만 감지 (전체보다 빠름)')}
                </label>
                {sceneCfg.rangeOn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingLeft: 22 }}>
                        <input className="time-input" style={{ width: 70 }} placeholder="0:00" value={sceneCfg.startText} onChange={e => setSceneCfg(v => ({ ...v, startText: e.target.value }))} />
                        <span style={{ color: '#888' }}>~</span>
                        <input className="time-input" style={{ width: 70 }} placeholder={tr('끝(mm:ss)')} value={sceneCfg.endText} onChange={e => setSceneCfg(v => ({ ...v, endText: e.target.value }))} />
                    </div>
                )}
                <div style={{ color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                    {tr('장면이 바뀌는 지점을 정밀하게 찾아')} <b style={{ color: '#fde047' }}>{tr('노란 표시')}</b>{tr('로 타임라인에 찍습니다. 민감도를 올리면 미세한 전환도 잡습니다.')}
                    {sceneDetect && <><br /><b style={{ color: 'var(--accent-soft)' }}>{tr('감지 중…')} {sceneDetect.total ? Math.round(sceneDetect.done / sceneDetect.total * 100) : 0}%</b></>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <button className="button" onClick={() => setSceneCfg(null)}>{tr('닫기')}</button>
                    <button className="button button-primary" disabled={!!sceneDetect} onClick={() => runSceneDetect(sceneCfg)}>{sceneDetect ? tr('감지 중…') : tr('감지')}</button>
                </div>
            </div>
        </div>
    );
}

// Link input. This used window.prompt, but once the browser blocks dialogs - one tick of
// "prevent additional dialogs" and it sticks - prompt silently returns null and nothing
// happens, so the button looks dead. Asking inside the app avoids that entirely.
export function LinkPromptModal({ title, placeholder, onSubmit, onClose }) {
    const [url, setUrl] = React.useState('');
    const inputRef = React.useRef(null);
    React.useEffect(() => { inputRef.current?.focus(); }, []);
    const submit = () => { const v = url.trim(); if (v) onSubmit(v); };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 460, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 26%)', borderRadius: 10, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{title}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
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
            </div>
        </div>
    );
}
