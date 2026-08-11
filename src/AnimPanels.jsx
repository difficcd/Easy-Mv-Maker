import React from 'react';
import { ANIM_DEFAULT, LAYER_ANIM_DEFAULT } from './canvasUtils';
import { tr } from './i18n';

// Animation control panels, split out of App.jsx so editing the (frequently-tweaked)
// animation UI doesn't require loading the whole component.

const DUR_OPTS = [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3];
const COUNT_OPTS = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const MOVE_OPTS = [-400, -300, -200, -150, -100, -50, 0, 50, 100, 150, 200, 300, 400];
const ROT_OPTS = [-180, -135, -90, -45, -20, 0, 20, 45, 90, 135, 180];
const SCALE_OPTS = [-80, -50, -30, -20, 0, 20, 30, 50, 100, 150, 200];
const EASE_OPTS = [['linear', '일정'], ['in', '천천히→빠르게'], ['out', '빠르게→천천히'], ['inout', '천천-빠-천천']];
const optionList = (vals, fmt) => vals.map(v => <option key={v} value={v}>{fmt ? fmt(v) : v}</option>);
// Free numeric input (any value the user types), replacing the old fixed-value dropdowns.
const NumIn = ({ value, onChange, step = 1, min = undefined, max = undefined, w = 56, title = '' }) => (
    <input type="number" className="time-input" title={title} value={value} step={step} min={min} max={max} style={{ width: w }}
        onChange={e => { let v = parseFloat(e.target.value); if (isNaN(v)) v = 0; if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); onChange(v); }} />
);

