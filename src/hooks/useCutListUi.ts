import { useCallback, useState } from 'react';
import { toggled } from '../core/cutSelection.ts';


// What is picked in the cut list, and how much of it is unfolded.
//
// Two groups, kept in one hook because they belong to the same thing: where the user is looking
// in the cut list. None of it survives the document being replaced, which is what `reset` is for.
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
    const [selectedCutIds, setSelectedCutIds] = useState<Set<DocId>>(new Set());
    /** The rubber-band rectangle, in content pixels, while dragging over the timeline. */
    const [marquee, setMarquee] = useState<any>(null);
    /** Scope playback and editing to one part; null is the whole film. */
    const [activePartId, setActivePartId] = useState<PartId | null>(null);

    // --- unfolded ---
    const [expandedCuts, setExpandedCuts] = useState<Set<DocId>>(new Set());
    const [collapsedCutIds, setCollapsedCutIds] = useState<Set<DocId>>(new Set());
    const [renamingCutId, setRenamingCutId] = useState<DocId | null>(null);

    const toggleCutSettings = useCallback((id: DocId) => setExpandedCuts(p => toggled(p, id)), []);
    const toggleCutCollapse = useCallback((id: DocId) => setCollapsedCutIds(p => toggled(p, id)), []);

    /**
     * Forget all of it, for a document that is being replaced.
     *
     * Every one of these has to go, and the reason is the same for each: they name things in the
     * document that is on its way out. Cut ids are **not unique across documents** - they start
     * at 1 in every one - so a selection carried over does not become empty, it silently becomes
     * a selection of whichever cuts in the new document happen to have those numbers. Anything
     * scoped to the selection then acts on cuts the user never picked (#241).
     *
     * One function rather than a list at each call site. The two paths that replace a document
     * each wrote their own list and the lists had drifted apart - opening a project cleared the
     * active part and the expanded rows, starting a new one also cleared the selection, and
     * neither cleared the collapsed rows, the rename in progress or the marquee.
     */
    const reset = useCallback(() => {
        setSelectedCutIds(new Set());
        setMarquee(null);
        setActivePartId(null);
        setExpandedCuts(new Set());
        setCollapsedCutIds(new Set());
        setRenamingCutId(null);
    }, []);

    return {
        selectedCutIds, setSelectedCutIds, marquee, setMarquee, activePartId, setActivePartId,
        expandedCuts, collapsedCutIds, renamingCutId, setRenamingCutId,
        toggleCutSettings, toggleCutCollapse, reset,
    };
}
