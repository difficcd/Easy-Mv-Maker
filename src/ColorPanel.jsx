import React from 'react';
import { Droplets, Trash2, Plus, Pencil } from 'lucide-react';

// --- 색 변환 (HSV <-> HEX) ------------------------------------------------------------
const hex2rgb = (h) => {
    const x = String(h).replace('#', '');
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) };
};
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const rgb2hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
    }
    return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
};
const hsv2rgb = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: (t[0] + m) * 255, g: (t[1] + m) * 255, b: (t[2] + m) * 255 };
};
const hsv2hex = (h, s, v) => { const { r, g, b } = hsv2rgb(h, s, v); return rgb2hex(r, g, b); };

// 색상환: 바깥 고리 = 색조, 안쪽 사각형 = 채도/명도.
const WHEEL = 168, RING = 14, R_OUT = WHEEL / 2 - 2, R_IN = R_OUT - RING;
const SQ = Math.floor((R_IN * 2) / Math.SQRT2) - 2; // 고리 안에 들어가는 정사각형

function ColorWheel({ color, onPick }) {
    const ringRef = React.useRef(null);
    const sqRef = React.useRef(null);
    const dragRef = React.useRef(null);
    const { r, g, b } = hex2rgb(/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000');
    const { h, s, v } = rgb2hsv(r, g, b);

    // 고리는 색조만 담으므로 한 번만 그린다.
    React.useEffect(() => {
        const c = ringRef.current; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, WHEEL, WHEEL);
        const cx = WHEEL / 2, cy = WHEEL / 2;
        for (let a = 0; a < 360; a++) {
            ctx.beginPath();
            ctx.strokeStyle = `hsl(${a} 100% 50%)`;
            ctx.lineWidth = RING + 1;
            ctx.arc(cx, cy, (R_OUT + R_IN) / 2, (a - 0.7) * Math.PI / 180, (a + 0.7) * Math.PI / 180);
            ctx.stroke();
        }
    }, []);

    // 사각형은 현재 색조에 따라 다시 그린다.
    React.useEffect(() => {
        const c = sqRef.current; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = `hsl(${h} 100% 50%)`;
        ctx.fillRect(0, 0, SQ, SQ);
        const gw = ctx.createLinearGradient(0, 0, SQ, 0);
        gw.addColorStop(0, 'rgba(255,255,255,1)'); gw.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gw; ctx.fillRect(0, 0, SQ, SQ);
        const gb = ctx.createLinearGradient(0, 0, 0, SQ);
        gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gb; ctx.fillRect(0, 0, SQ, SQ);
    }, [h]);

    const ringFromEvent = (e, el) => {
        const r0 = el.getBoundingClientRect();
        const dx = e.clientX - r0.left - WHEEL / 2, dy = e.clientY - r0.top - WHEEL / 2;
        const a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        onPick(hsv2hex(a, s || 1, v || 1));
    };
    const sqFromEvent = (e, el) => {
        const r0 = el.getBoundingClientRect();
        const ns = Math.max(0, Math.min(1, (e.clientX - r0.left) / SQ));
        const nv = Math.max(0, Math.min(1, 1 - (e.clientY - r0.top) / SQ));
        onPick(hsv2hex(h, ns, nv));
    };
    // 포인터를 잡아 밖으로 나가도 계속 따라오게 한다(색 고르는 중 끊기면 답답함).
    const startDrag = (kind) => (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture?.(e.pointerId);
        dragRef.current = kind;
        (kind === 'ring' ? ringFromEvent : sqFromEvent)(e, el);
    };
    const onMove = (kind) => (e) => {
        if (dragRef.current !== kind) return;
        (kind === 'ring' ? ringFromEvent : sqFromEvent)(e, e.currentTarget);
    };
    const endDrag = () => { dragRef.current = null; };

    const ang = h * Math.PI / 180, rMid = (R_OUT + R_IN) / 2;
    return (
        <div className="wheel-wrap" style={{ width: WHEEL, height: WHEEL }}>
            <canvas ref={ringRef} width={WHEEL} height={WHEEL} className="wheel-ring"
                onPointerDown={startDrag('ring')} onPointerMove={onMove('ring')} onPointerUp={endDrag} onPointerCancel={endDrag} />
            {/* 색조 위치 표시 */}
            <div className="wheel-mark" style={{ left: WHEEL / 2 + Math.cos(ang) * rMid, top: WHEEL / 2 + Math.sin(ang) * rMid }} />
            <canvas ref={sqRef} width={SQ} height={SQ} className="wheel-sq" style={{ width: SQ, height: SQ }}
                onPointerDown={startDrag('sq')} onPointerMove={onMove('sq')} onPointerUp={endDrag} onPointerCancel={endDrag} />
            {/* 채도·명도 위치 표시 */}
            <div className="wheel-mark" style={{
                left: (WHEEL - SQ) / 2 + s * SQ,
                top: (WHEEL - SQ) / 2 + (1 - v) * SQ,
            }} />
        </div>
    );
}

