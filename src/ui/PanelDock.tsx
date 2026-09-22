import { Menu, Palette, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { tr } from '../i18n.ts';
import type React from 'react';
import type { Point } from '../core/types.ts';
import type { Dock, PanelDrag } from '../hooks/usePanelLayout.ts';

/** Begin resizing a docked panel: which one, which edge, and where the pointer went down. */
type StartPanelResize = (id: string, side: 'left' | 'right', clientX: number) => void;


// Where a panel is.
//
// The same three panels - tools, colour, cut/layer - are mounted in the left dock, the right
// dock, or a floating window, and the markup for each is built once in App and handed here as
// `panelEls`. Nothing in this file knows what a panel contains; it only knows where it goes,
// which is why a panel can be dragged from one place to another without being rebuilt.
//
// hooks/usePanelLayout owns the state behind all of this: which dock each panel is in, how wide
// it is, where a floating one sits, and what is being dragged.

/** A docked panel keeps a splitter on the side that faces the canvas. */
const splitter = (id: string, side: 'left' | 'right', startPanelResize: StartPanelResize) => (
    <div key={id + '-sp'} className="splitter-v" style={{ touchAction: 'none' }}
        title={tr('드래그로 패널 너비 조절')}
        onPointerDown={e => {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
            startPanelResize(id, side, e.clientX);
        }} />
);

/** Far-left icon rail for switching panels, Clip Studio style: tools on top, colour below. */
export function DockRail({ showLeft, setShowLeft, leftDock, setLeftDock }: { showLeft: boolean, setShowLeft: (f: (v: boolean) => boolean) => void, leftDock: string | null, setLeftDock: (f: (v: string | null) => string | null) => void }) {
    return (
        <div className="dock-rail">
            <button className={`dock-icon${showLeft ? ' active' : ''}`} title={tr('도구 창 (펜 · 지우개 · 스포이드 등)')}
                onClick={() => setShowLeft(v => !v)}><Menu size={20} /></button>
            <button className={`dock-icon${leftDock === 'color' ? ' active' : ''}`} title={tr('색상 창 (COLOR)')}
                onClick={() => setLeftDock(v => v === 'color' ? null : 'color')}><Palette size={20} /></button>
        </div>
    );
}

/** The panels docked to one side, each with its splitter facing the canvas. */
export function DockSlot({ side, panelIds, docks, panelOpen, panelEls, startPanelResize }: { side: 'left' | 'right', panelIds: readonly string[], docks: Record<string, Dock>, panelOpen: Record<string, boolean>, panelEls: Record<string, React.ReactNode>, startPanelResize: StartPanelResize }) {
    return panelIds.filter(id => docks[id] === side && panelOpen[id]).map(id => (
        <Fragment key={id}>
            {side === 'right' && splitter(id, side, startPanelResize)}
            {panelEls[id]}
            {side === 'left' && splitter(id, side, startPanelResize)}
        </Fragment>
    ));
}

/** Panels pulled out of the docks, drawn above everything and positioned by their own state. */
export function FloatingPanels({ panelIds, docks, panelOpen, panelEls, floatPos, panelDrag, onDockPointerDown }: { panelIds: readonly string[], docks: Record<string, Dock>, panelOpen: Record<string, boolean>, panelEls: Record<string, React.ReactNode>, floatPos: Record<string, Point>, panelDrag: PanelDrag | null, onDockPointerDown: (e: React.PointerEvent) => void }) {
    return panelIds.filter(id => docks[id] === 'float' && panelOpen[id]).map(id => {
        // A window being dragged follows the pointer live; the stored position only updates on drop.
        const live = panelDrag?.id === id;
        const x = live ? panelDrag.x - panelDrag.dx : (floatPos[id]?.x ?? 120);
        const y = live ? panelDrag.y - panelDrag.dy : (floatPos[id]?.y ?? 120);
        return (
            // These sit outside main-content, so they need the header-drag handler of their own.
            <div key={id} className="float-panel" onPointerDown={onDockPointerDown}
                style={{ left: Math.max(0, x), top: Math.max(0, y), opacity: live ? 0.85 : 1 }}>
                {panelEls[id]}
            </div>
        );
    });
}

/** While a header is being dragged, show where it would land. */
export function DockHint({ panelDrag }: { panelDrag: PanelDrag | null }) {
    if (!panelDrag || panelDrag.zone === 'float') return null;
    return <div className="dock-hint" style={{ [panelDrag.zone]: 0 }} />;
}

/** The sliver that brings the right dock back after it has been closed. */
export function ReopenRight({ setShowRight }: { setShowRight: (on: boolean) => void }) {
    return (
        <button onClick={() => setShowRight(true)} className="icon-btn"
            style={{ width: 24, alignSelf: 'stretch', padding: 0, borderRadius: 0, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: 'none', borderLeft: '1px solid #333' }}>
            <ChevronRight size={14} />
        </button>
    );
}
