import React from 'react';
import { swayWeightAt, swayPointAt, sortSwayProfile } from '../canvas/canvasUtils';
import { tr } from '../i18n';

// Placing the points a sway bends around, on the drawing.
//
// The profile decides how far each part of a layer moves: hair swings from its roots, a ribbon
// trails from where it is held. The renderer has been right for a while - it slices the layer
// along an axis and shears each slice, so the displacement varies continuously and leaves no seam.
//
// Points go anywhere on the canvas. The axis stays as the frame of reference, because the renderer
// is built on it, but nothing has to be tapped exactly: a point dropped beside the character reads
// its place in the profile from where it landed along the axis, and its swing from how far off the
// resting line it is. Tap to add, drag to adjust, drag off the axis to remove.
//
// What this still is not: a rigging tool. There are no joints and no rotation, and two points at
// the same height along the axis are one point as far as the renderer is concerned - the profile
// is a function of position along the axis, not a chain in two dimensions. Bones would be a
// different deformation model and a different renderer.
//
// The reach band is drawn for that reason. A tap further out than the sway can throw clamps to the
// edge of what is possible, and a dot landing somewhere other than the finger is confusing unless
// the limit was visible before the tap.
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
/** Two points closer than this along the axis are one point as far as the renderer is concerned. */
const TOO_CLOSE = 0.02;

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

    /** Keep a press inside the toolbar from reaching the canvas handler behind it. */
    const swallow = (e) => e.stopPropagation();

    // Escape leaves. A second way out matters more here than usual: every tap on the canvas does
    // something, so an editor that will not close is an editor that keeps changing the drawing.
    React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

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

    // Tap anywhere to add a point there. Where it lands along the axis is its place in the profile;
    // how far it lands from the resting line is how far that part swings. So dropping a point out
    // beside the character's hand says "the hand goes that way", in one gesture.
    //
    // A tap on an existing point is a grab, not an add - that handler runs first and stops this one
    // - and a tap at the same height as one is refused rather than making a second point the
    // renderer cannot tell apart from the first.
    const full = points.length >= MAX_POINTS;

    const addAt = (e) => {
        if (full) return;   // the toolbar says why; silently ignoring a tap reads as a dead app
        const { p, w } = fromCanvas(toCanvas(e));
        if (points.some(pt => Math.abs(pt.p - p) < TOO_CLOSE)) return;
        commit([...points, { p, w }]);
    };

    // The curve the renderer will follow, sampled through the same function rather than drawn as
    // straight lines between the points - a straight preview of a curved result lies about corners.
    const curve = [];
    for (let s = 0; s <= CURVE_STEPS; s++) {
        const p = s / CURVE_STEPS;
        const { x, y } = xy({ p, w: swayWeightAt(profile, p) });
        curve.push(`${s ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    /** A line parallel to the axis, `offset` px across from the resting one. */
    const line = (offset) => (vertical
        ? `M${across / 2 + offset} 0 L${across / 2 + offset} ${along}`
        : `M0 ${across / 2 + offset} L${along} ${across / 2 + offset}`);

    return (
        <svg
            ref={svgRef}
            className="sway-spine"
            viewBox={`0 0 ${cw} ${ch}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', zIndex: 6, cursor: 'copy' }}
            onPointerDown={addAt}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
        >
            {/* How far the sway can actually throw a point. Drawn because a tap outside it clamps,
                and a dot landing somewhere other than the finger has to have been predictable. */}
            {reach > 0 && (
                <g stroke="rgba(253,224,71,0.22)" strokeWidth={2} fill="none">
                    <path d={line(reach)} />
                    <path d={line(-reach)} />
                </g>
            )}
            {/* Where the layer sits at rest, so the swing reads as a departure from something. */}
            <path d={line(0)} stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeDasharray="6 6" fill="none" />
            <path d={curve.join(' ')} stroke="#fde047" strokeWidth={3} fill="none" strokeLinecap="round" />
            {points.map((pt, i) => {
                const { x, y } = xy(pt);
                const held = dragging === i;
                const dropping = held && wouldDrop;
                // A tie back to the resting line, so a point far out still reads as "this height,
                // thrown this far" rather than as a dot floating on its own.
                const tie = vertical ? { x: across / 2, y } : { x, y: across / 2 };
                return (
                    <g key={i}>
                        <line x1={tie.x} y1={tie.y} x2={x} y2={y}
                            stroke="rgba(253,224,71,0.45)" strokeWidth={2} strokeDasharray="4 4" pointerEvents="none" />
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
            {/* The toolbar swallows pointer events. Without that, pressing the close button also
                reaches the svg's own handler, which adds a point and re-renders - and the button
                the press started on is gone before the click can land, so the editor cannot be
                left at all. Reported as "점찍다가 exit 못하는경우". */}
            <foreignObject x={cw - 380} y={10} width={370} height={44}
                onPointerDown={swallow} onPointerUp={swallow} onPointerMove={swallow}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: (full || !reach) ? '#f87171' : '#fde047' }}>
                        {/* At zero strength every point sits on the resting line and dragging one
                            changes nothing, which looks like a broken editor rather than a
                            setting. Say which it is. */}
                        {!reach ? tr('흔들림 강도가 0이라 점을 움직여도 변화가 없습니다')
                            : full ? tr('점은 {0}개까지입니다', MAX_POINTS)
                                : tr('아무 곳이나 눌러 점 추가 · 축 밖으로 끌어 삭제')}
                    </span>
                    <button className="button" onClick={onClose} style={{ height: 30, padding: '0 12px' }}>
                        {tr('점 편집 끝')}
                    </button>
                </div>
            </foreignObject>
        </svg>
    );
}

export default SwaySpine;
