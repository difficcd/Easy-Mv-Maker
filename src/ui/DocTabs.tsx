import { Plus } from 'lucide-react';
import { tr } from '../i18n';
import type { Tab } from '../hooks/useLocalDocuments.ts';
import type { PathCapture } from '../hooks/usePathCapture.ts';

/** The tab strip: the open documents and what a click, a double-click and the ✕ do. */
interface TabProps { tabs: Tab[]; activeTabId: string; switchTab: (id: string) => void; renameTab: (id: string, name: string) => void; closeTab: (id: string) => void; newTab: () => void }
/** The floating selection's mode bar: its sliders and the four ways out. */
interface SelectionProps { selection: any; setSelection: (f: (s: any) => any) => void; extractSelectionToPart: () => void; copyLassoSelection: () => void; commitSelection: () => void; cancelSelection: () => void }
/** The curve ruler's mode bar: how many anchors so far, and finish or cancel. */
interface CurveProps { curvePts: number; commitCurve: () => void; cancelCurve: () => void }
/** The tab strip plus whichever mode bar is up: a selection, the curve ruler, or a path capture. */
export interface DocTabsProps extends TabProps, SelectionProps, CurveProps {
    etool: string;
    cameraCapture: { cutId: any } | null;
    setCameraCapture: (c: null) => void;
    pathCapture: PathCapture | null;
    setPathCapture: (c: null) => void;
}


// The row under the top bar: the open projects, and the bar for whichever mode is running.
//
// The mode bar floats over the tab row as a pill, centred. The row is always there, so nothing
// shifts when a mode comes and goes, and it is off the canvas, where a floating bar covered the
// zoom control.

