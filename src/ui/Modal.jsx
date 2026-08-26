import React from 'react';
import { X } from 'lucide-react';

// The shell every dialog in the app sits in.
//
// It was written out by hand seven times: a fixed backdrop, a panel that stops the click from
// reaching the backdrop, and a header row with a title and a close button. Seven copies drifted -
// three different border colours, two different close glyphs - and none of them closed on Escape,
// because adding that is seven edits and nobody made all seven.
//
// Escape is why this is a component rather than a style guide. A dialog that traps you until you
// find the small x is the kind of thing that is only ever fixed everywhere at once.

/**
 * @param {object} props
 * @param {React.ReactNode} [props.title] header text; omit for a dialog with no header
 * @param {() => void} props.onClose
 * @param {number} props.width panel width in px
 * @param {string} [props.maxHeight] set when the content can outgrow the screen
 * @param {number} [props.z] stacking order, for a dialog opened from another one
 * @param {string} [props.className]
 * @param {boolean} [props.closable] false while something is running that must not be interrupted
 * @param {boolean} [props.closeOnEscape] false when the dialog uses Escape for its own purpose
 * @param {React.CSSProperties} [props.panelStyle] extra panel styling
 * @param {React.ReactNode} props.children
 */
export function Modal({
    title, onClose, width, maxHeight, z = 1000, className,
    closable = true, closeOnEscape = true, panelStyle, children,
}) {
    React.useEffect(() => {
        if (!closable || !closeOnEscape) return;
        const h = (e) => {
            if (e.key !== 'Escape') return;
            // Stop here rather than letting it reach the canvas, where Escape clears the
            // selection - closing a dialog should not also undo what was selected behind it.
            e.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', h, true);
        return () => window.removeEventListener('keydown', h, true);
    }, [closable, closeOnEscape, onClose]);

    return (
        <div onClick={() => { if (closable) onClose(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: z, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className={className} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
                style={{
                    width, maxHeight, overflow: maxHeight ? 'auto' : undefined,
                    background: 'hsl(var(--ui-h) var(--ui-s) 15%)',
                    border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)',
                    borderRadius: 8, padding: 18, ...panelStyle,
                }}>
                {title != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span className="panel-title">{title}</span>
                        {closable && <button className="icon-btn" onClick={onClose} aria-label="close"><X size={14} /></button>}
                    </div>
                )}
                {children}
            </div>
        </div>
    );
}