// Per-cut animation (in/out, deform, move, easing).
export function CutAnimPanel({ cut, updCutAnim }) {
    const a = { ...ANIM_DEFAULT, ...cut.anim };
    return (
        <div style={{ marginTop: 8, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888' }}>{tr('컷 애니메이션 (재생 시 적용)')}</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>{tr('진입')}</span>
                <select value={a.inType} onChange={e => updCutAnim(cut.id, { inType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }}>
                    <option value="none">{tr('없음')}</option><option value="fade">{tr('페이드')}</option><option value="scale">{tr('확대')}</option><option value="slide">{tr('슬라이드')}</option>
                </select>
                {a.inType === 'slide' && <select value={a.inDir} onChange={e => updCutAnim(cut.id, { inDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.inDur} onChange={v => updCutAnim(cut.id, { inDur: v })} step={0.1} min={0} title={tr('지속(초)')} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>{tr('진출')}</span>
                <select value={a.outType} onChange={e => updCutAnim(cut.id, { outType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }}>
                    <option value="none">{tr('없음')}</option><option value="fade">{tr('페이드')}</option><option value="scale">{tr('축소')}</option><option value="slide">{tr('슬라이드')}</option>
                </select>
                {a.outType === 'slide' && <select value={a.outDir} onChange={e => updCutAnim(cut.id, { outDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.outDur} onChange={v => updCutAnim(cut.id, { outDur: v })} step={0.1} min={0} title={tr('지속(초)')} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>{tr('변형')}</span>
                <select value={a.deformAxis} onChange={e => updCutAnim(cut.id, { deformAxis: e.target.value })} className="time-input" style={{ width: 56 }}><option value="y">{tr('상하')}</option><option value="x">{tr('좌우')}</option></select>
                <NumIn value={Math.round(a.deformAmount * 100)} onChange={v => updCutAnim(cut.id, { deformAmount: v / 100 })} step={5} w={56} title={tr('스퀴즈/스트레치 양(%) — 상한 없음')} />%
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={!!a.deformReturn} onChange={e => updCutAnim(cut.id, { deformReturn: e.target.checked })} /> {tr('왕복')}
                </label>
                <span style={{ fontSize: 10, color: a.deformReturn ? '#aaa' : '#555', marginLeft: 4 }}>{tr('속도')}</span>
                <NumIn value={a.deformSpeed} onChange={v => updCutAnim(cut.id, { deformSpeed: Math.max(0.01, v) })} step={0.5} min={0.01} w={56} title={tr('속도 배수 (상한 없음)')} />x
                <span style={{ fontSize: 10, color: a.deformReturn ? '#aaa' : '#555' }}>{tr('횟수')}</span>
                <NumIn value={a.deformCount} onChange={v => updCutAnim(cut.id, { deformCount: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>{tr('이동')}</span>
                X<NumIn value={a.moveX} onChange={v => updCutAnim(cut.id, { moveX: v })} w={62} title={tr('가로 이동(px)')} />
                Y<NumIn value={a.moveY} onChange={v => updCutAnim(cut.id, { moveY: v })} w={62} title={tr('세로 이동(px)')} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={!!a.moveReturn} onChange={e => updCutAnim(cut.id, { moveReturn: e.target.checked })} /> {tr('이동왕복')}
                </label>
                <span style={{ fontSize: 10, color: a.moveReturn ? '#aaa' : '#555', marginLeft: 4 }}>{tr('속도')}</span>
                <NumIn value={a.moveSpeed} onChange={v => updCutAnim(cut.id, { moveSpeed: Math.max(0.01, v) })} step={0.5} min={0.01} w={56} title={tr('속도 배수 (상한 없음)')} />x
                <span style={{ fontSize: 10, color: a.moveReturn ? '#aaa' : '#555' }}>{tr('횟수')}</span>
                <NumIn value={a.moveCount} onChange={v => updCutAnim(cut.id, { moveCount: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>{tr('속도감')}</span>
                <select value={a.ease} onChange={e => updCutAnim(cut.id, { ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }} title={tr('가속/감속 곡선')}>{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select>
                <span style={{ fontSize: 10, color: a.ease === 'linear' ? '#555' : '#aaa' }}>{tr('가중치')}</span>
                <NumIn value={a.easePower} onChange={v => updCutAnim(cut.id, { easePower: Math.max(0.1, v) })} step={0.5} min={0.1} w={50} title={tr('가감속 세기 (상한 없음)')} />
            </div>
        </div>
    );
}

// #14 이동 효과 프리셋: 값을 하나씩 맞추지 않고 자주 쓰는 '부드러운 모션'을 한 번에 넣는다.
// 각 프리셋은 이동/회전/크기 + 왕복 여부 + 가감속을 한 세트로 채운다.
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
// 사용자가 저장한 커스텀 프리셋 (기본 프리셋과 같은 형식, 브라우저에 보관)
const loadCustomPresets = () => { try { const v = JSON.parse(localStorage.getItem('mv_move_presets')); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveCustomPresets = (list) => { try { localStorage.setItem('mv_move_presets', JSON.stringify(list)); } catch { } };

export function LayerAnimPanel({ cut, layer, updLayerAnim, updLayers, pathCapture, setPathCapture, cutProgress = 0 }) {
    const a = { ...LAYER_ANIM_DEFAULT, ...layer.anim };
    const [custom, setCustom] = React.useState(loadCustomPresets);
    const keys = Array.isArray(a.keys) ? a.keys : [];
    const sortKeys = (arr) => [...arr].sort((x, y) => x.p - y.p);
    const setKeys = (arr) => updLayerAnim(cut.id, layer.id, { keys: arr.length ? sortKeys(arr) : null });
    // 현재 재생 위치(컷 내 진행도)에 키를 추가한다. 같은 위치면 덮어쓴다.
    const addKeyHere = () => {
        const p = Math.round(Math.max(0, Math.min(1, cutProgress)) * 100) / 100;
        const cur = keys.find(k => Math.abs(k.p - p) < 0.005);
        const val = { p, tx: a.tx || 0, ty: a.ty || 0, rot: a.rot || 0, scale: a.scale || 0, op: 1, ease: 'inout', easePower: 2 };
        setKeys(cur ? keys.map(k => k === cur ? { ...k, ...val } : k) : [...keys, val]);
    };
    const updKey = (i, o) => setKeys(keys.map((k, j) => j === i ? { ...k, ...o } : k));
    return (
        <div style={{ padding: '6px 8px', background: 'hsl(var(--ui-h) var(--ui-s) 10%)', borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', display: 'flex', flexDirection: 'column', gap: 5 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>{tr('파츠 애니메이션 (재생 시 적용)')}</span>
                {layer.anim && <button className="small-btn" onClick={() => updLayers(cut.id, c => ({ layers: c.layers.map(l => l.id === layer.id ? { ...l, anim: undefined } : l) }))}>{tr('끄기')}</button>}
            </div>
            {/* 부드러운 모션 프리셋 — 누르면 아래 값들이 한 번에 채워지고, 이후 자유롭게 손볼 수 있다.
                현재 설정을 내 프리셋으로 저장해 두고 다른 파츠에 재사용할 수도 있다. */}
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
            {/* 키프레임 트위닝: 시점마다 값을 찍어두면 그 사이를 자동으로 이어준다 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', paddingTop: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#c9a' }}
                    title={tr("재생 위치를 옮겨가며 '키 추가'를 누르면 그 사이가 자동으로 보간됩니다(트위닝). 키가 2개 이상이면 위의 이동/회전/크기 대신 키프레임이 적용됩니다.")}>
                    <span style={{ width: 34, fontWeight: 700 }}>{tr('키프레임')}</span>
                    <button className="small-btn" onClick={addKeyHere}>+ {tr('키 추가')} ({Math.round(Math.max(0, Math.min(1, cutProgress)) * 100)}%)</button>
                    {keys.length > 0 && <button className="small-btn" onClick={() => setKeys([])}>{tr('전체 삭제')}</button>}
                    {keys.length === 1 && <span style={{ color: '#e0a84e' }}>{tr('2개 이상부터 적용')}</span>}
                    {keys.length >= 2 && <span style={{ color: '#5a8' }}>● {tr('{0}개', keys.length)}</span>}
                </div>
                {keys.map((k, i) => (
                    <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'center', fontSize: 9, color: '#999', flexWrap: 'wrap', paddingLeft: 36 }}>
                        <NumIn value={Math.round(k.p * 100)} onChange={v => updKey(i, { p: Math.max(0, Math.min(100, v)) / 100 })} min={0} max={100} w={44} title={tr('시점 (컷 내 %)')} />%
                        X<NumIn value={k.tx || 0} onChange={v => updKey(i, { tx: v })} w={50} title={tr('가로 이동(px)')} />
                        Y<NumIn value={k.ty || 0} onChange={v => updKey(i, { ty: v })} w={50} title={tr('세로 이동(px)')} />
                        ∠<NumIn value={k.rot || 0} onChange={v => updKey(i, { rot: v })} step={5} w={46} title={tr('회전(도)')} />
                        ⤢<NumIn value={Math.round((k.scale || 0) * 100)} onChange={v => updKey(i, { scale: v / 100 })} step={5} w={46} title={tr('크기 변화(%)')} />
                        α<NumIn value={Math.round((k.op ?? 1) * 100)} onChange={v => updKey(i, { op: Math.max(0, Math.min(100, v)) / 100 })} min={0} max={100} step={10} w={44} title={tr('불투명도(%)')} />
                        <select className="time-input" style={{ width: 62, height: 18, fontSize: 9 }} value={k.ease || 'linear'}
                            onChange={e => updKey(i, { ease: e.target.value })} title={tr('이 키에서 다음 키까지의 가감속')}>
                            {EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
                        </select>
                        <button className="small-btn" style={{ fontSize: 9, padding: '1px 5px' }} onClick={() => setKeys(keys.filter((_, j) => j !== i))}>✕</button>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>{tr('이동')}</span>
                X<NumIn value={a.tx} onChange={v => updLayerAnim(cut.id, layer.id, { tx: v })} title={tr('가로 이동(px)')} />
                Y<NumIn value={a.ty} onChange={v => updLayerAnim(cut.id, layer.id, { ty: v })} title={tr('세로 이동(px)')} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>{tr('회전')}</span>
                <NumIn value={a.rot} onChange={v => updLayerAnim(cut.id, layer.id, { rot: v })} step={5} w={60} title={tr('회전(도)')} />
                <span style={{ marginLeft: 6 }}>{tr('크기')}</span>
                <NumIn value={Math.round(a.scale * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { scale: v / 100 })} step={5} w={64} title={tr('크기 변화(%)')} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={a.mode === 'return'} onChange={e => updLayerAnim(cut.id, layer.id, { mode: e.target.checked ? 'return' : 'progress' })} /> {tr('왕복')}
                </label>
                <span style={{ marginLeft: 4, color: '#aaa' }}>{tr('속도')}</span>
                <NumIn value={a.speed} onChange={v => updLayerAnim(cut.id, layer.id, { speed: Math.max(0.01, v) })} step={0.5} min={0.01} w={56} title={tr('재생 속도 배수 (상한 없음)')} />x
                <span style={{ color: a.mode === 'return' ? '#aaa' : '#555' }}>{tr('횟수')}</span>
                <NumIn value={a.count} onChange={v => updLayerAnim(cut.id, layer.id, { count: Math.round(v) })} min={0} w={44} title={tr('횟수 (0 = 컷 내내)')} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>{tr('속도감')}</span>
                <select value={a.ease} onChange={e => updLayerAnim(cut.id, layer.id, { ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }} title={tr('가속/감속 (왕복 아닐 때)')}>{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select>
                <span style={{ color: a.ease === 'linear' ? '#555' : '#aaa' }}>{tr('가중치')}</span>
                <NumIn value={a.easePower} onChange={v => updLayerAnim(cut.id, layer.id, { easePower: Math.max(0.1, v) })} step={0.5} min={0.1} w={50} title={tr('가감속 세기 (상한 없음)')} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#888' }}>
                <span>{tr('기준점')}</span>
                X<NumIn value={Math.round((a.pivotX ?? 0.5) * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { pivotX: v / 100 })} step={5} w={50} title={tr('기준점 X (%)')} />
                Y<NumIn value={Math.round((a.pivotY ?? 0.5) * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { pivotY: v / 100 })} step={5} w={50} title={tr('기준점 Y (%)')} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#8bd' }} title={tr('머리카락·천처럼 계속 흔들리는 효과. 기준점 Y를 위(0)로 두면 아래가 크게 흔들립니다.')}>
                <span style={{ width: 24 }}>{tr('흔들')}</span>
                <span>{tr('강도')}</span><NumIn value={a.swayAmount || 0} onChange={v => updLayerAnim(cut.id, layer.id, { swayAmount: v })} min={0} w={50} title={tr('흔들림 강도')} />
                <span>{tr('속도')}</span><NumIn value={a.swaySpeed || 1} onChange={v => updLayerAnim(cut.id, layer.id, { swaySpeed: v })} step={0.1} min={0.1} w={50} title={tr('흔들림 속도')} />
            </div>
            {/* 흔들림2: 곡선을 그려서 흔들리는 tr('모양')을 직접 정한다 (없으면 기본 사인파) */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#8bd' }}
                title={tr('물결치듯 곡선을 그리면 그 곡선의 모양과 크기대로 흔들립니다. 그리지 않으면 기본 사인파로 흔들립니다.')}>
                <span style={{ width: 24 }}>{tr('모양')}</span>
                <button className="small-btn" style={{ background: pathCapture && pathCapture.mode === 'sway' && pathCapture.layerId === layer.id ? 'var(--accent-soft)' : undefined }}
                    onClick={() => setPathCapture(pc => (pc && pc.mode === 'sway' && pc.cutId === cut.id && pc.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id, mode: 'sway' })}>
                    {pathCapture && pathCapture.mode === 'sway' && pathCapture.layerId === layer.id ? tr('그리는 중…') : (a.swayCurve ? tr('곡선 다시 그리기') : tr('흔들림 곡선 그리기'))}
                </button>
                {a.swayCurve && <button className="small-btn" onClick={() => updLayerAnim(cut.id, layer.id, { swayCurve: null })}>{tr('기본 파형')}</button>}
                {a.swayCurve && <span style={{ color: '#5a8' }}>{tr('● 곡선')}</span>}
            </div>
            {/* 지점별 꺾임: 축을 따라 놓인 각 지점의 흔들림 정도(-100~100%).
                0 = 그 지점은 고정, 부호를 반대로 주면 반대쪽으로 꺾인다. */}
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
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                            title={tr('축을 따라 지점마다 얼마나 흔들릴지 정합니다. 0 = 고정(유지), 음수 = 반대쪽으로 꺾임.')}>
                            <span style={{ width: 24 }}>{tr('꺾임')}</span>
                            {!prof
                                ? <button className="small-btn" onClick={() => setProf([0, 0.5, 1])}>{tr('지점별 꺾임 켜기')}</button>
                                : <>
                                    <select className="time-input" style={{ width: 52, height: 20, fontSize: 10 }} value={a.swayAxis || 'y'}
                                        onChange={e => updLayerAnim(cut.id, layer.id, { swayAxis: e.target.value })} title={tr('변형 중심축')}>
                                        <option value="y">{tr('세로축')}</option><option value="x">{tr('가로축')}</option>
                                    </select>
                                    <span>{tr('지점')}</span>
                                    <NumIn value={prof.length} onChange={v => resize(Math.max(2, Math.min(8, Math.round(v))))} min={2} max={8} w={40} title={tr('제어 지점 개수 (2~8)')} />
                                    <button className="small-btn" onClick={() => setProf(null)}>{tr('끄기')}</button>
                                </>}
                        </div>
                        {prof && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingLeft: 26 }}>
                                {prof.map((w, i) => (
                                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}
                                        title={tr('{0} {1}% 지점의 흔들림 정도(%)', a.swayAxis === 'x' ? tr('왼쪽→오른쪽') : tr('위→아래'), Math.round(i / (prof.length - 1) * 100))}>
                                        <span style={{ color: '#667' }}>{Math.round(i / (prof.length - 1) * 100)}%</span>
                                        <NumIn value={Math.round(w * 100)} step={10} min={-100} max={100} w={46}
                                            onChange={v => setProf(prof.map((x, j) => j === i ? v / 100 : x))} />
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })()}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>{tr('경로')}</span>
                <button className="small-btn" style={{ background: pathCapture && pathCapture.layerId === layer.id ? 'var(--accent-soft)' : undefined }}
                    onClick={() => setPathCapture(pc => (pc && pc.cutId === cut.id && pc.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id })}>
                    {pathCapture && pathCapture.layerId === layer.id ? tr('그리는 중…') : (a.path ? tr('경로 다시 그리기') : tr('경로 그리기'))}
                </button>
                {a.path && <button className="small-btn" onClick={() => updLayerAnim(cut.id, layer.id, { path: null })}>{tr('지우기')}</button>}
                {a.path && <span style={{ color: '#5a8' }}>● {tr('{0}점', a.path.length)}</span>}
            </div>
        </div>
    );
}

// 자글자글(boiling line) 효과 설정 — 레이어 단위. 가는 선까지 과하게 떨리는 걸 막기 위해
// 강도/파장/속도와 '최소 굵기' 문턱값을 직접 조절한다.
export function JitterPanel({ cut, layer, updLayer }) {
    const on = !!layer.roughen;
    const set = (o) => updLayer(cut.id, layer.id, o);
    return (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'hsl(var(--ui-h) var(--ui-s) 13%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#e0a84e' }}>
                <span style={{ fontWeight: 700 }}>{tr('자글자글')}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#aaa' }}>
                    <input type="checkbox" checked={on} onChange={e => set({ roughen: e.target.checked ? 2.4 : 0 })} /> {tr('켜기')}
                </label>
                {on && <span style={{ color: '#666' }}>{tr('선이 제자리에서 떨림')}</span>}
            </div>
            {on && <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                    <span style={{ width: 34 }}>{tr('강도')}</span>
                    <NumIn value={layer.roughen} onChange={v => set({ roughen: Math.max(0.1, v) })} step={0.2} min={0.1} w={52} title={tr('흔들리는 폭(px)')} />
                    <span style={{ width: 34 }}>{tr('파장')}</span>
                    <NumIn value={layer.roughWave ?? 1} onChange={v => set({ roughWave: v })} step={0.1} min={0.2} w={52} title={tr('물결 길이 배수 — 크게 하면 더 완만하고 둥글게')} />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                    <span style={{ width: 34 }}>{tr('속도')}</span>
                    <NumIn value={layer.roughSpeed ?? 1} onChange={v => set({ roughSpeed: v })} step={0.1} min={0} w={52} title={tr('떨리는 속도 배수 (0 = 정지)')} />
                    <span style={{ width: 34 }}>{tr('최소굵기')}</span>
                    <NumIn value={layer.roughMinSize ?? 0} onChange={v => set({ roughMinSize: Math.max(0, v) })} step={1} min={0} w={52} title={tr('이 굵기(px) 미만인 가는 선에는 효과를 주지 않음 — 0이면 전부 적용')} />
                </div>
                <div style={{ fontSize: 9, color: '#666' }}>{tr("가는 선까지 떨리면 '최소굵기'를 올리세요.")}</div>
            </>}
        </div>
    );
}
