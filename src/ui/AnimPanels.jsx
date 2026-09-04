import { Circle } from 'lucide-react';
import React from 'react';
import { ANIM_DEFAULT, LAYER_ANIM_DEFAULT } from '../canvas/canvasUtils';
import { CAMERA_DEFAULT, CAMERA_PRESETS, resolveCamera } from '../core/camera.js';
import { randomId } from '../core/ids.js';
import { readStored, writeStored, arrayCodec } from '../core/persist.js';
import { NumField } from './NumField';
import { tr } from '../i18n';

// Animation control panels, split out of App.jsx so editing the (frequently-tweaked)
// animation UI doesn't require loading the whole component.

const EASE_OPTS = [['linear', '일정'], ['in', '천천히→빠르게'], ['out', '빠르게→천천히'], ['inout', '천천-빠-천천']];

// One row of controls. Every row wraps: the panel is ~215px of usable width, a number box cannot
// shrink below the width it was given, and the labels are longer in English than the Korean they
// were sized for. Without wrapping the last control of a row is simply pushed outside the panel -
// which is what put Count and Sway's Speed past the right edge.
const R = (color = '#aaa', extra) => ({
    display: 'flex', flexWrap: 'wrap', alignItems: 'center',
    columnGap: 6, rowGap: 4, fontSize: 10, color, ...extra,
});

// Free numeric input (any value the user types), replacing the old fixed-value dropdowns.
// label and suffix are drawn inside the same inline box as the input so a wrap never separates a
// field from the letter naming it - "X" ending a line with its input starting the next one is
// unreadable, and that is what the keyframe list used to do.
const NumIn = ({ value, onChange, step = 1, min = undefined, max = undefined, w = 56, title = '', label = undefined, suffix = undefined }) => {
    const input = (
        <NumField value={value} onChange={onChange} step={step} min={min} max={max} width={w} title={title} />
    );
    if (label == null && suffix == null) return input;
    return <span className="anim-field" title={title}>{label}{input}{suffix}</span>;
};

