/**
 * A text object as the document stores it.
 *
 * Written out because every function here took it as `{object}`, which the type checker reads as
 * "anything" - so a misspelt field was a silent no-effect rather than an error, and the only way
 * to learn what a text actually holds was to read all of paintFrame. These are the fields the
 * renderer reads; all of them are optional, because a text created before a feature existed
 * simply does not have that key and every read below already has a default.
 *
 * @typedef {object} TextObject
 * @property {string} [text] the content, newline-separated for multiple lines
 * @property {number} [x] anchor, not the left edge - see measureTextBox
 * @property {number} [y] top of the first line
 * @property {'left'|'center'|'right'} [align] which edge x anchors
 * @property {number} [fontSize] clamped to 6..400 on read
 * @property {string} [fontFamily]
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {number} [lineHeight] multiple of the font size
 * @property {number} [letterSpacing] px; skipped on engines without the property
 * @property {string} [color] the fill, and the top stop when gradient is on
 * @property {boolean} [gradient] fill vertically from color to color2 instead of flat
 * @property {string} [color2] the bottom stop; only read when gradient is on
 * @property {string} [bgColor] rounded highlight painted behind the text
 * @property {number} [outline] stroke width in px
 * @property {string} [outlineColor]
 * @property {boolean} [shadow]
 * @property {string} [shadowColor]
 * @property {number} [shadowBlur]
 * @property {number} [shadowDX]
 * @property {number} [shadowDY]
 * @property {number} [rotation] degrees, about the centre of the box
 * @property {number} [opacity] 0..1, multiplied with any animation alpha
 */

/**
 * The rectangle a text occupies, in canvas coordinates.
 * @typedef {object} TextBox
 * @property {number} x left edge
 * @property {number} y top edge
 * @property {number} w
 * @property {number} h
 */

/**
 * What computeTextAnim returns for one instant, or null when nothing is animating.
 * @typedef {object} TextAnim
 * @property {number} alpha
 * @property {number} dx
 * @property {number} dy
 * @property {number} scale
 * @property {number} blur px
 * @property {number} rot degrees
 * @property {number} chars how much of the string is revealed, for the typing effect
 */

// Measuring and drawing text objects.
//
// This was ~70 lines in the middle of paintFrame, which is the render hot path and the last
// place anyone wants to read carefully. Nothing here needs React or app state - a context, a
// text object, and the animation values for this instant are enough - so it moves out whole,
// and the fiddly parts (what order the effects go in, how typing slices a multi-line string)
// become checkable with a recording context.

/**
 * Font size, clamped to what the editor allows. Three call sites relied on the same clamp.
 * @param {TextObject | null | undefined} t
 * @returns {number}
 */
export function clampFontSize(t) {
    return Math.max(6, Math.min(400, t?.fontSize ?? 32));
}

/**
 * The CSS font string, in the order the canvas shorthand requires: style, weight, size, family.
 * @param {TextObject | null | undefined} t
 * @returns {string}
 */
export function textFontOf(t) {
    return `${t?.italic ? 'italic ' : ''}${t?.bold ? 'bold ' : ''}${clampFontSize(t)}px ${t?.fontFamily ?? 'sans-serif'}`;
}

/**
 * Baseline-to-baseline distance for stacked lines.
 * @param {TextObject | null | undefined} t
 * @returns {number}
 */
export function textLineHeight(t) {
    return Math.round(clampFontSize(t) * (t?.lineHeight ?? 1.25));
}

/**
 * The rectangle a text occupies, in canvas coordinates.
 *
 * x is the left edge, which is not t.x unless the text is left-aligned: a centred or
 * right-aligned text hangs off its anchor, and everything that boxes the text - the background
 * highlight, rotation, the editor's dashed outline - needs the real left edge, not the anchor.
 *
 * @param {TextObject | null | undefined} t
 * @param {CanvasRenderingContext2D} measureCtx any context; only its font and measureText are used
 * @returns {TextBox}
 */
export function measureTextBox(t, measureCtx) {
    const fontSize = clampFontSize(t);
    measureCtx.font = textFontOf(t);
    const lineHeight = Math.round(fontSize * (t?.lineHeight ?? 1.25));
    const lines = String(t?.text ?? '').split('\n');
    let w = 0;
    for (const ln of lines) w = Math.max(w, measureCtx.measureText(ln).width);
    w = Math.max(1, Math.ceil(w));
    const h = Math.max(1, Math.max(1, lines.length) * lineHeight);
    const align = t?.align || 'left';
    const x = (t?.x ?? 0) - (align === 'center' ? w / 2 : align === 'right' ? w : 0);
    return { x, y: t?.y ?? 0, w, h };
}