// 색상 패널 (클립스튜디오식 독립 패널).
// 예전에는 96px짜리 좁은 도구 막대 안에 색상·최근색·팔레트를 전부 밀어넣어 디자인이 무너졌다.
// 여기로 빼면서 스와치를 제대로 된 크기로 놓고, 팔레트를 '탭'으로 보여준다.
export default function ColorPanel({
    color, useColor, pickColor, pickingColor,
    recentColors,
    palettes, activePalette, setActivePalette,
    addToPalette, removeFromPalette, addPalette, renamePalette, deletePalette,
    paletteEdit, setPaletteEdit,
    onClose,
}) {
    const pal = palettes[activePalette];
    const swatch = (c, i, size, onPick, onRemove) => (
        <button key={i} onClick={onPick} onContextMenu={e => { e.preventDefault(); onRemove?.(); }} title={c}
            style={{
                width: size, height: size, borderRadius: 4, background: c, padding: 0, cursor: 'pointer',
                border: c.toLowerCase() === String(color).toLowerCase() ? '2px solid var(--accent-soft)' : '1px solid #0005',
                outline: onRemove && paletteEdit ? '1px dashed #f66' : 'none',
            }} />
    );
    return (
        <div className="color-panel">
            <div className="color-panel-head">
                <span className="panel-title">COLOR</span>
                <button className="icon-btn" onClick={onClose} title="색상 패널 닫기">✕</button>
            </div>

            {/* 색상환: 바깥 고리로 색조, 안쪽 사각형으로 채도·명도 */}
            <ColorWheel color={color} onPick={useColor} />

            {/* 현재 색 크게 보여주기 + 코드 + 스포이드 */}
            <div className="current-color">
                <div className="current-color-chip" style={{ background: color }} title="현재 색" />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 9, color: '#7a7a90' }}>현재 색</span>
                    <input className="time-input" style={{ width: '100%' }} value={color}
                        onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) useColor(v); }}
                        title="색상 코드 직접 입력 (#RRGGBB)" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <input type="color" className="color-swatch-sm" value={color} onChange={e => useColor(e.target.value)} title="시스템 색 선택기" />
                    <button className={`button${pickingColor ? ' button-primary' : ''}`} onClick={pickColor} title="스포이드" style={{ height: 24, padding: '0 6px', justifyContent: 'center' }}>
                        <Droplets size={13} />
                    </button>
                </div>
            </div>

            {/* 최근 색 — 실제로 '사용한' 색이 쌓인다 */}
            <div className="color-section-label">최근 사용한 색</div>
            <div className="swatch-grid" style={{ maxHeight: 150, overflowY: 'auto' }}>
                {recentColors.map((c, i) => swatch(c, i, 24, () => useColor(c)))}
                {!recentColors.length && <span style={{ fontSize: 10, color: '#666' }}>그리면 여기에 쌓입니다</span>}
            </div>

            {/* 팔레트 탭 */}
            <div className="color-section-label" style={{ marginTop: 10 }}>팔레트</div>
            <div className="pal-tabs">
                {palettes.map((p, i) => (
                    <button key={i} className={`pal-tab${i === activePalette ? ' active' : ''}`}
                        onClick={() => setActivePalette(i)} onDoubleClick={renamePalette}
                        title={`${p.name} (더블클릭: 이름 변경)`}>{p.name}</button>
                ))}
                <button className="pal-tab pal-tab-add" onClick={addPalette} title="새 팔레트 탭"><Plus size={12} /></button>
            </div>

            <div className="pal-actions">
                <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => addToPalette(color)} title="현재 색을 이 팔레트에 추가">＋ 색 추가</button>
                <button className="icon-btn" onClick={renamePalette} title="팔레트 이름 변경"><Pencil size={13} /></button>
                <button className={`icon-btn${paletteEdit ? ' active' : ''}`} onClick={() => setPaletteEdit(v => !v)}
                    title={paletteEdit ? '삭제 모드 끄기' : '삭제 모드 (스와치를 눌러 삭제)'}
                    style={paletteEdit ? { color: '#f66' } : undefined}><Trash2 size={13} /></button>
                {palettes.length > 1 && <button className="icon-btn del-btn" onClick={deletePalette} title="이 팔레트 탭 삭제">✕</button>}
            </div>

            <div className="swatch-grid" style={{ maxHeight: 190, overflowY: 'auto' }}
                title={paletteEdit ? '눌러서 삭제' : '클릭: 사용 · 우클릭: 삭제'}>
                {(pal?.colors || []).map((c, i) => swatch(c, i, 22,
                    () => paletteEdit ? removeFromPalette(i) : useColor(c),
                    () => removeFromPalette(i)))}
                {!(pal?.colors || []).length && <span style={{ fontSize: 10, color: '#666' }}>‘＋ 색 추가’로 채워보세요</span>}
            </div>

        </div>
    );
}
