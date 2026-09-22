import { KeyConflicts, KeyRows } from './ToolKeysModal.tsx';
import { tr } from '../../i18n.ts';
import { TOOL_PREFIX } from '../../core/shortcuts.ts';
import { Modal } from '../Modal.tsx';
import { fmt } from '../../core/timeCode.ts';
import { NumField, clampNum } from '../NumField.tsx';
import type { BakePlan } from '../../core/timeScale.ts';
import type { KeymapEditorProps } from './ToolKeysModal.tsx';

/** The settings dialog: its tab, the theme, the keymap editor, the language, and the playback speed with its bake. */
export interface SettingsProps extends KeymapEditorProps {
    tab: string;
    setTab: (tab: string) => void;
    onClose: () => void;
    themeColor: string;
    setThemeColor: (c: string) => void;
    themeRecent: string[];
    defaultTheme: string;
    uiSat: number;
    setUiSat: (v: number) => void;
    conflicts: Record<string, string[]>;
    lang: string;
    changeLang: (lang: string) => void;
    videoOpacity: number | undefined;
    setVideoOpacity: (v: number) => void;
    setShowToolKeys: (on: boolean) => void;
    playbackRate: number;
    setPlaybackRate: (r: number) => void;
    playbackRates: readonly number[];
    bakeInfo: BakePlan;
    bakePlaybackSpeed: () => void;
}


/** A factor as short text: 4 rather than 4.00, 1.5 rather than 1.50. */
const trim = (n: number) => String(Math.round(n * 100) / 100);

