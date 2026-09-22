import { useState } from 'react';
import { moveLayer, moveLayerToEnd, dropPositionFor } from '../core/layerOps.ts';
import type React from 'react';
import type { Id } from '../core/types.ts';
import type { DropPosition } from '../core/layerOps.ts';


/**
 * Dragging a layer row to reorder it, or into a folder.
 *
 * Owns which row is being dragged and where it would land; the moves themselves are
 * core/layerOps. Every handler stops propagation because the rows sit inside a cut row that
 * has drag handling of its own.
 *
 * @param {{updLayers: (cutId: any, fn: (cut: any) => object) => void}} deps
 */
export function useLayerDnD({ updLayers }: { updLayers: (cutId: Id, fn: (cut: Cut) => Partial<Cut>) => void }) {
    const [dragLayerInfo, setDragLayerInfo] = useState<{ cutId: Id, layerId: Id } | null>(null);   // in flight
    const [dropInfo, setDropInfo] = useState<{ layerId: Id, position: DropPosition } | null>(null);   // under the pointer
    const clear = () => { setDragLayerInfo(null); setDropInfo(null); };

    const onLayerDragStart = (e: React.DragEvent, cutId: Id, layerId: Id) => {
        e.stopPropagation();
        setDragLayerInfo({ cutId, layerId });
        e.dataTransfer.effectAllowed = 'move';
    };
    const onLayerDragOver = (e: React.DragEvent<HTMLElement>, targetId: Id, targetType: string | undefined) => {
        e.preventDefault(); e.stopPropagation();
        setDropInfo({ layerId: targetId, position: dropPositionFor(e.clientY, e.currentTarget.getBoundingClientRect(), targetType) });
        e.dataTransfer.dropEffect = 'move';
    };
    const onLayerDrop = (e: React.DragEvent, cutId: Id, targetId: Id) => {
        e.preventDefault(); e.stopPropagation();
        if (!dragLayerInfo || dragLayerInfo.layerId === targetId || dragLayerInfo.cutId !== cutId) { clear(); return; }
        const { layerId } = dragLayerInfo, { position } = dropInfo || { position: 'after' as DropPosition };
        // null means the move was refused (a folder into its own subtree) and nothing changes.
        updLayers(cutId, c => {
            const layers = moveLayer(c.layers, layerId, targetId, position);
            return layers ? { layers } : {};
        });
        clear();
    };
    /** A drop on the list itself, below every row: to the end, at the top level. */
    const onListDrop = (e: React.DragEvent, cutId: Id) => {
        e.preventDefault();
        if (dragLayerInfo && dragLayerInfo.cutId === cutId) {
            const { layerId } = dragLayerInfo;
            updLayers(cutId, c => {
                const layers = moveLayerToEnd(c.layers, layerId);
                return layers ? { layers } : {};
            });
            clear();
        }
    };
    const onLayerDragEnd = () => clear();

    return { dragLayerInfo, dropInfo, onLayerDragStart, onLayerDragOver, onLayerDrop, onListDrop, onLayerDragEnd };
}
