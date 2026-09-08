import React from 'react';
import { swayWeightAt } from '../canvas/canvasUtils';
import { tr } from '../i18n';

// Editing a sway profile on the drawing instead of in a row of number fields.
//
// The profile is what makes hair swing from its roots and a ribbon trail from where it is held: a
// weight at each of a few points along an axis, interpolated between them, deciding how far that
// part of the layer moves. The renderer for it has been right for a while - it slices the layer
// and shears each slice so the displacement varies continuously and leaves no seam.
//
// Setting it was the part that was wrong. "위→아래 50% 지점의 흔들림 정도(%)" as a number field is
// asking someone to picture the result and then type it, on a tablet, with a pen in their hand.
// Here the points sit on the drawing and are dragged.
//
// An SVG overlay rather than painting into the canvas: the stage is already position:relative and
// scaled, so a viewBox in canvas coordinates lines up exactly and keeps doing so at any zoom -
// and the handles stay crisp instead of being drawn at whatever the zoom happens to be.

/** Where the curve is sampled to draw it. Enough that the smoothstep reads as a curve. */
const CURVE_STEPS = 48;
/** Hit radius of a handle, in canvas units. Generous, because this is used with a pen. */
const GRAB_R = 26;

/**
 * @param {object} props
 * @param {number[]} props.profile weights, -1..1, one per point along the axis
 * @param {'x'|'y'} props.axis which way the points run
 * @param {number} props.amount `swayAmount`, a percentage of the span at full swing
 * @param {number} props.cw
 * @param {number} props.ch
 * @param {(profile: number[]) => void} props.onChange
 * @param {() => void} props.onClose
 */
export function SwaySpine({ profile, axis, amount, cw, ch, onChange, onClose }) {
    const [dragging, setDragging] = React.useState(/** @type {number|null} */(null));
    const svgRef = React.useRef(/** @type {SVGSVGElement|null} */(null));

    const vertical = axis !== 'x';
    // The span the points run along, and the one they are displaced across. For a vertical axis
    // the points go down the canvas and swing sideways; for a horizontal axis, the mirror.
    const along = vertical ? ch : cw;
    const across = vertical ? cw : ch;
    // Full swing, in pixels. The same number the renderer uses: swayDisp is (amount / 100) times
    // the span, and the weight scales it. Showing the extreme rather than the current phase is
    // what makes this editable - the drawing underneath is mid-swing and moving.
    const reach = (amount / 100) * along;

    /** Canvas coordinates of the point for weight `w` at position `p` (0..1) along the axis. */
    const at = (p, w) => {
        const a = p * along;
        const b = across / 2 + w * reach;
        return vertical ? { x: b, y: a } : { x: a, y: b };
    };

    const toCanvas = (e) => {
        const svg = svgRef.current;
        const r = svg.getBoundingClientRect();
        return {
            x: ((e.clientX - r.left) / r.width) * cw,
            y: ((e.clientY - r.top) / r.height) * ch,
        };
    };

    const weightFrom = (pt) => {
        if (!reach) return 0;
        const b = vertical ? pt.x : pt.y;
        return Math.max(-1, Math.min(1, (b - across / 2) / reach));
    };

    const grab = (i) => (e) => {
        e.stopPropagation();
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
        setDragging(i);
    };

    const move = (e) => {
        if (dragging == null) return;
        e.preventDefault();
        const w = weightFrom(toCanvas(e));
        onChange(profile.map((x, j) => (j === dragging ? w : x)));
    };

    const release = () => setDragging(null);

    // The curve the renderer will actually follow, sampled through the same smoothstep rather
    // than drawn as straight lines between the points - a straight preview of a curved result is
    // a preview that lies about the corners.
    const curve = [];
    for (let s = 0; s <= CURVE_STEPS; s++) {
        const p = s / CURVE_STEPS;
        const { x, y } = at(p, swayWeightAt(profile, p));
        curve.push(`${s ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const rest = vertical
        ? `M${across / 2} 0 L${across / 2} ${along}`
        : `M0 ${across / 2} L${along} ${across / 2}`;

    return (
        <svg
            ref={svgRef}
            className="sway-spine"
            viewBox={`0 0 ${cw} ${ch}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', zIndex: 6 }}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
        >
            {/* Where the layer sits at rest, so the swing is read as a departure from something. */}
            <path d={rest} stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeDasharray="6 6" fill="none" />
            <path d={curve.join(' ')} stroke="#fde047" strokeWidth={3} fill="none" strokeLinecap="round" />
            {profile.map((w, i) => {
                const p = profile.length > 1 ? i / (profile.length - 1) : 0;
                const { x, y } = at(p, w);
                const held = dragging === i;
                return (
                    <g key={i}>
                        {/* A wide invisible target under the visible dot: a pen is not precise, and
                            a handle that has to be hit exactly is a handle that feels broken. */}
                        <circle cx={x} cy={y} r={GRAB_R} fill="transparent" style={{ cursor: 'grab' }}
                            onPointerDown={grab(i)}>
                            <title>{tr('{0}% 지점 — 끌어서 흔들림 조절', Math.round(p * 100))}</title>
                        </circle>
                        <circle cx={x} cy={y} r={held ? 13 : 10}
                            fill={held ? '#fde047' : '#1b1b24'} stroke="#fde047" strokeWidth={3} pointerEvents="none" />
                        <text x={x} y={y - 20} textAnchor="middle" fill="#fde047" fontSize={20} pointerEvents="none">
                            {Math.round(w * 100)}
                        </text>
                    </g>
                );
            })}
            {/* Sits on the canvas rather than in the panel, because that is where the eyes are. */}
            <foreignObject x={cw - 150} y={10} width={140} height={40}>
                <button className="button" onClick={onClose} style={{ height: 28, width: '100%' }}>
                    {tr('점 편집 끝')}
                </button>
            </foreignObject>
        </svg>
    );
}

export default SwaySpine;
