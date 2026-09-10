import React, { useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Eye, EyeOff, Waves, CornerDownRight, ArrowDownToLine, Film, Trash2 } from 'lucide-react';
import { flattenLayersInUiOrder, layerKey, cutProgress } from '../canvas/canvasUtils';
import { canClip } from '../core/clipping.js';
import { setLayerClipped, mergeLayerDown } from '../core/cutsReducer.js';
import { JitterPanel, LayerAnimPanel } from './AnimPanels';
import { tr } from '../i18n';

// One cut's layer tree, in the CUT/LAYER panel.
//
// This was a render function App passed down to CutLayerPanel as a prop, with a comment saying it
// had to stay in App because the drag state lives there. Drag state is a prop like any other;
// what the render prop actually bought was that nobody had to write the row's inputs down. There
// are twenty of them. They arrive as one `rows` object because that is what they are - everything
// a layer row needs, as against everything the panel around it needs - and they are now at least
// named in one place.

/** A layer's contents at thumbnail size. */
function LayerThumbnail({ layer, cutId, layerCanvasCache }) {
    const ref = useRef(/** @type {HTMLCanvasElement|null} */(null));
    const key = layerKey(cutId, layer.id);
    // Read outside the effect so the dependency is a value the linter can check, rather than an
    // expression it has to give up on - which is what hid 'key' and the cache itself from it.
    const layerCanvas = layerCanvasCache[key];
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 56, 31);
        if (layerCanvas) {
            ctx.drawImage(layerCanvas, 0, 0, 56, 31);
        }
    }, [layer, layerCanvas]);
    return <canvas ref={ref} width={56} height={31} style={{ width: 42, height: 23, borderRadius: 3, background: '#fff', flexShrink: 0, border: '1px solid hsl(var(--ui-h) var(--ui-s) 22%)' }} />;
}

/**
 * The rows for one cut, nesting into folders.
 *
 * @param {object} props
 * @param {any} props.cut
 * @param {string|number|null} [props.parentId] whose children to draw; null is the root
 * @param {number} [props.depth] indent level, so a nested call lines its rows up
 * @param {any} props.rows everything a row needs - see the destructure below
 */
