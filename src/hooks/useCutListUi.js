import { useCallback, useState } from 'react';
import { toggled } from '../core/cutSelection.js';

// What is picked in the cut list, and how much of it is unfolded.
//
// Two groups, kept in one hook because they belong to the same thing: where the user is looking
// in the cut list. Neither survives the document being replaced - or should not; see #241, where
// the two paths that replace a document clear different halves of this.
//
//   picked      which cuts are selected, the rubber band selecting them, and the part that
//               scopes playback to part of the film
//   unfolded    which cuts show their settings, which are collapsed in the list, and which one
//               is being renamed
//
// None of it is saved with the document. It is where the user is looking, not what they have
// made, and restoring it would mean a project opening to someone else's scroll position.

export function useCutListUi() {
    // --- picked ---
    const [selectedCutIds, setSelectedCutIds] = useState(/** @type {Set<any>} */(new Set()));
    /** The rubber-band rectangle, in content pixels, while dragging over the timeline. */
    const [marquee, setMarquee] = useState(/** @type {any} */(null));
    /** Scope playback and editing to one part; null is the whole film. */
    const [activePartId, setActivePartId] = useState(/** @type {any} */(null));

    // --- unfolded ---
    const [expandedCuts, setExpandedCuts] = useState(/** @type {Set<any>} */(new Set()));
    const [collapsedCutIds, setCollapsedCutIds] = useState(/** @type {Set<any>} */(new Set()));
    const [renamingCutId, setRenamingCutId] = useState(/** @type {any} */(null));

    const toggleCutSettings = useCallback((id) => setExpandedCuts(p => toggled(p, id)), []);
    const toggleCutCollapse = useCallback((id) => setCollapsedCutIds(p => toggled(p, id)), []);

    return {
        selectedCutIds, setSelectedCutIds, marquee, setMarquee, activePartId, setActivePartId,
        expandedCuts, collapsedCutIds, renamingCutId, setRenamingCutId,
        toggleCutSettings, toggleCutCollapse,
    };
}
