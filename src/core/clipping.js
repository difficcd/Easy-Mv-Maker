// Clipping: a layer that only shows where the layer beneath it has paint.
//
// The everyday use is shading. Draw the flat colours on one layer, clip a shadow layer to it, and
// the shadow cannot escape the shape no matter how carelessly it is brushed. Every drawing app
// has this and it is the main reason to have layers at all.
//
// Two rules decide what clips to what, and both come from how people actually stack them:
//
//   - a run of clipped layers all attach to the same base, the first unclipped layer below them,
//     so shadow + highlight + line-tint over one set of flats behaves as one group
//   - a clipped layer with nothing below it draws normally
//
// That second rule is a choice. Clipping to nothing is, strictly, clipping to an empty shape,
// which would make the layer vanish - and a layer that disappears when it reaches the bottom of
// the stack looks like a bug, not like a rule. Drawing it is the answer that can be understood
// without reading this file.
//
// The grouping is here, on its own, because the compositing it feeds is the part of the renderer
// where per-layer animation, sway and masking already interleave. Working out *what* clips to
// *what* should not have to happen in there.

/**
 * Split layers into the groups the renderer composites.
 *
 * @param {{id: any, clipped?: boolean}[]} order layers in UI order, topmost first - the same order
 *   flattenLayersInUiOrder produces
 * @returns {{base: any, clipped: any[]}[]} groups in UI order, topmost first. `clipped` is in UI
 *   order too, so a caller drawing bottom-to-top walks it backwards, exactly as it does `order`.
 */
export function clipGroups(order) {
    const groups = [];
    const list = Array.isArray(order) ? order : [];

    // Walking upwards, because a clipped layer's base is below it: reverse, collect, reverse back.
    for (let i = list.length - 1; i >= 0; i--) {
        const layer = list[i];
        const attaches = layer?.clipped && groups.length > 0;
        if (attaches) groups[groups.length - 1].clipped.unshift(layer);
        else groups.push({ base: layer, clipped: [] });
    }

    return groups.reverse();
}

/**
 * Whether this layer's clip toggle would do anything.
 *
 * The bottom layer has nothing to clip to, so the control is shown but inert - hiding it instead
 * would make the row jump around as layers are reordered.
 *
 * @param {{id: any}[]} order layers in UI order, topmost first
 * @param {any} layerId
 * @returns {boolean}
 */
export function canClip(order, layerId) {
    const list = Array.isArray(order) ? order : [];
    const i = list.findIndex(l => l?.id === layerId);
    return i >= 0 && i < list.length - 1;
}
