import { RotateCcw } from 'lucide-react';
import { tr } from '../i18n';
import { SwaySpine } from './SwaySpine';

// The drawing surface: the scrolling area, the zoomed stage inside it, and the two canvases.
//
// Two canvases, one on top of the other, and the reason is worth keeping here. The lower one is
// the document as committed. The upper one is the stroke being drawn right now, the lasso
// marquee, the selection handles - everything that changes on every pointer move. Drawing those
// onto the document canvas would mean repainting the whole scene at pointer rate, which is the
// difference between a pen that keeps up and one that does not.

/**
 * @param {object} p
 * @param {any} p.canvasAreaRef the scrolling area, measured when the view is fitted or panned
 * @param {any} p.canvasRef the document canvas
 * @param {any} p.liveCanvasRef the overlay the current gesture is drawn on
 * @param {number} p.cw
 * @param {number} p.ch
 * @param {boolean} p.transparentBg draws the checkerboard behind the stage
 * @param {{zoom: number, x: number, y: number}} p.view the pan and zoom over the stage
 * @param {() => void} p.resetView
 * @param {{spaceDown: boolean, onAreaPointerDown: (e: any) => void, onAreaPointerMove: (e: any) => void,
 *   onAreaPointerUp: (e: any) => void}} p.gesture
 *   the area's pointer handlers, and whether space is held for panning
 * @param {{startDraw: (e: any) => void, onDraw: (e: any) => void, stopDraw: (e: any) => void,
 *   onPointerLeaveCanvas: (e: any) => void}} p.draw the canvas's own pointer handlers
 * @param {string} p.cursor from canvasCursor, below
 * @param {{layer: any, onChange: (profile: {p: number, w: number}[]) => void,
 *   onClose: () => void}} p.spine
 *   the sway-profile editor, open over the stage while a layer is being shaped
 */
export function CanvasStage({
    canvasAreaRef, canvasRef, liveCanvasRef,
    cw, ch, transparentBg, view, resetView,
    gesture, draw, cursor, spine,
}) {
    const { spaceDown, onAreaPointerDown, onAreaPointerMove, onAreaPointerUp } = gesture;
    const zoomed = view.zoom !== 1 || view.x !== 0 || view.y !== 0;
    return (
        // Scrolling is locked here while panning with space. Left open, space and drag scroll
        // the page down instead of moving the canvas.
        <div className="canvas-area" ref={canvasAreaRef}
            style={{ touchAction: 'none', position: 'relative', cursor: spaceDown ? 'grab' : undefined, overflow: spaceDown ? 'hidden' : 'auto' }}
            onMouseDown={e => { if (e.button === 1) e.preventDefault(); }} /* suppress middle-click auto-scroll */
            onAuxClick={e => { if (e.button === 1) e.preventDefault(); }}
            onPointerDown={onAreaPointerDown} onPointerMove={onAreaPointerMove}
            onPointerUp={onAreaPointerUp} onPointerCancel={onAreaPointerUp}>
            {zoomed && (
                <button className="button" onClick={resetView} title={tr('줌 초기화')}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, height: 28, padding: '0 10px' }}>
                    {Math.round(view.zoom * 100)}% <RotateCcw size={11} />
                </button>
            )}
            <div className={`canvas-stage${transparentBg ? ' checkered' : ''}`}
                style={{ position: 'relative', transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, aspectRatio: `${cw} / ${ch}`, maxWidth: '100%', maxHeight: '100%' }}>
                {/* tabIndex -1: focusable from code, never a stop in the tab order. The canvas is
                    where the keys are meant to land, but nobody tabs to a drawing surface. */}
                <canvas ref={canvasRef} width={cw} height={ch} tabIndex={-1}
                    onPointerDown={draw.startDraw} onPointerMove={draw.onDraw} onPointerUp={draw.stopDraw}
                    onPointerCancel={draw.stopDraw} onPointerLeave={draw.onPointerLeaveCanvas}
                    style={{ cursor, touchAction: 'none' }} />
                {/* The live overlay must be transparent. Inheriting the global
                    `canvas { background:#fff }` rule paints white over the main canvas, hiding
                    the drawing and making committed strokes look as if they vanished. */}
                <canvas ref={liveCanvasRef} width={cw} height={ch}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', background: 'transparent', boxShadow: 'none' }} />

                {spine.layer && (
                    <SwaySpine
                        profile={spine.layer.anim.swayProfile} axis={spine.layer.anim.swayAxis === 'x' ? 'x' : 'y'}
                        amount={spine.layer.anim.swayAmount || 0} cw={cw} ch={ch}
                        onChange={spine.onChange} onClose={spine.onClose} />
                )}
            </div>
        </div>
    );
}

/**
 * What the pointer looks like over the canvas.
 *
 * `${handle}-resize` is the eight-way set - nw-resize, n-resize and so on - so the arrow points
 * the way that edge will travel. `selection &&` is checked first, so a handle the pointer was
 * over when the selection was committed cannot leave a resize arrow behind on a canvas that has
 * nothing left to resize.
 *
 * @param {{spaceDown: boolean, selection: any, hoverHandle: string|null, tool: string}} s
 * @returns {string}
 */
export function canvasCursor({ spaceDown, selection, hoverHandle, tool }) {
    if (spaceDown) return 'grab';
    if (selection) {
        // There is no rotate cursor in CSS, so the knob takes the grab hand - which at least
        // does not claim it moves the selection, which is what it said before.
        if (hoverHandle === 'rotate') return 'grab';
        return hoverHandle ? `${hoverHandle}-resize` : 'move';
    }
    return tool === 'fill' ? 'cell' : 'crosshair';
}
