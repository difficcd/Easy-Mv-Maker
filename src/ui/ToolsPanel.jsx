import React from 'react';
import { Layers, Undo, Redo, Trash, Repeat, ClipboardPaste, Pipette } from 'lucide-react';
import { NumField } from './NumField';
import { tr } from '../i18n';
import { BRUSH_MIN, BRUSH_MAX } from '../core/brushSize.js';

// TOOLS panel: the tool grid, the colour swatch, and whatever settings the current tool has.
//
// The lower half changes with the tool - the airbrush picks a mode, the ruler picks straight or
// curved, mosaic sets a block size, everything else sets a brush size - which is why it is one
// panel rather than several.

const SIZE_PRESETS = [1, 2, 3, 5, 8, 12, 16, 24, 32, 48, 64, 90, 120, 160];

/** The settings block under the divider, which is per-tool. */
function ToolSettings({
    tool, isSelectionTool,
    // Each block below reads only the settings of its own tool, so the rest are absent by design.
    softMode = undefined, setSoftMode = undefined,
    rulerMode = undefined, setRulerMode = undefined, commitCurve = undefined,
    mosaicBlock = undefined, setMosaicBlock = undefined,
    toolSize = undefined, setToolSize = undefined,
    pressureOn = true, setPressureOn = undefined,
}) {
    if (tool === 'soft') {
        return (<>
            <span className="slider-label">{tr('에어 모드')}</span>
            <div style={{ display: 'flex', gap: 3, width: '100%' }}>
                <button className={`pal-btn${softMode === 'soft' ? ' active' : ''}`} onClick={() => setSoftMode('soft')} title={tr('부드럽게 뿌리는 에어브러시')}>{tr('에어')}</button>
                <button className={`pal-btn${softMode === 'blur' ? ' active' : ''}`} onClick={() => setSoftMode('blur')} title={tr('이미 그린 것을 문질러 퍼뜨림')}>{tr('블러')}</button>
            </div>
            <span style={{ fontSize: 9, color: '#888', textAlign: 'center' }}>{softMode === 'soft' ? tr('색을 뿌립니다') : tr('그려진 걸 퍼뜨립니다')}</span>
        </>);
    }
    if (tool === 'ruler') {
        return (<>
            <span className="slider-label">{tr('자 모드')}</span>
            <div style={{ display: 'flex', gap: 3, width: '100%' }}>
                <button className={`pal-btn${rulerMode === 'line' ? ' active' : ''}`} onClick={() => setRulerMode('line')} title={tr('정확한 직선')}>{tr('직선')}</button>
                {/* Leaving curve mode with anchors still placed would strand them, so commit first. */}
                <button className={`pal-btn${rulerMode === 'curve' ? ' active' : ''}`} onClick={() => { commitCurve(); setRulerMode('curve'); }} title={tr('점을 찍어 만드는 곡선')}>{tr('곡선')}</button>
            </div>
            <span style={{ fontSize: 9, color: '#888', textAlign: 'center' }}>{rulerMode === 'line' ? tr('드래그로 직선') : tr('탭으로 점 찍기')}</span>
        </>);
    }
    if (tool === 'mosaic') {
        return (<>
            <span className="slider-label">{tr('모자이크')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                <NumField value={mosaicBlock} onChange={setMosaicBlock} min={2} max={120} width={46} style={{ textAlign: 'center' }} />
                <span style={{ fontSize: 10, color: '#888' }}>px</span>
            </div>
            <input type="range" min="2" max="80" value={Math.min(80, mosaicBlock)} onChange={e => setMosaicBlock(+e.target.value)} className="v-slider" />
            <span style={{ fontSize: 9, color: '#888', textAlign: 'center' }}>{tr('화면 위를 드래그')}</span>
        </>);
    }
    // Everything else is a brush of some width. Which size belongs to which tool is App's
    // question - it owns both pieces of state - and it was being answered here as well, with a
    // second copy of the range to go with it.
    const curSize = toolSize, setSize = setToolSize;
    return (<>
        <span className="slider-label">{tool === 'eraser' ? tr('지우개') : 'Size'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
            <NumField value={curSize} onChange={setSize} min={BRUSH_MIN} max={BRUSH_MAX} width={46} style={{ textAlign: 'center' }} />
            <span style={{ fontSize: 10, color: '#888' }}>px</span>
        </div>
        <div className="size-grid" style={{ margin: '4px 0' }}>
            {SIZE_PRESETS.map(s => (
                <button key={s} className={`size-cell${curSize === s ? ' active' : ''}`} onClick={() => setSize(s)} disabled={isSelectionTool} title={`${s}px`}>
                    {/* The dot previews the width, but a 160px one would not fit the cell. */}
                    <span style={{ width: Math.max(2, Math.min(16, s)), height: Math.max(2, Math.min(16, s)), maxWidth: '80%', maxHeight: '80%', borderRadius: '50%', background: '#ddd', display: 'block' }} />
                </button>
            ))}
        </div>
        <input type="range" min="1" max="80" value={Math.min(80, curSize)} onChange={e => setSize(+e.target.value)} className="v-slider" disabled={isSelectionTool} />
        {/* The eraser is included: its width goes through the same pressure term as a brush
            (canvasUtils, `s.size * (hasPressure ? pr * 2 : 1)`), so an even eraser is exactly as
            useful as an even line. */}
        <label className="te-check" style={{ justifyContent: 'center', marginTop: 2 }}
            title={tr('끄면 세게 눌러도 굵기가 일정합니다. 이미 그린 선은 그대로입니다.')}>
            <input type="checkbox" checked={!!pressureOn} onChange={e => setPressureOn(e.target.checked)} /> {tr('필압')}
        </label>
    </>);
}

export function ToolsPanel({
    width, onClose, TOOL_TYPES, tool, handleSetTool,
    onionPrev, setOnionPrev, onionNext, setOnionNext,
    globalUndo, globalRedo, handleClearCut, doTween,
    hasLassoClip, pasteLassoSelection, pickingColor, pickColor, isSelectionTool,
    color, applyColor, opacity, setOpacity,
    pressureOn = true, setPressureOn = undefined,
    ...settings
}) {
    return (
        <div className="toolbar" style={{ width, flexShrink: 0 }}>
            <div className="panel-head">
                <span className="panel-title">TOOLS</span>
                <button className="icon-btn" onClick={onClose} title={tr('도구 창 닫기')}>✕</button>
            </div>
            <div className="tool-grid">
                {TOOL_TYPES.map(pt => (
                    <button key={pt.id} className={`tool-btn${tool === pt.id ? ' active' : ''}`} onClick={() => handleSetTool(pt.id)} title={tr(pt.label)}>
                        <pt.Icon size={15} />
                        <span className="tool-label">{tr(pt.label)}</span>
                    </button>
                ))}
                <button className={`tool-btn${onionPrev ? ' onion-prev-active' : ''}`} onClick={() => setOnionPrev(v => !v)} title={tr('이전 프레임 표시 (연보라)')}><Layers size={15} /><span className="tool-label">◀Onion</span></button>
                <button className={`tool-btn${onionNext ? ' onion-next-active' : ''}`} onClick={() => setOnionNext(v => !v)} title={tr('다음 프레임 표시 (원본색)')}><Layers size={15} /><span className="tool-label">Onion▶</span></button>
                <button className="tool-btn" onClick={globalUndo} title="Undo"><Undo size={15} /><span className="tool-label">Undo</span></button>
                <button className="tool-btn" onClick={globalRedo} title="Redo"><Redo size={15} /><span className="tool-label">Redo</span></button>
                <button className="tool-btn" onClick={handleClearCut} title={tr('현재 컷 전체 비우기')}><Trash size={15} /><span className="tool-label">{tr('비우기')}</span></button>
                <button className="tool-btn" onClick={doTween} title={tr('현재 컷과 다음 컷 사이를 자동 중간 프레임으로 채웁니다 (형태 모핑)')}><Repeat size={15} /><span className="tool-label">{tr('트위닝')}</span></button>
                {hasLassoClip && <button className="tool-btn" onClick={pasteLassoSelection} title={tr('복사한 올가미 선택을 현재 레이어에 붙여넣기')}><ClipboardPaste size={15} /><span className="tool-label">{tr('올가미↓')}</span></button>}
                <button className={`tool-btn${pickingColor ? ' active' : ''}`} onClick={pickColor} title={tr('스포이드 (화면에서 색 추출)')} disabled={isSelectionTool}><Pipette size={15} /><span className="tool-label">{tr('스포이드')}</span></button>
            </div>
            <div className="tool-divider" />
            <input type="color" className="color-picker" value={color} onChange={e => applyColor(e.target.value)} title={tr('색상')} disabled={isSelectionTool} />
            <div className="slider-wrap">
                <ToolSettings tool={tool} isSelectionTool={isSelectionTool} pressureOn={pressureOn} setPressureOn={setPressureOn} {...settings} />
            </div>
            <div className="slider-wrap">
                <span className="slider-label">Opacity</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                    <NumField value={Math.round(opacity * 100)} onChange={v => setOpacity(Math.max(0, Math.min(100, Math.round(v))) / 100)}
                        min={0} max={100} width={46} style={{ textAlign: 'center' }} />
                    <span style={{ fontSize: 10, color: '#888' }}>%</span>
                </div>
                <input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={e => setOpacity(+e.target.value / 100)} className="v-slider" disabled={isSelectionTool} />
            </div>
        </div>
    );
}
