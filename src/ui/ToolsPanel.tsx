import { Layers, Undo, Redo, Trash, Repeat, ClipboardPaste, Pipette } from 'lucide-react';
import { NumField } from './NumField.tsx';
import { tr } from '../i18n';
import { BRUSH_MIN, BRUSH_MAX } from '../core/brushSize.ts';
import type React from 'react';

/** The per-tool settings block. All of the brush settings arrive; each block reads only its own tool's. */
interface ToolSettingsProps {
    tool: string;
    isSelectionTool: boolean;
    softMode: string; setSoftMode: (m: string) => void;
    rulerMode: string; setRulerMode: (m: string) => void;
    mosaicBlock: number; setMosaicBlock: (n: number) => void;
    toolSize: number; setToolSize: (n: number) => void;
    pressureOn?: boolean; setPressureOn: (on: boolean) => void;
}
/** One entry of the tool grid: its id, its label, and the icon that draws it. */
export interface ToolType { id: string; label: string; Icon: React.ComponentType<{ size?: number }> }
/** The tools panel's props, grouped by what they are about. */
export interface ToolsPanelProps {
    panel: { width: number; onClose: () => void; TOOL_TYPES: readonly ToolType[] };
    tools: { tool: string; handleSetTool: (tool: string) => void; isSelectionTool: boolean; pickingColor: boolean; pickColor: () => void; hasLassoClip: boolean; pasteLassoSelection: () => void };
    /** the brush settings; pressureOn defaults on, and the per-tool rest goes to ToolSettings as it is */
    brush: { color: string; applyColor: (c: string) => void; opacity: number; setOpacity: (v: number) => void } & Omit<ToolSettingsProps, 'tool' | 'isSelectionTool'>;
    edit: { globalUndo: () => void; globalRedo: () => void; handleClearCut: () => void; doTween: () => void };
    onion: { onionPrev: boolean; setOnionPrev: (f: (v: boolean) => boolean) => void; onionNext: boolean; setOnionNext: (f: (v: boolean) => boolean) => void };
}


// TOOLS panel: the tool grid, the colour swatch, and whatever settings the current tool has.
//
// The lower half changes with the tool - the airbrush picks a mode, the shape tool picks which
// shape, mosaic sets a block size, everything else sets a brush size - which is why it is one
// panel rather than several.

const SIZE_PRESETS = [1, 2, 3, 5, 8, 12, 16, 24, 32, 48, 64, 90, 120, 160];

// Tools that have no width. They used to fall through to the brush block, which showed a size
// grid that did nothing under the lasso - a panel that looks like the pen's while the pen is
// not what is selected reads as the wrong tool being active.
const NO_SIZE_HINT: Record<string, () => string> = {
    lasso: () => tr('영역을 둘러 그리세요. 선택되면 위 바에서 이동·크기·회전·기울기·곡률'),
    move: () => tr('선택한 것만 옮깁니다: 텍스트를 찍으면 그 텍스트, 아니면 활성 레이어. Alt로 전체'),
    text: () => tr('탭해서 글을 놓습니다. 있는 글을 탭하면 편집'),
    fill: () => tr('닫힌 영역을 탭해 채웁니다'),
};

/** The settings block under the divider, which is per-tool. */
function ToolSettings({
    tool, isSelectionTool,
    // Each block below reads only the settings of its own tool and leaves the rest alone.
    softMode, setSoftMode,
    rulerMode, setRulerMode,
    mosaicBlock, setMosaicBlock,
    toolSize, setToolSize,
    pressureOn = true, setPressureOn,
}: ToolSettingsProps) {
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
    let head = null;
    if (tool === 'ruler') {
        // Two rows of two rather than one row of four: at four the labels are down to a couple of
        // characters each, and on a tablet the buttons are through the 24px hit target this
        // project holds itself to.
        //
        // Committing an open curve on the way out is setRulerMode's job now, not each button's.
        const shapes = [
            ['line', tr('직선'), tr('정확한 직선'), tr('드래그로 직선')],
            ['curve', tr('곡선'), tr('점을 찍어 만드는 곡선'), tr('탭으로 점 찍기')],
            ['rect', tr('네모'), tr('드래그한 사각형'), tr('드래그로 사각형')],
            ['ellipse', tr('원'), tr('드래그한 타원'), tr('드래그로 원·타원')],
        ];
        // The mode picker, then the brush block below: a shape is drawn with the current brush,
        // so it needs the width the same as a freehand line does.
        head = (<>
            <span className="slider-label">{tr('도형 모드')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, width: '100%' }}>
                {shapes.map(([id, label, title]) => (
                    <button key={id} className={`pal-btn${rulerMode === id ? ' active' : ''}`}
                        onClick={() => setRulerMode(id)} title={title}>{label}</button>
                ))}
            </div>
            <span style={{ fontSize: 9, color: '#888', textAlign: 'center' }}>
                {(shapes.find(s => s[0] === rulerMode) || shapes[0])[3]}
            </span>
        </>);
    }
    if (NO_SIZE_HINT[tool]) {
        return <span style={{ fontSize: 9, color: '#888', textAlign: 'center', padding: '4px 2px' }}>{NO_SIZE_HINT[tool]()}</span>;
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
        {head}
        {/* Liquify is a brush too - the size is its radius - but what it does is not obvious
            from a wave icon, and the opacity slider doubling as its strength even less so. */}
        {tool === 'liquify' && <span style={{ fontSize: 9, color: '#888', textAlign: 'center' }}>{tr('그린 것을 밀어 흘려보냅니다. 불투명도가 세기입니다')}</span>}
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
    panel, tools, brush, edit, onion,
}: ToolsPanelProps) {
    const { width, onClose, TOOL_TYPES } = panel;
    const { tool, handleSetTool, isSelectionTool, pickingColor, pickColor, hasLassoClip, pasteLassoSelection } = tools;
    // pressureOn defaults on; the rest of the brush settings go to the child as they always did.
    const { color, applyColor, opacity, setOpacity, pressureOn = true, setPressureOn, ...settings } = brush;
    const { globalUndo, globalRedo, handleClearCut, doTween } = edit;
    const { onionPrev, setOnionPrev, onionNext, setOnionNext } = onion;
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