/**
 * Whether this text has to be measured before it can be drawn.
 *
 * Measuring costs a measureText per line, so it is skipped for plain text. Anything that needs
 * to know where the text actually sits - a pivot to rotate or scale about, a box to paint behind
 * it, a gradient to span it - does need it.
 *
 * @param {TextObject | null | undefined} t
 * @param {TextAnim | null} [anim]
 * @returns {boolean}
 */
export function textNeedsBox(t, anim) {
    return !!(t?.gradient || t?.bgColor || t?.rotation || anim);
}

/**
 * Split text into the lines to draw, revealing only the first `chars` characters.
 *
 * `chars` of null means no typing effect and the whole string is drawn.
 *
 * Line breaks cost nothing: the budget is spent on printable characters only, so the reveal does
 * not stall for a tick at the end of each line. That is deliberate - it keeps the rhythm even -
 * and it is why the budget is decremented by the line's length rather than the length plus one.
 */
export function revealLines(text, chars) {
    const lines = String(text ?? '').split('\n');
    if (chars == null) return lines;
    let left = chars;
    return lines.map(ln => {
        const take = Math.max(0, Math.min(ln.length, left));
        left -= ln.length;
        return ln.slice(0, take);
    });
}

/**
 * Draw one text object.
 *
 * The order matters and is not arbitrary: the animation transform has to be established before
 * the static rotation so the two compose about the same centre; the background box is painted
 * before the glyphs so it sits behind them; the outline is stroked under every line before any
 * line is filled, or a descender from the line above would be overdrawn by the next line's
 * outline.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {TextObject} t
 * @param {object} [opts]
 * @param {TextAnim|null} [opts.anim] computeTextAnim output for this instant, or null when paused
 * @param {TextBox|null} [opts.box] the measured box; required whenever textNeedsBox says so
 * @param {number} [opts.alpha] extra opacity from the cut or layer animation
 */
export function drawTextObject(ctx, t, { anim = null, box = null, alpha = 1 } = {}) {
    const fontSize = clampFontSize(t);
    const lineHeight = textLineHeight(t);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = (t.opacity ?? 1) * alpha * (anim ? anim.alpha : 1);

    if (anim && box) {
        // Move, scale and rotate all pivot on the centre of the text box.
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        ctx.translate(cx + anim.dx, cy + anim.dy);
        if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
        if (anim.rot) ctx.rotate(anim.rot * Math.PI / 180);
        ctx.translate(-cx, -cy);
        if (anim.blur > 0.05) ctx.filter = `blur(${anim.blur.toFixed(1)}px)`;
    }
    // The text's own rotation, about the same centre.
    if (t.rotation && box) {
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        ctx.translate(cx, cy); ctx.rotate((t.rotation * Math.PI) / 180); ctx.translate(-cx, -cy);
    }
    // Background box (the highlight).
    if (t.bgColor && box) {
        const pad = Math.round(fontSize * 0.22);
        ctx.fillStyle = t.bgColor;
        const bx = box.x - pad, by = box.y - pad, bw = box.w + pad * 2, bh = box.h + pad * 2, r = Math.min(bh / 2, 12);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, r); else ctx.rect(bx, by, bw, bh);
        ctx.fill();
    }

    ctx.textBaseline = 'top';
    ctx.textAlign = t.align || 'left';
    ctx.font = textFontOf(t);
    // letterSpacing is recent enough that not every engine has it, and assigning to a property a
    // context does not implement throws in some of them.
    try { ctx.letterSpacing = `${t.letterSpacing || 0}px`; } catch { }

    const lines = revealLines(t.text, anim ? anim.chars : null);

    // Either a vertical two-colour gradient down the box, or a flat fill.
    /** @type {string | CanvasGradient} */
    let fillStyle = t.color ?? '#000';
    if (t.gradient && box) {
        const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
        g.addColorStop(0, t.color ?? '#000');
        g.addColorStop(1, t.color2 || '#ffffff');
        fillStyle = g;
    }

    if (t.shadow) {
        ctx.shadowColor = t.shadowColor || 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = t.shadowBlur ?? 6;
        ctx.shadowOffsetX = t.shadowDX ?? 2;
        ctx.shadowOffsetY = t.shadowDY ?? 2;
    }
    const x = t.x ?? 0, y = t.y ?? 0;
    if (t.outline) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, fontSize / 6);
        ctx.strokeStyle = t.outlineColor || '#ffffff';
        for (let i = 0; i < lines.length; i++) ctx.strokeText(lines[i], x, y + i * lineHeight);
    }
    ctx.fillStyle = fillStyle;
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
        // The shadow is cast once, by the block as a whole. Left on, each line would drop a
        // shadow onto the line beneath it and the stack would darken as it went down.
        if (i === 0 && t.shadow) {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }
    }
    try { ctx.letterSpacing = '0px'; } catch { }
    ctx.restore();
}
