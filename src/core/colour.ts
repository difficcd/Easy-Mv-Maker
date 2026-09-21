// Putting an alpha on a colour that came from the theme.
//
// The theme writes its variables as `hsl(h s% l%)`, but the stylesheet's defaults are hex and a
// variable that has not been set yet reads back as one. Handling only the hsl form meant the
// alpha was silently dropped for the others - a motion path drawn at "40%" came out solid, and
// nothing said so.

/** #rgb, #rgba, #rrggbb, #rrggbbaa -> [r, g, b], or null if it is not a hex colour. */
function hexRgb(c: string): number[] | null {
    const m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (!m) return null;
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16));
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return null;
}

/**
 * `colour` at `alpha`, in a form a canvas can parse.
 *
 * An alpha of 1 or more is the colour unchanged - the common case, and it avoids rewriting a
 * value the browser already understands. A colour that carries an alpha of its own has it
 * replaced rather than appended, since two alphas in one function is not a colour.
 *
 * @param {string} colour
 * @param {number} alpha
 * @returns {string}
 */
export function withAlpha(colour: string | null | undefined, alpha: number): string {
    const c = (colour || '').trim();
    if (!c || !(alpha < 1)) return c;
    const a = Math.max(0, alpha);
    const rgb = hexRgb(c);
    if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    // hsl(...), rgb(...), hwb(...), lab(...): CSS Color 4 takes a slash-separated alpha inside
    // the function, and one already there is dropped first.
    const fn = /^([a-z]+)\((.*)\)$/is.exec(c);
    if (fn) return `${fn[1]}(${fn[2].split('/')[0].trim()} / ${a})`;
    return c;   // a named colour, or something this does not know: better opaque than broken
}

export function hexToRgb(hex: unknown): { r: number, g: number, b: number } {
    const h = String(hex || '').trim();
    if (!h.startsWith('#')) return { r: 0, g: 0, b: 0 };
    const s = h.slice(1);
    if (s.length === 3) {
        const r = parseInt(s[0] + s[0], 16);
        const g = parseInt(s[1] + s[1], 16);
        const b = parseInt(s[2] + s[2], 16);
        return { r: r | 0, g: g | 0, b: b | 0 };
    }
    if (s.length === 6) {
        const r = parseInt(s.slice(0, 2), 16);
        const g = parseInt(s.slice(2, 4), 16);
        const b = parseInt(s.slice(4, 6), 16);
        return { r: r | 0, g: g | 0, b: b | 0 };
    }
    return { r: 0, g: 0, b: 0 };
}
