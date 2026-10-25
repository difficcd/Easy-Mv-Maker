import { CopyPlus, Unlink } from 'lucide-react';
import { tr } from '../i18n.ts';
import { NumField } from './NumField.tsx';
import type { ClipRef } from '../core/clipInstance.ts';

/** What the panel does with a copy; App's, since the copy is a cut in its document. */
export interface ClipOps {
    /** the name of the part a copy shows */
    partName: (partId: PartId) => string;
    addAnotherClipCopy: (cutId: DocId) => void;
    setClipPlacement: (cutId: DocId, patch: Partial<ClipRef>) => void;
    unpackClip: (cutId: DocId) => void;
}

/**
 * Where a layer list would be, for a copy of an animation clip (core/clipInstance): it has no
 * layers of its own. Its placement is set here - offset, size, loop - and its motion where any
 * cut's is, in the cut settings (fade, slide, move). The drawing is the part's: drawn there, it
 * changes in every copy.
 */
export function ClipCopyPanel({ cut, ops }: { cut: Cut, ops: ClipOps }) {
    const ref = cut.clip!;
    const set = (patch: Partial<ClipRef>) => ops.setClipPlacement(cut.id, patch);
    return (
        <div className="clip-copy" onClick={e => e.stopPropagation()}>
            <div className="clip-copy-head">
                <span className="clip-copy-badge">{tr('클립 복사본')}</span>
                <span className="clip-copy-src" title={tr('원본 파트')}>{ops.partName(ref.partId)}</span>
            </div>
            <div className="clip-copy-grid">
                <label>X<NumField value={Math.round(ref.dx)} onChange={v => set({ dx: v })} width={58} /></label>
                <label>Y<NumField value={Math.round(ref.dy)} onChange={v => set({ dy: v })} width={58} /></label>
                <label>{tr('크기')}<NumField value={Math.round(ref.scale * 100)} onChange={v => set({ scale: Math.max(5, v) / 100 })} min={5} max={500} width={58} /><span className="clip-copy-unit">%</span></label>
            </div>
            <div className="clip-copy-loop">
                <button className={ref.loop ? 'active' : ''} onClick={() => set({ loop: true })}>{tr('반복 재생')}</button>
                <button className={!ref.loop ? 'active' : ''} onClick={() => set({ loop: false })}>{tr('한 번만')}</button>
            </div>
            <div className="clip-copy-hint">{tr('움직임은 컷 설정(⚙)의 애니메이션에서 정합니다. 그림을 고치려면 원본 파트의 컷에 그리세요 — 모든 복사본에 반영됩니다.')}</div>
            <div className="clip-copy-actions">
                <button className="small-btn" onClick={() => ops.addAnotherClipCopy(cut.id)}><CopyPlus size={12} /> {tr('복사본 하나 더')}</button>
                <button className="small-btn" onClick={() => ops.unpackClip(cut.id)} title={tr('일반 컷으로 바꿔 따로 고칠 수 있게 합니다')}><Unlink size={12} /> {tr('풀기')}</button>
            </div>
        </div>
    );
}
