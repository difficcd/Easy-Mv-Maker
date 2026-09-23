import { useCallback, useRef, useState } from 'react';
import type { AskRequest } from '../ui/dialogs/AskModal.tsx';

/** What an answered question hands back: false/null when declined. */
export type Answer = boolean | string | null;
/** Everything about a question except the kind, which the two entry points fix. */
export type AskOptions = Omit<AskRequest, 'kind' | 'title'>;

// Asking a question from code that has no JSX.
//
// The sites this replaces were all `if (!window.confirm(...)) return;`, half of them inside hooks
// that render nothing. Handing back a promise keeps that shape - `if (!await ask.confirm(...))
// return;` - so the twenty call sites stayed one word longer instead of being turned inside out
// into callbacks. AskModal draws it; this holds the promise open until an answer arrives.

export function useAsk() {
    const [request, setRequest] = useState<AskRequest | null>(null);
    const pending = useRef<{ req: AskRequest, resolve: (a: Answer) => void } | null>(null);

    const raise = useCallback((req: AskRequest) => new Promise<Answer>(resolve => {
        // A question already on screen is declined rather than dropped. Whoever awaited it is
        // still waiting, and a promise that never settles wedges that flow for the rest of the
        // session - the autosave prompt and a save-name prompt can genuinely collide.
        const prev = pending.current;
        if (prev) prev.resolve(prev.req.kind === 'prompt' ? null : false);
        pending.current = { req, resolve };
        setRequest(req);
    }), []);

    /** The answer from AskModal. Clears the dialog first, so a reply that asks again works. */
    const answer = useCallback((a: Answer) => {
        const p = pending.current;
        pending.current = null;
        setRequest(null);
        p?.resolve(a);
    }, []);

    /** True if they accepted. Give okLabel the verb - "Delete" reads better than "OK". */
    const confirm = useCallback(
        (title: string, opts: AskOptions = {}) => raise({ ...opts, kind: 'confirm', title }) as Promise<boolean>,
        [raise]);
    /** The text typed, trimmed, or null if they declined. Never an empty string. */
    const prompt = useCallback(
        (title: string, opts: AskOptions = {}) => raise({ ...opts, kind: 'prompt', title }) as Promise<string | null>,
        [raise]);

    return { request, answer, confirm, prompt };
}

/** The asking half, for the hooks that only need to put a question. */
export type Ask = Pick<ReturnType<typeof useAsk>, 'confirm' | 'prompt'>;
