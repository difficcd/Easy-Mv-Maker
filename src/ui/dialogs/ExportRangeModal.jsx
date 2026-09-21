import React from 'react';
import { tr } from '../../i18n';
import { Modal } from '../Modal.jsx';
import { fmt, parseClock } from '../../core/timeCode.ts';

/**
 * Start and end for an export, before anything is recorded.
 *
 * "Let me set the start and the end outright." The defaults are what the export would have done
 * on its own - the first cut to the end of the content - except that a playhead parked inside
 * the film is taken as the start, since moving it there and pressing Export is how someone says
 * "from here".
 *
 * @param {object} p
 * @param {number} p.first where the first cut starts
 * @param {number} p.end where the content ends
 * @param {number} p.playhead the playhead now
 * @param {boolean} p.transparentBg decides video versus GIF / PNG sequence, like the export itself
 * @param {string} p.format the transparent format, for the label only
 * @param {(from: number, to: number) => void} p.onExport
 * @param {() => void} p.onClose
 */
export function ExportRangeModal({ first, end, playhead, transparentBg, format, onExport, onClose }) {
    const fromHere = playhead > first && playhead < end;
    const [from, setFrom] = React.useState(fmt(fromHere ? playhead : first));
    const [to, setTo] = React.useState(fmt(end));
    const a = parseClock(from), b = parseClock(to);
    const ok = b > a;
    const what = transparentBg ? (format === 'gif' ? 'GIF' : tr('PNG 시퀀스')) : tr('영상');
    const Field = ({ label, value, set, presets }) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ width: 34 }}>{label}</span>
            <input className="time-input" style={{ width: 96 }} value={value} onChange={e => set(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && ok) onExport(a, b); }} />
            {presets.map(([l, v]) => <button key={l} className="small-btn" onClick={() => set(fmt(v))}>{l}</button>)}
        </div>
    );
    return (
        <Modal title={tr('내보내기 범위')} onClose={onClose} width={400} z={1200} panelStyle={{ color: '#ccc', fontSize: 12.5 }}>
            <Field label={tr('시작')} value={from} set={setFrom} presets={[[tr('첫 컷'), first], [tr('재생바'), playhead]]} />
            <Field label={tr('끝')} value={to} set={setTo} presets={[[tr('끝까지'), end]]} />
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                {tr('{0}로 {1} 동안 내보냅니다. 형식은 타임라인의 캔버스 배경이 정합니다.', what, fmt(Math.max(0, b - a)))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
                <button className="button" onClick={onClose}>{tr('취소')}</button>
                <button className="button button-primary" style={{ background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }}
                    disabled={!ok} onClick={() => onExport(a, b)}>{tr('내보내기')}</button>
            </div>
        </Modal>
    );
}
