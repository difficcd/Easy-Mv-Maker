import React from 'react';
import { Trash2 } from 'lucide-react';

// App.jsx에서 분리한 오버레이/대화상자들. 상태는 전부 props로 받아 순수 표시 역할만 한다.
// (App.jsx가 4800줄까지 커져서, 화면 조각을 파일로 나눠 읽고 고치기 쉽게 만든 것)

// 저장된 프로젝트/백업 목록 고르기
export function ProjectPicker({ title, items, onOpen, onDelete, onClose }) {
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 420, maxHeight: '70vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">{title}</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                {items.length === 0 && <div style={{ fontSize: 12, color: '#888', padding: '12px 2px' }}>저장된 프로젝트가 없습니다.</div>}
                {items.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)' }}>
                        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(p.id, p.name)}>
                            <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: '#777' }}>{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</div>
                        </div>
                        <button className="button" style={{ height: 28, padding: '0 10px' }} onClick={() => onOpen(p.id, p.name)}>열기</button>
                        <button className="icon-btn del-btn" onClick={() => onDelete(p.id)}><Trash2 size={13} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// 큰 프로젝트 열기/업로드 진행률. total 0이면 진행률을 알 수 없는 구간(무한 게이지).
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
                    <span>{pct == null ? '잠시만 기다려 주세요' : `${done} / ${total}`}</span>
                    <span>{pct == null ? '' : `${pct}%`}</span>
                </div>
            </div>
        </div>
    );
}

// 설정 (테마 / 단축키). 단축키는 항목을 누른 뒤 원하는 키를 누르면 그 조합으로 바뀐다.
export function SettingsModal({
    tab, setTab, onClose,
    themeColor, setThemeColor, themeRecent, defaultTheme,
    uiSat, setUiSat,
    keymap, setKeymap, defaultKeys, keyLabels, rebinding, setRebinding,
}) {
    const saveKeymap = (next) => { setKeymap(next); try { localStorage.setItem('mv_keymap', JSON.stringify(next)); } catch { } };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ width: 520, maxHeight: '80vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 26%)', borderRadius: 10, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">설정</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                <div className="pal-tabs" style={{ marginBottom: 10 }}>
                    <button className={`pal-tab${tab === 'theme' ? ' active' : ''}`} onClick={() => { setTab('theme'); setRebinding(null); }}>테마</button>
                    <button className={`pal-tab${tab === 'keys' ? ' active' : ''}`} onClick={() => setTab('keys')}>단축키</button>
                </div>

                {tab === 'theme' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <div className="color-section-label" style={{ marginBottom: 6 }}>테마색</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input type="color" className="color-swatch-lg" style={{ width: 46, height: 34 }} value={themeColor} onChange={e => setThemeColor(e.target.value)} title="테마색 직접 선택" />
                                <span style={{ fontSize: 12, color: '#aaa', flex: 1 }}>{themeColor}</span>
                                <button className="button" style={{ height: 30, padding: '0 12px' }} onClick={() => setThemeColor(defaultTheme)}>기본</button>
                            </div>
                            {/* 최근 사용한 테마색 (10칸 고정, 처음엔 비어있음) */}
                            <div className="color-section-label" style={{ margin: '10px 0 6px' }}>최근 사용한 테마색</div>
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
                            <div className="color-section-label" style={{ marginBottom: 6 }}>UI 채도 — 패널·버튼 배경에 테마색이 섞이는 정도</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="range" min="0" max="60" step="1" value={uiSat} onChange={e => setUiSat(+e.target.value)} style={{ flex: 1 }} />
                                <input type="number" className="time-input" style={{ width: 60 }} min="0" max="60" value={uiSat}
                                    onChange={e => setUiSat(Math.max(0, Math.min(60, +e.target.value || 0)))} />
                                <span style={{ fontSize: 11, color: '#888' }}>%</span>
                            </div>
                            <div style={{ fontSize: 10, color: '#777', marginTop: 4 }}>0%로 두면 완전한 무채색 회색 UI가 됩니다.</div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                            {rebinding ? '원하는 키를 누르세요 (Esc = 취소)' : '바꿀 항목을 누른 뒤 새 키를 누르세요.'}
                        </div>
                        {Object.keys(defaultKeys).map(id => (
                            <div key={id} className="key-row" style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)' }}>
                                <span style={{ flex: 1, color: '#ddd' }}>{keyLabels[id]}</span>
                                <button className="button" style={{ height: 30, minWidth: 110, justifyContent: 'center', background: rebinding === id ? 'var(--accent)' : undefined }}
                                    onClick={() => setRebinding(rebinding === id ? null : id)}>
                                    {rebinding === id ? '키 입력 대기…' : (keymap[id] || '(없음)')}
                                </button>
                                {keymap[id] !== defaultKeys[id] && (
                                    <button className="small-btn" title="기본값으로" onClick={() => saveKeymap({ ...keymap, [id]: defaultKeys[id] })}>되돌리기</button>
                                )}
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                            <span style={{ fontSize: 10, color: '#777' }}>Ctrl+S 저장 · Ctrl+Z/Y 등 기본 조합은 항상 동작합니다</span>
                            <button className="button" onClick={() => saveKeymap({ ...defaultKeys })}>전체 기본값</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// 단축키 · 제스처 도움말
export function HelpModal({ keymap, onClose }) {
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: '80vh', overflow: 'auto', background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 8, padding: 18, fontSize: 12.5, color: '#ccc', lineHeight: 1.7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="panel-title">단축키 · 제스처</span>
                    <button className="icon-btn" onClick={onClose}>✕</button>
                </div>
                <b style={{ color: '#9aa' }}>키보드</b>
                <div>Ctrl+Z 실행취소 · Ctrl+Shift+Z / Ctrl+Y 다시실행</div>
                <div>Ctrl+C 컷 복사 · Ctrl+V 붙여넣기 · Ctrl+D 다음 프레임 복제</div>
                <div>Ctrl+S 저장 · Esc 선택 취소 · Enter 선택 적용</div>
                <div><b>{keymap.undo}</b> 실행취소 · <b>{keymap.redo}</b> 다시실행 · <b>{keymap.brushDown}</b>/<b>{keymap.brushUp}</b> 브러시 크기 · <b>{keymap.zoomOut}</b>/<b>{keymap.zoomIn}</b> 캔버스 축소/확대 (상단 ⚙에서 변경)</div>
                <div>move 도구: 빈 곳을 끌면 <b>그림 전체가 이동</b>합니다(선택 범위 불필요). <b>Alt+드래그</b> = 활성 레이어만</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>펜 / 손가락</b></div>
                <div>펜(S펜)·마우스 = 그리기 / 손가락은 그려지지 않음(팜 리젝션)</div>
                <div>캔버스: 손가락 1개 = 이동, 2개 = 핀치 줌 (우상단 ⟲ 초기화)</div>
                <div>PC: <b>스페이스바 + 드래그 = 화면 이동</b> · 휠 클릭 드래그도 이동 · 휠 = 줌</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>타임라인</b></div>
                <div>1손가락 드래그 = 이동, 탭 = 재생위치 / 2손가락 = 확대·축소</div>
                <div>PC: <b>휠(가운데) 클릭 드래그 = 타임라인 이동</b></div>
                <div>컷: 길게 눌러 이동 · 가장자리 드래그로 길이조절 · 더블클릭 이름변경 · Ctrl/Shift+클릭 다중선택</div>
                <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>팁</b></div>
                <div>애니메이션(컷·파츠)은 ▶ 재생 시에만 보입니다. 올가미 → "파츠로 분리"로 부분 애니메이션.</div>
            </div>
        </div>
    );
}
