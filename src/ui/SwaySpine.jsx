import React from 'react';
import { swayWeightAt, swayPointAt, sortSwayProfile } from '../canvas/canvasUtils';
import { tr } from '../i18n';

// Placing the points a sway bends around, on the drawing.
//
// The profile decides how far each part of a layer moves: hair swings from its roots, a ribbon
// trails from where it is held. The renderer for it has been right for a while - it slices the
// layer along an axis and shears each slice, so the displacement varies continuously and leaves
// no seam.
//
// What this is not: a rigging tool. There are no joints and no rotation - a point says "this far
// along the axis moves this much sideways", and the motion is a wave, not a chain. Bones would be
// a different deformation model and a different renderer.
//
// What it is: the points are placed where the drawing needs them. They used to be spaced evenly -
// three meant top, middle, bottom - which suits hair and is useless for an arm, where the point
// that matters is wherever the elbow is. Drag along the axis to move a point, across it to set
// how far that part swings, tap the line to add one, and drag a point off the axis to remove it.
//
// An SVG overlay rather than painting into the canvas: the stage is already relative and scaled,
// so a viewBox in canvas coordinates lines up exactly at any zoom, and the handles stay crisp.

/** Where the curve is sampled to draw it. Enough that the smoothstep reads as a curve. */
const CURVE_STEPS = 64;
/** Hit radius of a handle, in canvas units. Generous, because this is used with a pen. */
const GRAB_R = 26;
/** How far past the ends of the axis a point has to be dragged to be dropped. */
const OFF_AXIS = 0.08;
/** A profile needs two points to interpolate between. */
const MIN_POINTS = 2;
const MAX_POINTS = 12;

/**
 * @param {object} props
 * @param {Array<number | {p: number, w: number}>} props.profile
 * @param {'x'|'y'} props.axis which way the points run
 * @param {number} props.amount `swayAmount`, a percentage of the span at full swing
 * @param {number} props.cw
 * @param {number} props.ch
 * @param {(profile: Array<{p: number, w: number}>) => void} props.onChange
 * @param {() => void} props.onClose
 */
