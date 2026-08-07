import React from 'react';
import { ANIM_DEFAULT, LAYER_ANIM_DEFAULT } from './canvasUtils';

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
const NumIn = ({ value, onChange, step = 1, min, max, w = 56, title }) => (
    <input type="number" className="time-input" title={title} value={value} step={step} min={min} max={max} style={{ width: w }}
        onChange={e => { let v = parseFloat(e.target.value); if (isNaN(v)) v = 0; if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); onChange(v); }} />
);

// Per-cut animation (in/out, deform, move, easing).
export function CutAnimPanel({ cut, updCutAnim }) {
    const a = { ...ANIM_DEFAULT, ...cut.anim };
    return (
        <div style={{ marginTop: 8, borderTop: '1px solid #2a2a3a', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888' }}>컷 애니메이션 (재생 시 적용)</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>진입</span>
                <select value={a.inType} onChange={e => updCutAnim(cut.id, { inType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }}>
                    <option value="none">없음</option><option value="fade">페이드</option><option value="scale">확대</option><option value="slide">슬라이드</option>
                </select>
                {a.inType === 'slide' && <select value={a.inDir} onChange={e => updCutAnim(cut.id, { inDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.inDur} onChange={v => updCutAnim(cut.id, { inDur: v })} step={0.1} min={0} title="지속(초)" />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>진출</span>
                <select value={a.outType} onChange={e => updCutAnim(cut.id, { outType: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }}>
                    <option value="none">없음</option><option value="fade">페이드</option><option value="scale">축소</option><option value="slide">슬라이드</option>
                </select>
                {a.outType === 'slide' && <select value={a.outDir} onChange={e => updCutAnim(cut.id, { outDir: e.target.value })} className="time-input" style={{ width: 50 }}><option value="up">↑</option><option value="down">↓</option><option value="left">←</option><option value="right">→</option></select>}
                <NumIn value={a.outDur} onChange={v => updCutAnim(cut.id, { outDur: v })} step={0.1} min={0} title="지속(초)" />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>변형</span>
                <select value={a.deformAxis} onChange={e => updCutAnim(cut.id, { deformAxis: e.target.value })} className="time-input" style={{ width: 56 }}><option value="y">상하</option><option value="x">좌우</option></select>
                <input type="range" min="-50" max="50" step="5" value={Math.round(a.deformAmount * 100)} onChange={e => updCutAnim(cut.id, { deformAmount: (+e.target.value) / 100 })} style={{ flex: 1, minWidth: 0 }} title="스퀴즈/스트레치 양" />
                <span style={{ fontSize: 10, width: 34, color: '#aaa', textAlign: 'right' }}>{Math.round(a.deformAmount * 100)}%</span>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={!!a.deformReturn} onChange={e => updCutAnim(cut.id, { deformReturn: e.target.checked })} /> 왕복
                </label>
                <span style={{ fontSize: 10, color: a.deformReturn ? '#aaa' : '#555', marginLeft: 4 }}>속도</span>
                <input type="range" min="0.2" max="6" step="0.1" value={a.deformSpeed} disabled={!a.deformReturn} onChange={e => updCutAnim(cut.id, { deformSpeed: +e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <span style={{ fontSize: 10, width: 28, color: a.deformReturn ? '#aaa' : '#555', textAlign: 'right' }}>{(+a.deformSpeed).toFixed(1)}x</span>
                <span style={{ fontSize: 10, color: a.deformReturn ? '#aaa' : '#555' }}>횟수</span>
                <NumIn value={a.deformCount} onChange={v => updCutAnim(cut.id, { deformCount: Math.round(v) })} min={0} w={44} title="횟수 (0 = 컷 내내)" />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>이동</span>
                X<NumIn value={a.moveX} onChange={v => updCutAnim(cut.id, { moveX: v })} w={62} title="가로 이동(px)" />
                Y<NumIn value={a.moveY} onChange={v => updCutAnim(cut.id, { moveY: v })} w={62} title="세로 이동(px)" />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={!!a.moveReturn} onChange={e => updCutAnim(cut.id, { moveReturn: e.target.checked })} /> 이동왕복
                </label>
                <span style={{ fontSize: 10, color: a.moveReturn ? '#aaa' : '#555', marginLeft: 4 }}>속도</span>
                <input type="range" min="0.2" max="6" step="0.1" value={a.moveSpeed} disabled={!a.moveReturn} onChange={e => updCutAnim(cut.id, { moveSpeed: +e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <span style={{ fontSize: 10, color: a.moveReturn ? '#aaa' : '#555' }}>횟수</span>
                <NumIn value={a.moveCount} onChange={v => updCutAnim(cut.id, { moveCount: Math.round(v) })} min={0} w={44} title="횟수 (0 = 컷 내내)" />
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, width: 28, color: '#aaa', flexShrink: 0 }}>속도감</span>
                <select value={a.ease} onChange={e => updCutAnim(cut.id, { ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }} title="가속/감속 곡선">{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <span style={{ fontSize: 10, color: a.ease === 'linear' ? '#555' : '#aaa' }}>가중치</span>
                <input type="range" min="1" max="4" step="0.5" value={a.easePower} disabled={a.ease === 'linear'} onChange={e => updCutAnim(cut.id, { easePower: +e.target.value })} style={{ width: 70 }} />
            </div>
        </div>
    );
}

// Per-layer ("part") animation (move/rotate/scale/path + ping-pong/speed/count/easing).
export function LayerAnimPanel({ cut, layer, updLayerAnim, updLayers, pathCapture, setPathCapture }) {
    const a = { ...LAYER_ANIM_DEFAULT, ...layer.anim };
    return (
        <div style={{ padding: '6px 8px', background: '#15151f', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 5 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#888' }}>파츠 애니메이션 (재생 시 적용)</span>
                {layer.anim && <button className="small-btn" onClick={() => updLayers(cut.id, c => ({ layers: c.layers.map(l => l.id === layer.id ? { ...l, anim: undefined } : l) }))}>끄기</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>이동</span>
                X<NumIn value={a.tx} onChange={v => updLayerAnim(cut.id, layer.id, { tx: v })} title="가로 이동(px)" />
                Y<NumIn value={a.ty} onChange={v => updLayerAnim(cut.id, layer.id, { ty: v })} title="세로 이동(px)" />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>회전</span>
                <NumIn value={a.rot} onChange={v => updLayerAnim(cut.id, layer.id, { rot: v })} step={5} w={60} title="회전(도)" />
                <span style={{ marginLeft: 6 }}>크기</span>
                <NumIn value={Math.round(a.scale * 100)} onChange={v => updLayerAnim(cut.id, layer.id, { scale: v / 100 })} step={5} w={64} title="크기 변화(%)" />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={a.mode === 'return'} onChange={e => updLayerAnim(cut.id, layer.id, { mode: e.target.checked ? 'return' : 'progress' })} /> 왕복
                </label>
                <span style={{ marginLeft: 4, color: a.mode === 'return' ? '#aaa' : '#555' }}>속도</span>
                <input type="range" min="0.2" max="6" step="0.1" value={a.speed} disabled={a.mode !== 'return'} onChange={e => updLayerAnim(cut.id, layer.id, { speed: +e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <span style={{ width: 26, textAlign: 'right', color: a.mode === 'return' ? '#aaa' : '#555' }}>{(+a.speed).toFixed(1)}x</span>
                <span style={{ color: a.mode === 'return' ? '#aaa' : '#555' }}>횟수</span>
                <NumIn value={a.count} onChange={v => updLayerAnim(cut.id, layer.id, { count: Math.round(v) })} min={0} w={44} title="횟수 (0 = 컷 내내)" />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>속도감</span>
                <select value={a.ease} onChange={e => updLayerAnim(cut.id, layer.id, { ease: e.target.value })} className="time-input" style={{ flex: 1, minWidth: 0 }} title="가속/감속 (왕복 아닐 때)">{EASE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <span style={{ color: a.ease === 'linear' ? '#555' : '#aaa' }}>가중치</span>
                <input type="range" min="1" max="4" step="0.5" value={a.easePower} disabled={a.ease === 'linear'} onChange={e => updLayerAnim(cut.id, layer.id, { easePower: +e.target.value })} style={{ width: 64 }} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#888' }}>
                <span>기준점</span>
                X<input type="range" min="0" max="1" step="0.05" value={a.pivotX} onChange={e => updLayerAnim(cut.id, layer.id, { pivotX: +e.target.value })} style={{ width: 54 }} />
                Y<input type="range" min="0" max="1" step="0.05" value={a.pivotY} onChange={e => updLayerAnim(cut.id, layer.id, { pivotY: +e.target.value })} style={{ width: 54 }} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#8bd' }} title="머리카락·천처럼 계속 흔들리는 효과. 기준점 Y를 위(0)로 두면 아래가 크게 흔들립니다.">
                <span style={{ width: 24 }}>흔들</span>
                <span>강도</span><NumIn value={a.swayAmount || 0} onChange={v => updLayerAnim(cut.id, layer.id, { swayAmount: v })} min={0} w={50} title="흔들림 강도" />
                <span>속도</span><NumIn value={a.swaySpeed || 1} onChange={v => updLayerAnim(cut.id, layer.id, { swaySpeed: v })} step={0.1} min={0.1} w={50} title="흔들림 속도" />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: '#aaa' }}>
                <span style={{ width: 24 }}>경로</span>
                <button className="small-btn" style={{ background: pathCapture && pathCapture.layerId === layer.id ? '#7c8cff' : undefined }}
                    onClick={() => setPathCapture(pc => (pc && pc.cutId === cut.id && pc.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id })}>
                    {pathCapture && pathCapture.layerId === layer.id ? '그리는 중…' : (a.path ? '경로 다시 그리기' : '경로 그리기')}
                </button>
                {a.path && <button className="small-btn" onClick={() => updLayerAnim(cut.id, layer.id, { path: null })}>지우기</button>}
                {a.path && <span style={{ color: '#5a8' }}>● {a.path.length}점</span>}
            </div>
        </div>
    );
}
