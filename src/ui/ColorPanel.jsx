import React from 'react';
import { Droplets } from 'lucide-react';
import { tr } from '../i18n';

// --- Colour conversion (HSV <-> HEX) ---------------------------------------------------
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

export const RECENT_SLOTS = 30; // How many recent-colour slots to keep (fixed).

// Colour wheel: the outer ring is hue, the inner square is saturation and value.
// It sizes with the panel width so narrowing the panel never clips it out of sight.
function ColorWheel({ color, onPick, size = 168 }) {
    const WHEEL = Math.max(96, Math.round(size));
    const RING = Math.max(9, Math.round(WHEEL * 0.085));
    const R_OUT = WHEEL / 2 - 2, R_IN = R_OUT - RING;
    const SQ = Math.max(40, Math.floor((R_IN * 2) / Math.SQRT2) - 2);
    const ringRef = React.useRef(null);
    const sqRef = React.useRef(null);
    const dragRef = React.useRef(null);
    const { r, g, b } = hex2rgb(/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000');
    const { h, s, v } = rgb2hsv(r, g, b);

    // The ring only carries hue, so it is drawn once.
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
    }, [WHEEL, RING]);

    // The square is redrawn whenever the hue changes.
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
    }, [h, SQ]);

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
    // Capture the pointer so dragging outside the element keeps tracking - losing the drag
    // mid-pick is maddening.
    const startDrag = (kind) => (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        try { el.setPointerCapture(e.pointerId); } catch { }
        dragRef.current = kind;
        (kind === 'ring' ? ringFromEvent : sqFromEvent)(e, el);
    };
    const onMove = (kind) => (e) => {
        if (dragRef.current !== kind) return;
        (kind === 'ring' ? ringFromEvent : sqFromEvent)(e, e.currentTarget);
    };
    const endDrag = () => { dragRef.current = null; };

    const ang = h * Math.PI / 180, rMid = (R_OUT + R_IN) / 2;
    // Every position is computed inline. Relying on CSS percentages plus translate lets the
    // square escape the ring as soon as the parent is not the size we assumed.
    const sqLeft = (WHEEL - SQ) / 2, sqTop = (WHEEL - SQ) / 2;
    return (
        <div className="wheel-wrap" style={{ position: 'relative', width: WHEEL, height: WHEEL, flex: '0 0 auto', margin: '0 auto' }}>
            <canvas ref={ringRef} width={WHEEL} height={WHEEL} className="wheel-ring"
                style={{ position: 'absolute', left: 0, top: 0, width: WHEEL, height: WHEEL }}
                onPointerDown={startDrag('ring')} onPointerMove={onMove('ring')} onPointerUp={endDrag} onPointerCancel={endDrag} />
            {/* Hue position marker. */}
            <div className="wheel-mark" style={{ left: WHEEL / 2 + Math.cos(ang) * rMid, top: WHEEL / 2 + Math.sin(ang) * rMid }} />
            <canvas ref={sqRef} width={SQ} height={SQ} className="wheel-sq"
                style={{ position: 'absolute', left: sqLeft, top: sqTop, width: SQ, height: SQ, transform: 'none' }}
                onPointerDown={startDrag('sq')} onPointerMove={onMove('sq')} onPointerUp={endDrag} onPointerCancel={endDrag} />
            {/* Saturation and value position marker. */}
            <div className="wheel-mark" style={{ left: sqLeft + s * SQ, top: sqTop + (1 - v) * SQ }} />
        </div>
    );
}

// Colour panel, a standalone panel in the Clip Studio style.
// It used to cram the wheel, recent colours and palettes into a 96px tool strip, which broke
// the layout. Pulled out here, the swatches get a real size and palettes become tabs.
export default function ColorPanel({
    color, applyColor, pickColor, pickingColor,
    recentColors,
    width,
    onClose,
}) {
    const swatch = (c, i, size, onPick) => (
        <button key={i} onClick={onPick} title={c}
            style={{
                width: size, height: size, borderRadius: 4, background: c, padding: 0, cursor: 'pointer',
                border: c.toLowerCase() === String(color).toLowerCase() ? '2px solid var(--accent-soft)' : '1px solid #0005',
            }} />
    );
    return (
        <div className="color-panel" style={{ width }}>
            <div className="panel-head">
                <span className="panel-title">COLOR</span>
                <button className="icon-btn" onClick={onClose} title={tr('색상 창 닫기')}>✕</button>
            </div>

            {/* Colour wheel: hue on the outer ring, saturation and value in the inner square. */}
            <ColorWheel color={color} onPick={applyColor} size={Math.max(96, Math.min(240, (width || 200) - 26))} />

            {/* The current colour shown large, with its code and the eyedropper. */}
            <div className="current-color">
                <div className="current-color-chip" style={{ background: color }} title={tr('현재 색')} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 9, color: '#7a7a90' }}>{tr('현재 색')}</span>
                    <input className="time-input" style={{ width: '100%' }} value={color}
                        onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) applyColor(v); }}
                        title={tr('색상 코드 직접 입력 (#RRGGBB)')} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <input type="color" className="color-swatch-sm" value={color} onChange={e => applyColor(e.target.value)} title={tr('시스템 색 선택기')} />
                    <button className={`button${pickingColor ? ' button-primary' : ''}`} onClick={pickColor} title={tr('스포이드')} style={{ height: 24, padding: '0 6px', justifyContent: 'center' }}>
                        <Droplets size={13} />
                    </button>
                </div>
            </div>

            {/* Recent colours, collecting only the ones actually used.
                The slot count is fixed at 30 with the spares left blank, so the area does not
                jump in size every time a colour is added. */}
            <div className="color-section-label">{tr('최근 사용한 색')}</div>
            <div className="slot-grid">
                {Array.from({ length: RECENT_SLOTS }, (_, i) => {
                    const c = recentColors[i];
                    return c
                        ? <button key={i} className={`slot filled${c.toLowerCase() === String(color).toLowerCase() ? ' sel' : ''}`}
                            style={{ background: c }} title={c} onClick={() => applyColor(c)} />
                        : <span key={i} className="slot empty" />;
                })}
            </div>

        </div>
    );
}