export function LayerRows({ cut, parentId = null, depth = 0, rows }) {
    const {
        animLayer, currentTime, dispatchCuts, dragLayerInfo, dropInfo, handleDeleteLayer,
        handleSetActive, handleToggleFolder, handleToggleVisible, jitterLayer, layerCanvasCache,
        onLayerDragEnd, onLayerDragOver, onLayerDragStart, onLayerDrop, pathCapture,
        setAnimLayer, setPathCapture, toggleJitterPanel, updLayerAnim, updLayerProps, updLayers,
    } = rows;
    return cut.layers.filter(l => (l.parentId ?? null) === parentId).map(layer => {
        const isFolder = layer.type === 'folder';
        const isDragging = dragLayerInfo?.layerId === layer.id;
        const dt = dropInfo?.layerId === layer.id ? dropInfo.position : null;
        return (
            <div key={layer.id} style={{ opacity: isDragging ? 0.4 : 1 }}>
                {dt === 'before' && <div className="drop-line" />}
                <div
                    className={`layer-row${!isFolder && cut.activeLayerId === layer.id ? ' layer-active' : ''}${isFolder ? ' layer-folder' : ''}${dt === 'inside' ? ' drop-inside' : ''}`}
                    style={{ paddingLeft: depth * 14 + 6 }}
                    draggable
                    onDragStart={e => onLayerDragStart(e, cut.id, layer.id)}
                    onDragOver={e => onLayerDragOver(e, layer.id, layer.type)}
                    onDrop={e => onLayerDrop(e, cut.id, layer.id)}
                    onDragEnd={onLayerDragEnd}
                    onClick={e => !isFolder && handleSetActive(e, cut.id, layer.id)}
                >
                    {isFolder
                        ? <button className="icon-btn" onClick={e => handleToggleFolder(e, cut.id, layer.id)}>{layer.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</button>
                        : <span style={{ width: 11, flexShrink: 0, display: 'inline-block' }} />}
                    {isFolder
                        ? (layer.collapsed ? <Folder size={13} style={{ color: '#888', marginRight: 4, flexShrink: 0 }} /> : <FolderOpen size={13} style={{ color: '#aaa', marginRight: 4, flexShrink: 0 }} />)
                        : <LayerThumbnail layer={layer} cutId={cut.id} layerCanvasCache={layerCanvasCache} />}
                    <button className="icon-btn" style={{ marginLeft: 4 }} onClick={e => handleToggleVisible(e, cut.id, layer.id)}>
                        {layer.visible ? <Eye size={10} /> : <EyeOff size={10} style={{ color: '#555' }} />}
                    </button>
                    <span className="layer-name">{layer.name}</span>
                    {!isFolder && (
                        <button className="icon-btn" style={{ color: layer.roughen ? '#e0a84e' : undefined }}
                            title={layer.roughen ? tr('자글자글 모션 (강도 {0}) — 클릭: 설정 열기', layer.roughen) : tr('자글자글 모션 설정 (이미 그린 선이 제자리에서 부글거림)')}
                            onClick={e => toggleJitterPanel(e, cut.id, layer.id)}>
                            <Waves size={11} />
                        </button>
                    )}
                    {!isFolder && (() => {
                        // Shown even where it cannot apply, greyed out: hiding it would make
                        // the row's controls shift position as layers are reordered, which is
                        // worse than a disabled button.
                        const clippable = canClip(flattenLayersInUiOrder(cut.layers || []).filter(l => l.type === 'layer'), layer.id);
                        return (
                            <button className="icon-btn" disabled={!clippable && !layer.clipped}
                                style={{ color: layer.clipped ? 'var(--accent-pale)' : undefined, opacity: (clippable || layer.clipped) ? 1 : 0.3 }}
                                title={layer.clipped
                                    ? tr('클리핑 해제 (지금은 아래 레이어가 그려진 곳에만 보입니다)')
                                    : clippable
                                        ? tr('아래 레이어에 클리핑 — 아래 레이어가 그려진 곳에만 보이게 합니다')
                                        : tr('맨 아래 레이어는 클리핑할 대상이 없습니다')}
                                onClick={e => { e.stopPropagation(); dispatchCuts(setLayerClipped(cut.id, layer.id, !layer.clipped)); }}>
                                <CornerDownRight size={11} />
                            </button>
                        );
                    })()}
                    {!isFolder && (
                        <button className="icon-btn" title={tr('아래 레이어와 병합')}
                            onClick={e => { e.stopPropagation(); dispatchCuts(mergeLayerDown(cut.id, layer.id, flattenLayersInUiOrder)); }}>
                            <ArrowDownToLine size={11} />
                        </button>
                    )}
                    {!isFolder && (
                        <button className="icon-btn" style={{ color: layer.anim ? 'var(--accent-soft)' : undefined }} title={tr('파츠 애니메이션')}
                            onClick={e => { e.stopPropagation(); setAnimLayer(a => (a && a.cutId === cut.id && a.layerId === layer.id) ? null : { cutId: cut.id, layerId: layer.id }); }}>
                            <Film size={11} />
                        </button>
                    )}
                    <button className="icon-btn del-btn" onClick={e => handleDeleteLayer(e, cut.id, layer.id)}><Trash2 size={11} /></button>
                </div>
                {!isFolder && jitterLayer && jitterLayer.cutId === cut.id && jitterLayer.layerId === layer.id && (
                    <JitterPanel cut={cut} layer={layer} updLayer={updLayerProps} />
                )}
                {!isFolder && animLayer && animLayer.cutId === cut.id && animLayer.layerId === layer.id && (
                    <LayerAnimPanel cut={cut} layer={layer} updLayerAnim={updLayerAnim} updLayers={updLayers} pathCapture={pathCapture} setPathCapture={setPathCapture}
                        cutProgress={cutProgress(cut, currentTime)} />
                )}
                {dt === 'after' && <div className="drop-line" />}
                {isFolder && !layer.collapsed && <LayerRows cut={cut} parentId={layer.id} depth={depth + 1} rows={rows} />}
            </div>
        );
    });
}

export default LayerRows;