// Settings (theme and shortcuts). To rebind, click an entry then press the key you want.
export function SettingsModal({
    tab, setTab, onClose,
    themeColor, setThemeColor, themeRecent, defaultTheme,
    uiSat, setUiSat,
    keymap, setKeymap, defaultKeys, keyLabels, conflicts, rebinding, setRebinding,
    lang, changeLang, videoOpacity, setVideoOpacity, setShowToolKeys,
    playbackRate, setPlaybackRate, playbackRates, bakeInfo, bakePlaybackSpeed,
}: SettingsProps) {
    return (
        <Modal title={tr('설정')} onClose={onClose} width={520} maxHeight="80vh" className="settings-modal"
            closeOnEscape={!rebinding} panelStyle={{ borderRadius: 10, padding: 20 }}>
            <div className="pal-tabs" style={{ marginBottom: 10 }}>
                <button className={`pal-tab${tab === 'theme' ? ' active' : ''}`} onClick={() => { setTab('theme'); setRebinding(null); }}>{tr('테마')}</button>
                <button className={`pal-tab${tab === 'play' ? ' active' : ''}`} onClick={() => { setTab('play'); setRebinding(null); }}>{tr('재생')}</button>
                <button className={`pal-tab${tab === 'keys' ? ' active' : ''}`} onClick={() => setTab('keys')}>{tr('단축키')}</button>
            </div>

            {tab === 'play' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* The selector is here as well as on the timeline, so this reads as one
                        thought: the speed, and what to do about it. */}
                    <div>
                        <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('재생 속도')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <select className="time-input" style={{ width: 74 }} value={playbackRate}
                                onChange={e => setPlaybackRate(+e.target.value)}>
                                {playbackRates.map(v => <option key={v} value={v}>{v}x</option>)}
                            </select>
                            <span style={{ fontSize: 11, color: '#888' }}>{tr('미리보기 속도입니다 · 내보내기는 항상 정상 속도')}</span>
                        </div>
                    </div>
                    {/* Not a button on the timeline beside the selector: that one is reached
                        for constantly while working, and this rewrites every cut in the
                        project. The gear next to the selector opens straight onto this tab, so
                        it is one click away without being one slip away. */}
                    <div>
                        <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('재생 속도를 실제 속도로')}</div>
                        {bakeInfo.noop
                            ? <div style={{ fontSize: 11, color: '#777' }}>{tr('지금은 정상 속도({0}x)입니다. 타임라인에서 속도를 바꾼 뒤 여기로 오세요.', playbackRate)}</div>
                            : (
                                <>
                                    <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6, marginBottom: 8 }}>
                                        {tr('지금 {0}x로 보고 있습니다. 굳히면 컷 길이가 {1}배로 늘어나 ({2} → {3}) 내보낸 영상도 지금 보는 속도가 됩니다. 흔들림·자글자글·글자 애니메이션 속도도 함께 맞춰집니다.',
                                            playbackRate, trim(bakeInfo.factor), fmt(bakeInfo.before), fmt(bakeInfo.after))}
                                    </div>
                                    {bakeInfo.stranded.length > 0 && (
                                        <div style={{ fontSize: 11, color: 'var(--accent-pale)', lineHeight: 1.6, marginBottom: 8 }}>
                                            {tr('음원과 영상은 늘릴 수 없어 제자리에 남습니다. 굳힌 뒤 위치를 다시 맞춰주세요.')}
                                        </div>
                                    )}
                                    <button className="button" onClick={() => { bakePlaybackSpeed(); onClose(); }}
                                        style={{ height: 30, padding: '0 12px', borderColor: 'color-mix(in srgb, var(--accent-soft) 55%, transparent)', color: 'var(--accent-pale)' }}>
                                        {tr('{0}배로 굳히기', trim(bakeInfo.factor))}
                                    </button>
                                    <div style={{ fontSize: 10, color: '#777', marginTop: 6 }}>{tr('되돌리기(Ctrl+Z)로 취소할 수 있습니다.')}</div>
                                </>
                            )}
                    </div>
                </div>
            ) : tab === 'theme' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                        <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('언어')}</div>
                        <div className="pal-tabs">
                            <button className={`pal-tab${lang === 'en' ? ' active' : ''}`} onClick={() => changeLang('en')}>English</button>
                            <button className={`pal-tab${lang === 'ko' ? ' active' : ''}`} onClick={() => changeLang('ko')}>한국어</button>
                            <button className={`pal-tab${lang === 'ja' ? ' active' : ''}`} onClick={() => changeLang('ja')}>日本語</button>
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
                            <NumField width={60} min={0} max={60} value={uiSat}
                                onChange={v => setUiSat(clampNum(v, 0, 60))} />
                            <span style={{ fontSize: 11, color: '#888' }}>%</span>
                        </div>
                        <div style={{ fontSize: 10, color: '#777', marginTop: 4 }}>{tr('0%로 두면 완전한 무채색 회색 UI가 됩니다.')}</div>
                    </div>
                    {/* Also on the video track itself; here as well because settings are
                        where someone looks, and the track row can be folded away. */}
                    <div>
                        <div className="color-section-label" style={{ marginBottom: 6 }}>{tr('영상 농도')}</div>
                        {videoOpacity == null
                            ? <div style={{ fontSize: 11, color: '#777' }}>{tr('영상이 없습니다')}</div>
                            : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input type="range" min="0" max="100" step="1" style={{ flex: 1 }}
                                        value={Math.round(videoOpacity * 100)}
                                        onChange={e => setVideoOpacity(+e.target.value / 100)} />
                                    <NumField width={60} min={0} max={100}
                                        value={Math.round(videoOpacity * 100)}
                                        onChange={v => setVideoOpacity(clampNum(v, 0, 100) / 100)} />
                                    <span style={{ fontSize: 11, color: '#888' }}>%</span>
                                </div>
                            )}
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                        {rebinding ? tr('원하는 키를 누르세요 (Esc = 취소)') : tr('바꿀 항목을 누른 뒤 새 키를 누르세요.')}
                    </div>
                    <KeyConflicts conflicts={conflicts} keyLabels={keyLabels} />
                    <KeyRows ids={Object.keys(defaultKeys).filter(id => !id.startsWith(TOOL_PREFIX))}
                        keymap={keymap} defaultKeys={defaultKeys} keyLabels={keyLabels}
                        rebinding={rebinding} setRebinding={setRebinding} setKeymap={setKeymap} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                        <span style={{ fontSize: 10, color: '#777' }}>{tr('Ctrl+S 저장 · Ctrl+Z/Y 등 기본 조합은 항상 동작합니다')}</span>
                        <button className="button" onClick={() => setShowToolKeys(true)}>{tr('도구 단축키…')}</button>
                        <button className="button" onClick={() => setKeymap({ ...defaultKeys })}>{tr('전체 기본값')}</button>
                    </div>
                </>
            )}
        </Modal>
    );
}