export function SwaySpine({ profile, axis, amount, cw, ch, onChange, onClose }) {
    const [dragging, setDragging] = React.useState(/** @type {number|null} */(null));
    const [wouldDrop, setWouldDrop] = React.useState(false);
    const svgRef = React.useRef(/** @type {SVGSVGElement|null} */(null));

    const vertical = axis !== 'x';
    // The span the points run along, and the one they are displaced across. For a vertical axis
    // the points go down the canvas and swing sideways; for a horizontal axis, the mirror.
    const along = vertical ? ch : cw;
    const across = vertical ? cw : ch;
    // Full swing, in pixels. The same number the renderer uses. Showing the extreme rather than
    // the current phase is what makes this editable - the drawing underneath is mid-swing.
    const reach = (amount / 100) * along;

    // Read through the same helper the renderer uses, so what is drawn is what will move.
    const at = swayPointAt(profile);
    const points = profile.map((_, i) => at(i));

    /** Canvas coordinates for a point. */
    const xy = (pt) => {
        const a = pt.p * along;
        const b = across / 2 + pt.w * reach;
        return vertical ? { x: b, y: a } : { x: a, y: b };
    };

    const toCanvas = (e) => {
        const r = svgRef.current.getBoundingClientRect();
        return {
            x: ((e.clientX - r.left) / r.width) * cw,
            y: ((e.clientY - r.top) / r.height) * ch,
        };
    };

    /** A canvas position as {p, w}: how far along the axis, and how far across it. */
    const fromCanvas = (c) => {
        const a = vertical ? c.y : c.x;
        const b = vertical ? c.x : c.y;
        return {
            p: Math.min(1, Math.max(0, a / along)),
            w: reach ? Math.max(-1, Math.min(1, (b - across / 2) / reach)) : 0,
            off: a < -OFF_AXIS * along || a > (1 + OFF_AXIS) * along,
        };
    };

    const commit = (next) => onChange(sortSwayProfile(next));

    const grab = (i) => (e) => {
        e.stopPropagation();
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
        setDragging(i);
    };

    const move = (e) => {
        if (dragging == null) return;
        e.preventDefault();
        const { p, w, off } = fromCanvas(toCanvas(e));
        setWouldDrop(off && points.length > MIN_POINTS);
        onChange(points.map((pt, j) => (j === dragging ? { p, w } : pt)));
    };

    const release = () => {
        if (dragging != null && wouldDrop && points.length > MIN_POINTS) {
            commit(points.filter((_, j) => j !== dragging));
        } else if (dragging != null) {
            commit(points);
        }
        setDragging(null);
        setWouldDrop(false);
    };

    // Tapping the line adds a point there, at whatever the curve already says - so adding one
    // never moves the drawing, it only gives you somewhere to pull from.
    const addAt = (e) => {
        if (points.length >= MAX_POINTS) return;
        const { p } = fromCanvas(toCanvas(e));
        commit([...points, { p, w: swayWeightAt(profile, p) }]);
    };

    // The curve the renderer will follow, sampled through the same function rather than drawn as
    // straight lines between the points - a straight preview of a curved result lies about corners.
    const curve = [];
    for (let s = 0; s <= CURVE_STEPS; s++) {
        const p = s / CURVE_STEPS;
        const { x, y } = xy({ p, w: swayWeightAt(profile, p) });
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
            {/* Where the layer sits at rest, so the swing reads as a departure from something. */}
            <path d={rest} stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeDasharray="6 6" fill="none" />
            {/* A wide invisible band on the rest line: tapping it adds a point there. */}
            <path d={rest} stroke="transparent" strokeWidth={GRAB_R} fill="none"
                style={{ cursor: 'copy' }} onPointerDown={addAt}>
                <title>{tr('선을 눌러 점 추가')}</title>
            </path>
            <path d={curve.join(' ')} stroke="#fde047" strokeWidth={3} fill="none" strokeLinecap="round" />
            {points.map((pt, i) => {
                const { x, y } = xy(pt);
                const held = dragging === i;
                const dropping = held && wouldDrop;
                return (
                    <g key={i}>
                        {/* A target much larger than the dot: a pen is not precise, and a handle
                            that has to be hit exactly is a handle that feels broken. */}
                        <circle cx={x} cy={y} r={GRAB_R} fill="transparent" style={{ cursor: 'grab' }}
                            onPointerDown={grab(i)}>
                            <title>{tr('{0}% 지점 — 끌어서 위치와 흔들림 조절, 축 밖으로 끌면 삭제', Math.round(pt.p * 100))}</title>
                        </circle>
                        <circle cx={x} cy={y} r={held ? 13 : 10}
                            fill={dropping ? '#f87171' : held ? '#fde047' : '#1b1b24'}
                            stroke={dropping ? '#f87171' : '#fde047'} strokeWidth={3} pointerEvents="none" />
                        <text x={x} y={y - 20} textAnchor="middle" fill={dropping ? '#f87171' : '#fde047'}
                            fontSize={20} pointerEvents="none">
                            {dropping ? tr('놓으면 삭제') : Math.round(pt.w * 100)}
                        </text>
                    </g>
                );
            })}
            {/* On the canvas rather than in the panel, because that is where the eyes are. */}
            <foreignObject x={cw - 320} y={10} width={310} height={40}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 13, color: '#fde047', alignSelf: 'center' }}>
                        {tr('선을 눌러 추가 · 축 밖으로 끌어 삭제')}
                    </span>
                    <button className="button" onClick={onClose} style={{ height: 28 }}>{tr('점 편집 끝')}</button>
                </div>
            </foreignObject>
        </svg>
    );
}

export default SwaySpine;
