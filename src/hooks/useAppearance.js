import { useEffect } from 'react';
import { useStored } from './useStored.js';
import { arrayCodec, numberCodec } from '../core/persist.js';

/** How many recent theme colours are kept. */
const RECENT_THEMES = 10;
/** How long the colour has to stop changing before it counts as chosen. */
const PICK_SETTLE_MS = 800;

/**
 * What the app looks like: the accent colour, how saturated the neutral chrome is, and the
 * colours picked recently.
 *
 * The picker's value changes continuously while a finger is on it, so a colour is only recorded
 * as "used" once it has stopped changing - otherwise every colour dragged through would fill
 * the recent list.
 *
 * `applyTheme` is passed in rather than imported: it writes CSS variables on the document, and
 * keeping that in the caller leaves this hook with nothing to say about the DOM beyond calling
 * what it was given.
 *
 * @param {{applyTheme: (colour: string, uiSat: number) => void, defaultTheme: string}} deps
 */
export function useAppearance({ applyTheme, defaultTheme }) {
    const [themeColor, setThemeColor] = useStored('mv_theme', defaultTheme);
    const [themeRecent, setThemeRecent] = useStored('mv_theme_recent', [], arrayCodec);
    // This one had no try/catch at all, so a browser that refuses localStorage took the app down
    // on first render instead of falling back to 3.
    const [uiSat, setUiSat] = useStored('mv_ui_sat', 3, numberCodec);

    // Only the applying is here; useStored does the remembering.
    useEffect(() => { applyTheme(themeColor, uiSat); }, [themeColor, uiSat, applyTheme]);

    useEffect(() => {
        if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) return;
        const t = setTimeout(() => {
            // No write here: the list only changes after the debounce, and useStored records it
            // when it does.
            setThemeRecent(p => [themeColor, ...p.filter(x => x.toLowerCase() !== themeColor.toLowerCase())].slice(0, RECENT_THEMES));
        }, PICK_SETTLE_MS);
        return () => clearTimeout(t);
        // The setter is listed because it comes from a custom hook: the linter knows a useState
        // setter is stable and cannot know that about one handed back from useStored. It is
        // stable, so saying so costs nothing and keeps the warning count honest.
    }, [themeColor, setThemeRecent]);

    return { themeColor, setThemeColor, themeRecent, uiSat, setUiSat };
}