// Per-cut animation (in/out, deform, move, easing).
export function CutAnimPanel({ cut, updCutAnim }) {
    const a = { ...ANIM_DEFAULT, ...cut.anim };
    const set = (o) => updCutAnim(cut.id, o);
    return (
        <div style={{ marginTop: 8, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888' }}>{tr('컷 애니메이션 (재생 시 적용)')}</div>
            <div style={R()}>
                <span style={{ width: 28, color: '#aaa', flexShrink: 0 }}>{tr('진입')}</span>
                <select value={a.inType} onChange={e => set({ inType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 60 }}>
                    <option value="none">{tr('없음')}</option><option value="fade">{tr('페이드')}</option><option value="scale">{tr('확대')}</option><option value="slide">{tr('슬라이드')}</option>
                </select>
                {a.inType === 'slide' && <select value={a.inDir} onChange={e => set({ inDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.inDur} onChange={v => set({ inDur: v })} step={0.1} min={0} title={tr('지속(초)')} />
            </div>
            <div style={R()}>
                <span style={{ width: 28, color: '#aaa', flexShrink: 0 }}>{tr('진출')}</span>
                <select value={a.outType} onChange={e => set({ outType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 60 }}>
                    <option value="none">{tr('없음')}</option><option value="fade">{tr('페이드')}</option><option value="scale">{tr('축소')}</option><option value="slide">{tr('슬라이드')}</option>
                </select>
                {a.outType === 'slide' && <select value={a.outDir} onChange={e => set({ outDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.outDur} onChange={v => set({ outDur: v })} step={0.1} min={0} title={tr('지속(초)')} />
            </div>
            <div style={R()}>
                <span style={{ width: 28, color: '#aaa', flexShrink: 0 }}>{tr('변형')}</span>
                <select value={a.deformAxis} onChange={e => set({ deformAxis: e.target.value })} className="time-input" style={{ width: 56 }}><option value="y">{tr('상하')}</option><option value="x">{tr('좌우')}</option></select>
                <NumIn value={Math.round(a.deformAmount * 100)} onChange={v => set({ deformAmount: v / 100 })} step={5} w={56} suffix="%" title={tr('스퀴즈/스트레치 양(%) — 상한 없음')} />
            </div>
            <div style={R()}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <input type="checkbox" checked={!!a.deformReturn} onChange={e => set({ deformReturn: e.target.checked })} /> {tr('왕복')}
                </label>
                <NumIn value={a.deformSpeed} onChange={v => set({ deformSpeed: Math.max(0.01, v) })} step={0.5} min={0.01} w={52} title={tr('속도 배수 (상한 없음)')}
                    label={<span style={{ color: a.deformReturn ? '#aaa' : '#555' }}>{tr('속도')}</span>} suffix="x" />
                <NumIn value={a.deformCount} onChange={v => set({ deformCount: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')}
                    label={<span style={{ color: a.deformReturn ? '#aaa' : '#555' }}>{tr('횟수')}</span>} />
            </div>
            <div style={R()}>
                <span style={{ width: 28, color: '#aaa', flexShrink: 0 }}>{tr('이동')}</span>
                <NumIn label="X" value={a.moveX} onChange={v => set({ moveX: v })} w={58} title={tr('가로 이동(px)')} />
                <NumIn label="Y" value={a.moveY} onChange={v => set({ moveY: v })} w={58} title={tr('세로 이동(px)')} />
            </div>
            <div style={R()}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <input type="checkbox" checked={!!a.moveReturn} onChange={e => set({ moveReturn: e.target.checked })} /> {tr('이동왕복')}
                </label>
                <NumIn value={a.moveSpeed} onChange={v => set({ moveSpeed: Math.max(0.01, v) })} step={0.5} min={0.01} w={52} title={tr('속도 배수 (상한 없음)')}
                    label={<span style={{ color: a.moveReturn ? '#aaa' : '#555' }}>{tr('속도')}</span>} suffix="x" />
                <NumIn value={a.moveCount} onChange={v => set({ moveCount: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')}
                    label={<span style={{ color: a.moveReturn ? '#aaa' : '#555' }}>{tr('횟수')}</span>} />
            </div>
            <div style={R()}>
                <span style={{ width: 28, color: '#aaa', flexShrink: 0 }}>{tr('속도감')}</span>
                <select value={a.ease} onChange={e => set({ ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 60 }} title={tr('가속/감속 곡선')}>{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select>
                <NumIn value={a.easePower} onChange={v => set({ easePower: Math.max(0.1, v) })} step={0.5} min={0.1} w={48} title={tr('가감속 세기 (상한 없음)')}
                    label={<span style={{ color: a.ease === 'linear' ? '#555' : '#aaa' }}>{tr('가중치')}</span>} />
            </div>
        </div>
    );
}

/**
 * The camera move for one cut.
 *
 * Separate from the cut animation panel above even though both hang off the cut, because they are
 * different things: that one moves the drawing inside the frame, this one moves the frame. Putting
 * them in one list made it impossible to tell at a glance which was which.
 */
export function CameraPanel({ cut, updCutCamera, cameraCapture, setCameraCapture, canvasW, canvasH }) {
    const c = { ...CAMERA_DEFAULT, ...cut.camera };
    const set = (o) => updCutCamera(cut.id, o);
    // What the camera actually resolves to, preset included. Reading the raw fields would show
    // zoom 1 while the picture visibly zooms, because a preset's zoom lives on the preset.
    const eff = resolveCamera(cut.camera, canvasW, canvasH);
    const capturing = !!cameraCapture && cameraCapture.cutId === cut.id;

    return (
        <div style={{ marginTop: 8, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888' }}>{tr('카메라 (재생 시 적용)')}</div>
            <div style={R()}>
                <span style={{ width: 34, color: '#aaa', flexShrink: 0 }}>{tr('동작')}</span>
                <select value={c.preset || 'none'} onChange={e => set({ preset: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 76 }}>
                    {Object.entries(CAMERA_PRESETS).map(([id, p]) => <option key={id} value={id}>{tr(p.label)}</option>)}
                </select>
            </div>
            <div style={R()}>
                <span style={{ width: 34, color: '#aaa', flexShrink: 0 }}>{tr('줌')}</span>
                <NumIn value={round2(eff ? eff.zoomFrom : 1)} onChange={v => set({ zoomFrom: clampZoom(v) })} step={0.05} min={0.2} w={54} label={tr('시작')} title={tr('시작 배율')} />
                <NumIn value={round2(eff ? eff.zoomTo : 1)} onChange={v => set({ zoomTo: clampZoom(v) })} step={0.05} min={0.2} w={54} label={tr('끝')} title={tr('끝 배율')} />
            </div>
            <div style={R()}>
                <span style={{ width: 34, color: '#aaa', flexShrink: 0 }}>{tr('기울기')}</span>
                <NumIn value={c.rotFrom || 0} onChange={v => set({ rotFrom: v })} step={1} w={54} label={tr('시작')} suffix="°" title={tr('시작 각도')} />
                <NumIn value={c.rotTo || 0} onChange={v => set({ rotTo: v })} step={1} w={54} label={tr('끝')} suffix="°" title={tr('끝 각도')} />
            </div>
            <div style={R()}>
                <span style={{ width: 34, color: '#aaa', flexShrink: 0 }}>{tr('속도감')}</span>
                <select value={c.ease} onChange={e => set({ ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 60 }} title={tr('가속/감속 곡선')}>
                    {EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
                </select>
                <NumIn value={c.easePower} onChange={v => set({ easePower: Math.max(0.1, v) })} step={0.5} min={0.1} w={48} title={tr('가감속 세기')}
                    label={<span style={{ color: c.ease === 'linear' ? '#555' : '#aaa' }}>{tr('가중치')}</span>} />
            </div>
            <div style={R()}>
                <button className="button" style={{ flex: 1, height: 26, background: capturing ? 'var(--accent)' : undefined }}
                    onClick={() => setCameraCapture(capturing ? null : { cutId: cut.id })}
                    title={tr('캔버스에 카메라가 지나갈 길을 그립니다')}>
                    {capturing ? tr('그리는 중… (다시 눌러 취소)') : (c.path ? tr('경로 다시 그리기') : tr('경로 그리기'))}
                </button>
                {c.path && <button className="button" style={{ height: 26 }} onClick={() => set({ path: null })} title={tr('그린 경로를 지우고 프리셋 동작으로 되돌립니다')}>{tr('경로 지움')}</button>}
            </div>
            {eff && <button className="button" style={{ height: 24, fontSize: 10 }} onClick={() => updCutCamera(cut.id, null)}>{tr('카메라 끄기')}</button>}
        </div>
    );
}

const round2 = (v) => Math.round(v * 100) / 100;
// Zooming out past 1 shows blank paper around the artwork. That is a legitimate thing to want -
// a pull-back reveal - but not by accident, so the floor sits well below 1 rather than at it.
const clampZoom = (v) => Math.max(0.2, Math.min(8, v));

// Motion presets: rather than dialling in each value, drop in a common soft movement at once.
// Each preset fills move, rotate and scale together with the ping-pong flag and the easing.
const MOVE_PRESETS = [
    { id: 'floatY', label: '둥실둥실', v: { mode: 'return', tx: 0, ty: -24, rot: 0, scale: 0, speed: 0.6, count: 0, ease: 'inout', easePower: 2 } },
    { id: 'driftX', label: '좌우 흐름', v: { mode: 'return', tx: 40, ty: 0, rot: 0, scale: 0, speed: 0.5, count: 0, ease: 'inout', easePower: 2 } },
    { id: 'breathe', label: '숨쉬기', v: { mode: 'return', tx: 0, ty: 0, rot: 0, scale: 0.06, speed: 0.8, count: 0, ease: 'inout', easePower: 2 } },
    { id: 'tilt', label: '갸우뚱', v: { mode: 'return', tx: 0, ty: 0, rot: 6, scale: 0, speed: 0.7, count: 0, ease: 'inout', easePower: 2 } },
    { id: 'slideIn', label: '미끄러져 등장', v: { mode: 'progress', tx: -120, ty: 0, rot: 0, scale: 0, speed: 1, count: 0, ease: 'out', easePower: 3 } },
    { id: 'popIn', label: '톡 튀어나오기', v: { mode: 'progress', tx: 0, ty: 0, rot: 0, scale: -0.35, speed: 1, count: 0, ease: 'out', easePower: 3 } },
    { id: 'bob', label: '통통 튀기', v: { mode: 'return', tx: 0, ty: -40, rot: 0, scale: 0, speed: 2, count: 0, ease: 'out', easePower: 2 } },
];

// Per-layer ("part") animation (move/rotate/scale/path + ping-pong/speed/count/easing).
// Presets the user saved: same shape as the built-in ones, kept in the browser.
const loadCustomPresets = () => readStored('mv_move_presets', [], arrayCodec.decode);
const saveCustomPresets = (list) => writeStored('mv_move_presets', list, arrayCodec.encode);

export function LayerAnimPanel({ cut, layer, updLayerAnim, updLayers, pathCapture, setPathCapture, cutProgress = 0 }) {
    const a = { ...LAYER_ANIM_DEFAULT, ...layer.anim };
    const [custom, setCustom] = React.useState(loadCustomPresets);
    const keys = Array.isArray(a.keys) ? a.keys : [];
    const sortKeys = (arr) => [...arr].sort((x, y) => x.p - y.p);
    const setKeys = (arr) => updLayerAnim(cut.id, layer.id, { keys: arr.length ? sortKeys(arr) : null });
    // Add a key at the current playback position (progress through the cut), overwriting
    // any key already sitting there.
    const addKeyHere = () => {
        const p = Math.round(Math.max(0, Math.min(1, cutProgress)) * 100) / 100;
        const cur = keys.find(k => Math.abs(k.p - p) < 0.005);
        const val = { p, tx: a.tx || 0, ty: a.ty || 0, rot: a.rot || 0, scale: a.scale || 0, op: 1, ease: 'inout', easePower: 2 };
        // The id is what lets React follow a key that changes position: the list is kept sorted,
        // so editing a %  moves the row, and with an index for a key React would instead hand the
        // focused input the next key's values mid-edit.
        setKeys(cur ? keys.map(k => k === cur ? { ...k, ...val } : k) : [...keys, { id: randomId('k'), ...val }]);
    };
    const updKey = (i, o) => setKeys(keys.map((k, j) => j === i ? { ...k, ...o } : k));
    return (
        <div style={{ padding: '6px 8px', background: 'hsl(var(--ui-h) var(--ui-s) 10%)', borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', display: 'flex', flexDirection: 'column', gap: 5 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>{tr('파츠 애니메이션 (재생 시 적용)')}</span>
                {layer.anim && <button className="small-btn" onClick={() => updLayers(cut.id, c => ({ layers: c.layers.map(l => l.id === layer.id ? { ...l, anim: undefined } : l) }))}>{tr('끄기')}</button>}
            </div>
            {/* Soft-motion presets: pressing one fills in all the values below, which can then
                be adjusted freely. The current settings can also be saved as a preset and
                reused on other parts. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }} title={tr('자주 쓰는 움직임을 한 번에 적용합니다. 적용 후 값은 직접 수정할 수 있습니다.')}>
                {MOVE_PRESETS.map(p => (
                    <button key={p.id} className="small-btn" style={{ fontSize: 9, padding: '2px 6px' }}
                        onClick={() => updLayerAnim(cut.id, layer.id, p.v)}>{tr(p.label)}</button>
                ))}
                {custom.map((p, i) => (
                    <button key={'c' + i} className="small-btn" style={{ fontSize: 9, padding: '2px 6px', borderColor: 'var(--accent-soft)' }}
                        title={tr('내 프리셋 · 우클릭으로 삭제')}
                        onContextMenu={e => { e.preventDefault(); const next = custom.filter((_, j) => j !== i); setCustom(next); saveCustomPresets(next); }}
                        onClick={() => updLayerAnim(cut.id, layer.id, p.v)}>{tr(p.label)}</button>
                ))}
                <button className="small-btn" style={{ fontSize: 9, padding: '2px 6px', color: '#8bd' }}
                    title={tr('지금 설정을 내 프리셋으로 저장 (다른 파츠에서도 사용)')}
                    onClick={() => {
                        const label = window.prompt(tr('프리셋 이름'), tr('내 모션'));
                        if (!label) return;
                        const v = { mode: a.mode, tx: a.tx, ty: a.ty, rot: a.rot, scale: a.scale, speed: a.speed, count: a.count, ease: a.ease, easePower: a.easePower };
                        const next = [...custom, { id: 'c' + Date.now(), label, v }];
                        setCustom(next); saveCustomPresets(next);
                    }}>{tr('+ 저장')}</button>
            </div>
            {/* Keyframe tweening: set a value at each point in time and the gaps are filled in.
                Each key is a bordered card holding its own fields. Laid out as a plain wrapping
                row they ran together: one key needed three lines at this panel width, so where
                one key ended and the next began was impossible to see. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 4 }}>
                <div style={R('#c9a')}
                    title={tr("재생 위치를 옮겨가며 '키 추가'를 누르면 그 사이가 자동으로 보간됩니다(트위닝). 키가 2개 이상이면 위의 이동/회전/크기 대신 키프레임이 적용됩니다.")}>
                    <span style={{ fontWeight: 700, flexShrink: 0 }}>{tr('키프레임')}</span>
                    <button className="small-btn" onClick={addKeyHere}>+ {tr('키 추가')} ({Math.round(Math.max(0, Math.min(1, cutProgress)) * 100)}%)</button>
                    {keys.length > 0 && <button className="small-btn" onClick={() => setKeys([])}>{tr('전체 삭제')}</button>}
                    {keys.length === 1 && <span style={{ color: '#e0a84e' }}>{tr('2개 이상부터 적용')}</span>}
                    {keys.length >= 2 && <span className="anim-field" style={{ color: '#5a8' }}><Circle size={7} fill="currentColor" /> {tr('{0}개', keys.length)}</span>}
                </div>
                {keys.map((k, i) => (
                    <div key={k.id ?? 'i' + i} className="kf-card">
                        <div className="kf-card-head">
                            <span className="kf-index">#{i + 1}</span>
                            <NumIn value={Math.round(k.p * 100)} onChange={v => updKey(i, { p: Math.max(0, Math.min(100, v)) / 100 })} min={0} max={100} w={46} suffix="%" title={tr('시점 (컷 내 %)')} />
                            <select className="time-input" style={{ flex: 1, minWidth: 56, height: 18, fontSize: 9 }} value={k.ease || 'linear'}
                                onChange={e => updKey(i, { ease: e.target.value })} title={tr('이 키에서 다음 키까지의 가감속')}>
                                {EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
                            </select>
                            <button className="small-btn" style={{ fontSize: 9, padding: '1px 5px' }} title={tr('삭제')} onClick={() => setKeys(keys.filter((_, j) => j !== i))}>✕</button>
                        </div>
                        <div className="kf-card-body">
                            <NumIn label="X" value={k.tx || 0} onChange={v => updKey(i, { tx: v })} w={46} title={tr('가로 이동(px)')} />
                            <NumIn label="Y" value={k.ty || 0} onChange={v => updKey(i, { ty: v })} w={46} title={tr('세로 이동(px)')} />
                            <NumIn label="∠" value={k.rot || 0} onChange={v => updKey(i, { rot: v })} step={5} w={44} title={tr('회전(도)')} />
                            <NumIn label="⤢" value={Math.round((k.scale || 0) * 100)} onChange={v => updKey(i, { scale: v / 100 })} step={5} w={44} title={tr('크기 변화(%)')} />
                            <NumIn label="α" value={Math.round((k.op ?? 1) * 100)} onChange={v => updKey(i, { op: Math.max(0, Math.min(100, v)) / 100 })} min={0} max={100} step={10} w={44} title={tr('불투명도(%)')} />
                        </div>
                    </div>
                ))}
            </div>
            <div style={R()}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('이동')}</span>
                <NumIn label="X" value={a.tx} onChange={v => updLayerAnim(cut.id, layer.id, { tx: v })} w={52} title={tr('가로 이동(px)')} />
                <NumIn label="Y" value={a.ty} onChange={v => updLayerAnim(cut.id, layer.id, { ty: v })} w={52} title={tr('세로 이동(px)')} />
            </div>
            <div style={R()}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('회전')}</span>
                <NumIn value={a.rot} onChange={v => updLayerAnim(cut.id, layer.id, { rot: v })} step={5} w={56} title={tr('회전(도)')} />
                <NumIn label={tr('크기')} value={Math.round(a.scale * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { scale: v / 100 })} step={5} w={56} suffix="%" title={tr('크기 변화(%)')} />
            </div>
            <div style={R()}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <input type="checkbox" checked={a.mode === 'return'} onChange={e => updLayerAnim(cut.id, layer.id, { mode: e.target.checked ? 'return' : 'progress' })} /> {tr('왕복')}
                </label>
                <NumIn value={a.speed} onChange={v => updLayerAnim(cut.id, layer.id, { speed: Math.max(0.01, v) })} step={0.5} min={0.01} w={52} title={tr('재생 속도 배수 (상한 없음)')}
                    label={tr('속도')} suffix="x" />
                <NumIn value={a.count} onChange={v => updLayerAnim(cut.id, layer.id, { count: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')}
                    label={<span style={{ color: a.mode === 'return' ? '#aaa' : '#555' }}>{tr('횟수')}</span>} />
            </div>
            <div style={R()}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('속도감')}</span>
                <select value={a.ease} onChange={e => updLayerAnim(cut.id, layer.id, { ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 60 }} title={tr('가속/감속 (왕복 아닐 때)')}>{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select>
                <NumIn value={a.easePower} onChange={v => updLayerAnim(cut.id, layer.id, { easePower: Math.max(0.1, v) })} step={0.5} min={0.1} w={48} title={tr('가감속 세기 (상한 없음)')}
                    label={<span style={{ color: a.ease === 'linear' ? '#555' : '#aaa' }}>{tr('가중치')}</span>} />
            </div>
            <div style={R('#888')}>
                <span style={{ flexShrink: 0 }}>{tr('기준점')}</span>
                <NumIn label="X" value={Math.round((a.pivotX ?? 0.5) * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { pivotX: v / 100 })} step={5} w={46} suffix="%" title={tr('기준점 X (%)')} />
                <NumIn label="Y" value={Math.round((a.pivotY ?? 0.5) * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { pivotY: v / 100 })} step={5} w={46} suffix="%" title={tr('기준점 Y (%)')} />
            </div>
            <div style={R('#8bd')} title={tr('머리카락·천처럼 계속 흔들리는 효과. 기준점 Y를 위(0)로 두면 아래가 크게 흔들립니다.')}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('흔들')}</span>
                <NumIn label={tr('강도')} value={a.swayAmount || 0} onChange={v => updLayerAnim(cut.id, layer.id, { swayAmount: v })} min={0} w={46} title={tr('흔들림 강도')} />
                <NumIn label={tr('속도')} value={a.swaySpeed || 1} onChange={v => updLayerAnim(cut.id, layer.id, { swaySpeed: v })} step={0.1} min={0.1} w={46} title={tr('흔들림 속도')} />
            </div>
            {/* Sway 2: draw a curve to define the shape of the sway; without one it falls back
                to a plain sine wave. */}
            <div style={R('#8bd')}
                title={tr('물결치듯 곡선을 그리면 그 곡선의 모양과 크기대로 흔들립니다. 그리지 않으면 기본 사인파로 흔들립니다.')}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('모양')}</span>
                <button className="small-btn" style={{ background: pathCapture && pathCapture.mode === 'sway' && pathCapture.layerId === layer.id ? 'var(--accent-soft)' : undefined }}
                    onClick={() => setPathCapture(pc => (pc && pc.mode === 'sway' && pc.cutId === cut.id && pc.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id, mode: 'sway' })}>
                    {pathCapture && pathCapture.mode === 'sway' && pathCapture.layerId === layer.id ? tr('그리는 중…') : (a.swayCurve ? tr('곡선 다시 그리기') : tr('흔들림 곡선 그리기'))}
                </button>
                {a.swayCurve && <button className="small-btn" onClick={() => updLayerAnim(cut.id, layer.id, { swayCurve: null })}>{tr('기본 파형')}</button>}
                {a.swayCurve && <span className="anim-field" style={{ color: '#5a8' }}><Circle size={7} fill="currentColor" /> {tr('곡선')}</span>}
            </div>
            {/* Per-point bending: how much each point along the axis sways, from -100 to 100%.
                Zero holds that point still; a negative value bends it the other way. */}
            {(() => {
                const prof = Array.isArray(a.swayProfile) ? a.swayProfile : null;
                const setProf = (arr) => updLayerAnim(cut.id, layer.id, { swayProfile: arr });
                const resize = (n) => {
                    const cur = prof || [0, 1];
                    const next = Array.from({ length: n }, (_, i) => {
                        const p = i / (n - 1);
                        const x = p * (cur.length - 1), lo = Math.floor(x), f = x - lo;
                        return Math.round(((cur[lo] ?? 0) + ((cur[Math.min(lo + 1, cur.length - 1)] ?? 0) - (cur[lo] ?? 0)) * f) * 100) / 100;
                    });
                    setProf(next);
                };
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: '#8bd' }}>
                        <div style={R('#8bd')}
                            title={tr('축을 따라 지점마다 얼마나 흔들릴지 정합니다. 0 = 고정(유지), 음수 = 반대쪽으로 꺾임.')}>
                            <span style={{ width: 24, flexShrink: 0 }}>{tr('꺾임')}</span>
                            {!prof
                                ? <button className="small-btn" onClick={() => setProf([0, 0.5, 1])}>{tr('지점별 꺾임 켜기')}</button>
                                : <>
                                    <select className="time-input" style={{ width: 52, height: 20, fontSize: 10 }} value={a.swayAxis || 'y'}
                                        onChange={e => updLayerAnim(cut.id, layer.id, { swayAxis: e.target.value })} title={tr('변형 중심축')}>
                                        <option value="y">{tr('세로축')}</option><option value="x">{tr('가로축')}</option>
                                    </select>
                                    <NumIn label={tr('지점')} value={prof.length} onChange={v => resize(Math.max(2, Math.min(8, Math.round(v))))} min={2} max={8} w={40} title={tr('제어 지점 개수 (2~8)')} />
                                    <button className="small-btn" onClick={() => setProf(null)}>{tr('끄기')}</button>
                                </>}
                        </div>
                        {prof && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingLeft: 26 }}>
                                {prof.map((w, i) => (
                                    <React.Fragment key={i}>
                                        <NumIn value={Math.round(w * 100)} step={10} min={-100} max={100} w={46}
                                            label={<span style={{ color: '#667' }}>{Math.round(i / (prof.length - 1) * 100)}%</span>}
                                            title={tr('{0} {1}% 지점의 흔들림 정도(%)', a.swayAxis === 'x' ? tr('왼쪽→오른쪽') : tr('위→아래'), Math.round(i / (prof.length - 1) * 100))}
                                            onChange={v => setProf(prof.map((x, j) => j === i ? v / 100 : x))} />
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}
            <div style={R()}>
                <span style={{ width: 24, flexShrink: 0 }}>{tr('경로')}</span>
                <button className="small-btn" style={{ background: pathCapture && pathCapture.layerId === layer.id ? 'var(--accent-soft)' : undefined }}
                    onClick={() => setPathCapture(pc => (pc && pc.cutId === cut.id && pc.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id })}>
                    {pathCapture && pathCapture.layerId === layer.id ? tr('그리는 중…') : (a.path ? tr('경로 다시 그리기') : tr('경로 그리기'))}
                </button>
                {a.path && <button className="small-btn" onClick={() => updLayerAnim(cut.id, layer.id, { path: null })}>{tr('지우기')}</button>}
                {a.path && <span className="anim-field" style={{ color: '#5a8' }}><Circle size={7} fill="currentColor" /> {tr('{0}점', a.path.length)}</span>}
            </div>
        </div>
    );
}

// Boiling-line settings, per layer. Strength, wavelength, speed and a minimum-width
// threshold are all exposed, the threshold being what stops hairlines shimmering wildly.
export function JitterPanel({ cut, layer, updLayer }) {
    const on = !!layer.roughen;
    const set = (o) => updLayer(cut.id, layer.id, o);
    return (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'hsl(var(--ui-h) var(--ui-s) 13%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={R('#e0a84e')}>
                <span style={{ fontWeight: 700, flexShrink: 0 }}>{tr('자글자글')}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#aaa' }}>
                    <input type="checkbox" checked={on} onChange={e => set({ roughen: e.target.checked ? 2.4 : 0 })} /> {tr('켜기')}
                </label>
                {on && <span style={{ color: '#666' }}>{tr('선이 제자리에서 떨림')}</span>}
            </div>
            {on && <>
                <div style={R()}>
                    <NumIn label={tr('강도')} value={layer.roughen} onChange={v => set({ roughen: Math.max(0.1, v) })} step={0.2} min={0.1} w={48} title={tr('흔들리는 폭(px)')} />
                    <NumIn label={tr('파장')} value={layer.roughWave ?? 1} onChange={v => set({ roughWave: v })} step={0.1} min={0.2} w={48} title={tr('물결 길이 배수 — 크게 하면 더 완만하고 둥글게')} />
                </div>
                <div style={R()}>
                    <NumIn label={tr('속도')} value={layer.roughSpeed ?? 1} onChange={v => set({ roughSpeed: v })} step={0.1} min={0} w={48} title={tr('떨리는 속도 배수 (0 = 정지)')} />
                    <NumIn label={tr('최소굵기')} value={layer.roughMinSize ?? 0} onChange={v => set({ roughMinSize: Math.max(0, v) })} step={1} min={0} w={48} title={tr('이 굵기(px) 미만인 가는 선에는 효과를 주지 않음 — 0이면 전부 적용')} />
                </div>
                <div style={{ fontSize: 9, color: '#666' }}>{tr("가는 선까지 떨리면 '최소굵기'를 올리세요.")}</div>
            </>}
        </div>
    );
}
