import { useEffect, useState } from 'react';

// What the app is telling the user, as against what it is asking them.
//
// Three levels, and the difference between them is how much of the user's attention they are
// entitled to:
//
//   progress   a job is running and the screen says how far along it is
//   toast      something happened; it goes away by itself
//   error      something failed; it stays until it is dismissed
//
// The error stays because it used to be an alert, and with the API server down a blocked alert
// looked exactly like nothing having happened at all. A failure the user never sees is worse
// than one they cannot miss.
//
// The link prompt is here because it is the one notice that asks for something back - a YouTube
// URL - and it is raised from the same places as the others.

export function useNotices() {
    /** {label, done, total}; total 0 means the length is not known yet. */
    const [progress, setProgress] = useState(/** @type {any} */(null));
    /** A short message, bottom-right, that dismisses itself. */
    const [toast, setToast] = useState(/** @type {string|null} */(null));
    /** A failure banner that stays until it is closed. */
    const [error, setError] = useState(/** @type {string|null} */(null));
    /** {kind: 'video'|'audio'} while asking for a YouTube link. */
    const [linkPrompt, setLinkPrompt] = useState(/** @type {any} */(null));

    // Three seconds from when it was set, and re-armed if it is replaced - so a second toast
    // gets its own three seconds rather than inheriting what was left of the first one's.
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 3000);
        return () => clearTimeout(t);
    }, [toast]);

    return { progress, setProgress, toast, setToast, error, setError, linkPrompt, setLinkPrompt };
}
