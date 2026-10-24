import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../i18n.ts';

/**
 * The music track's volume: a percentage on the track header that opens a slider.
 *
 * The header is 60px wide, so the slider lives in a popover - drawn into the body with a fixed
 * position, because the timeline scrolls and clips its overflow. Unlike the mute button beside it,
 * the volume is part of the project: it is saved, and the exported video carries it.
 */
export function VolumeControl({ volume, setVolume }: { volume: number, setVolume: (v: number) => void }) {
    const [at, setAt] = useState<{ x: number, y: number } | null>(null);
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);
    const pct = Math.round(volume * 100);

    useEffect(() => {
        if (!at) return;
        const away = (e: PointerEvent) => {
            if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
            setAt(null);
        };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAt(null); } };
        window.addEventListener('pointerdown', away, true);
        window.addEventListener('keydown', esc, true);
        return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); };
    }, [at]);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (at) { setAt(null); return; }
        const r = btnRef.current!.getBoundingClientRect();
        // Above the button, kept inside the window.
        setAt({ x: Math.max(8, Math.min(window.innerWidth - 208, r.left)), y: Math.max(8, r.top - 72) });
    };

    return (<>
        <button ref={btnRef} className="vol-btn" onClick={toggle} onPointerDown={e => e.stopPropagation()}
            title={tr('음원 볼륨 — 저장되고 내보내기에도 들어갑니다')}>{pct}%</button>
        {at && createPortal(
            // Events from a portal still bubble through the React tree - to the audio clip this
            // sits on, whose drag handler would capture the pointer and swallow the click.
            <div ref={popRef} className="vol-pop" style={{ left: at.x, top: at.y }}
                onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                <div className="vol-pop-head">
                    <span>{tr('음원 볼륨')}</span>
                    <span className="vol-pop-val">{pct}%</span>
                </div>
                <input type="range" min={0} max={100} value={pct} className="vol-range"
                    onChange={e => setVolume(+e.target.value / 100)} />
                <div className="vol-pop-presets">
                    {[0, 50, 100].map(v => <button key={v} className={pct === v ? 'active' : ''} onClick={() => setVolume(v / 100)}>{v}%</button>)}
                </div>
            </div>,
            document.body,
        )}
    </>);
}
