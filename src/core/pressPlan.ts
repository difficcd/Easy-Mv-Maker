// What a press on the canvas starts.
//
// This is the decision half of App's startDraw. That function was a chain of early returns whose
// order *is* the behaviour - panning before the eyedropper, the eyedropper before a path, a path
// before the layer is even resolved, a selection before any tool - and each rule was recorded only
// as a comment beside its `if`. The draw handlers were also the largest cluster of fixes inside
// App (21 fix commits; see docs/process/2026-10-21.md), and a rule that lives in a comment is one
// edit away from being broken without anything noticing.
//
// So the order is decided here, from plain values, with a test per rule; startDraw keeps the
// effects - sampling the colour, beginning the gesture, committing a declined selection.

export interface PressInput {
    spaceHeld: boolean;
    /** the mouse button; 1 is the middle one, which pans */
    button: number;
    /** a pan already under way */
    panning: boolean;
    pointerType: string;
    pickingColour: boolean;
    /** a camera, motion, sway or mosaic path is being recorded */
    recordingPath: boolean;
    /** resolveDrawLayer found a layer the stroke can land on */
    hasDrawLayer: boolean;
    editingText: boolean;
    hasSelection: boolean;
    /** the tool as selected */
    tool: string;
    /** the tool a two-in-one button resolves to */
    etool: string;
}

/** The press ends here, without starting a gesture of its own. */
export type PressStop = 'pan' | 'touch' | 'pick-colour' | 'record-path' | 'no-layer' | 'editing-text';

/** Where a press that is not stopped goes. */
export type PressRoute = 'text' | 'move' | 'curve' | 'tool';

export type PressPlan =
    | { stop: PressStop }
    /**
     * `offerSelection`: hand the press to the selection gesture first. If it declines, the caller
     * commits the selection and continues to `route`.
     */
    | { offerSelection: boolean, route: PressRoute };

/**
 * @param {PressInput} p
 * @returns {PressPlan}
 */
export function planPress(p: PressInput): PressPlan {
    // Space, the middle button or a pan under way belong to the canvas area, which handles them.
    if (p.spaceHeld || p.button === 1 || p.panning) return { stop: 'pan' };
    // Palm rejection: a stylus or a mouse draws, a finger navigates.
    if (p.pointerType === 'touch') return { stop: 'touch' };
    if (p.pickingColour) return { stop: 'pick-colour' };
    // Before the layer is resolved: a camera path belongs to the cut, so it must work on a cut
    // whose active layer is a folder or hidden.
    if (p.recordingPath) return { stop: 'record-path' };
    if (!p.hasDrawLayer) return { stop: 'no-layer' };
    if (p.editingText) return { stop: 'editing-text' };
    const route: PressRoute =
        p.tool === 'text' ? 'text'
            : p.tool === 'move' ? 'move'
                // The pen and the ruler share a button, so this one reads the resolved tool.
                : p.etool === 'curve' ? 'curve'
                    : 'tool';
    return { offerSelection: p.hasSelection, route };
}