/** One project per tab. Click switches, double-click renames, the ✕ closes. */
function TabRow({ tabs, activeTabId, switchTab, renameTab, closeTab, newTab }: TabProps) {
    return (
        <div className="doc-tabs" style={{ display: 'flex', alignItems: 'stretch', gap: 2, background: 'hsl(var(--ui-h) var(--ui-s) 11%)', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', padding: '3px 6px 0', overflowX: 'auto', flexShrink: 0 }}>
            {tabs.map(t => (
                <div key={t.id} onClick={() => switchTab(t.id)}
                    onDoubleClick={() => { const n = window.prompt(tr('탭 이름'), t.name); if (n != null) renameTab(t.id, n); }}
                    title={tr('클릭: 전환 · 더블클릭: 이름변경')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: '6px 6px 0 0', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', maxWidth: 180, background: t.id === activeTabId ? 'hsl(var(--ui-h) var(--ui-s) 15%)' : 'transparent', color: t.id === activeTabId ? '#fff' : '#9a9ab0', borderBottom: t.id === activeTabId ? '2px solid var(--accent-soft)' : '2px solid transparent' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                    <span onClick={e => { e.stopPropagation(); closeTab(t.id); }} title={tr('탭 닫기')} style={{ opacity: 0.6, fontSize: 13, lineHeight: 1 }}>✕</span>
                </div>
            ))}
            <button className="icon-btn" onClick={newTab} title={tr('새 탭(프로젝트)')} style={{ alignSelf: 'center', marginLeft: 2 }}><Plus size={14} /></button>
        </div>
    );
}

function SelectionGroup({ selection, setSelection, extractSelectionToPart, copyLassoSelection, commitSelection, cancelSelection }: SelectionProps) {
    return (
        <div className="mode-group">
            <span className="mode-label">{tr('선택 영역')}</span>
            {/* Rotation in degrees, skew and bend in -100..100%. Sliders rather than number
                fields: the value means nothing in itself and the eye is on the canvas. Rotation
                is stored in radians, as layer animation does. */}
            {([['rot', tr('회전'), 180, 180 / Math.PI], ['skew', tr('기울기'), 100, 100], ['bend', tr('곡률'), 100, 100]] as Array<[string, string, number, number]>).map(([key, label, range, scale]) => (
                <label key={key} className="mode-slider" title={tr('드래그해 조정, 두 번 눌러 0으로. 기울기·곡률은 Ctrl 누르고 선택 영역을 끌어도 됩니다')}>
                    <span>{label}</span>
                    <input type="range" min={-range} max={range} value={Math.round((selection[key] || 0) * scale)}
                        onChange={e => setSelection(s => s && ({ ...s, [key]: +e.target.value / scale }))}
                        onDoubleClick={() => setSelection(s => s && ({ ...s, [key]: 0 }))} />
                </label>
            ))}
            <button className="button button-primary" onClick={extractSelectionToPart} style={{ height: 26, padding: '0 10px' }} title={tr('선택 영역을 별도 레이어(파츠)로 분리해 애니메이션')}>{tr('파츠로 분리')}</button>
            <button className="button" onClick={copyLassoSelection} style={{ height: 26, padding: '0 10px' }} title={tr('선택 영역 복사 (다른 컷/레이어에 붙여넣기)')}>{tr('복사')}</button>
            <button className="button" onClick={commitSelection} style={{ height: 26, padding: '0 10px' }} title={tr('제자리에 적용(이동/크기)')}>{tr('완료')}</button>
            <button className="button" onClick={cancelSelection} style={{ height: 26, padding: '0 10px' }}>{tr('취소')}</button>
        </div>
    );
}

function CurveGroup({ curvePts, commitCurve, cancelCurve }: CurveProps) {
    return (
        <div className="mode-group">
            <span className="mode-label">{tr('곡선 자')}</span>
            {/* No anchors yet means there is nothing to finish and nothing to cancel. These were
                rendered disabled, which on a tablet is a button that looks pressable and does
                nothing - the same reading as a broken app. */}
            <span className="mode-hint">{curvePts === 0 ? tr('점을 찍어 곡선을 만드세요') : tr('앵커 {0}개 (누른 채 끌어 미세조정)', curvePts)}</span>
            {curvePts > 0 && <>
                <button className="button button-primary" style={{ height: 26, padding: '0 10px' }} disabled={curvePts < 2} onClick={commitCurve}>{tr('완료')}</button>
                <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={cancelCurve}>{tr('취소')}</button>
            </>}
        </div>
    );
}

/** A mode whose only control is "stop doing this": the two path captures. */
function CaptureGroup({ label, hint, onCancel }: { label: string, hint: string, onCancel: () => void }) {
    return (
        <div className="mode-group">
            <span className="mode-label">{label}</span>
            <span className="mode-hint">{hint}</span>
            <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={onCancel}>{tr('취소')}</button>
        </div>
    );
}

export function DocTabs({
    tabs, activeTabId, switchTab, renameTab, closeTab, newTab,
    selection, setSelection, extractSelectionToPart, copyLassoSelection, commitSelection, cancelSelection,
    etool, curvePts, commitCurve, cancelCurve,
    cameraCapture, setCameraCapture, pathCapture, setPathCapture,
}: DocTabsProps) {
    const anyMode = selection || cameraCapture || pathCapture || etool === 'curve';
    return (
        <div className="doc-tabs-wrap">
            <TabRow tabs={tabs} activeTabId={activeTabId} switchTab={switchTab} renameTab={renameTab} closeTab={closeTab} newTab={newTab} />
            {anyMode && (
                <div className="mode-bar">
                    {selection && (
                        <SelectionGroup selection={selection} setSelection={setSelection}
                            extractSelectionToPart={extractSelectionToPart} copyLassoSelection={copyLassoSelection}
                            commitSelection={commitSelection} cancelSelection={cancelSelection} />
                    )}
                    {etool === 'curve' && <CurveGroup curvePts={curvePts} commitCurve={commitCurve} cancelCurve={cancelCurve} />}
                    {cameraCapture && (
                        <CaptureGroup label={tr('카메라 경로')}
                            hint={tr('카메라가 지나갈 길을 그리세요 — 재생하면 그 길을 따라갑니다')}
                            onCancel={() => setCameraCapture(null)} />
                    )}
                    {pathCapture && (
                        <CaptureGroup
                            label={pathCapture.mode === 'sway' ? tr('흔들림 곡선') : pathCapture.mode === 'mosaicRect' ? tr('모자이크 영역') : tr('이동 경로')}
                            hint={pathCapture.mode === 'sway' ? tr('물결치듯 곡선을 그리세요 — 그 모양·크기대로 흔들립니다')
                                : pathCapture.mode === 'mosaicRect' ? tr('모자이크를 걸 사각형을 드래그하세요')
                                    : tr('펜으로 이동 경로를 그리세요')}
                            onCancel={() => setPathCapture(null)} />
                    )}
                </div>
            )}
        </div>
    );
}
