// Text animation, for MV subtitles: entrance, exit, typing, emphasis, per-character effects.

import { cutDuration } from './cutTime.js';
import { charProgress } from './textLayout.js';

// Text animation, for MV subtitles. Takes the progress through the cut and returns just the
// values needed to draw.
//  - in/out: entrance and exit (fade/up/down/scale/blur)
//  - typing: reveals a character at a time by slicing the string
//  - emphasis: a looping accent (pulse/shake/wave)
export const TEXT_ANIM_DEFAULT = {
    inType: 'none', inDur: 0.4, outType: 'none', outDur: 0.4,
    typing: false, typeSpeed: 18, emphasis: 'none', emAmount: 20, emSpeed: 2,
    charStagger: 0, charFx: 'none', charFxAmount: 40,
};

/**
 * A stable pseudo-random number in 0..1 for one character.
 *
 * Stable is the whole point: Math.random would give a character a new direction every frame and
 * the text would boil rather than fly together. The same index always gets the same value, so a
 * scatter looks scattered but holds still, and it looks the same on every replay and every
 * machine.
 *
 * @param {number} index
 * @param {number} [salt] a second stream, for a second axis
 * @returns {number} 0..1
 */
export function charNoise(index, salt = 0) {
    // A small integer hash. The constants are the usual odd primes; nothing about them matters
    // beyond mixing the low bits into the high ones.
    let h = (index | 0) * 374761393 + (salt | 0) * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Where one character is coming from, on top of whatever entrance is playing.
 *
 * This is the part that makes typing read as characters arriving separately rather than a line
 * sliding in as one: each character gets its own offset, and the offset shrinks to nothing as
 * that character settles. `e` is the eased progress of that character alone.
 *
 * @param {string} mode
 * @param {number} amount px, or degrees for the modes that turn
 * @param {number} index
 * @param {number} e 0..1, eased; 1 means settled
 * @returns {{ dx: number, dy: number, rot: number, scale: number, alpha: number } | null}
 */
export function charFxAt(mode, amount, index, e) {
    const away = 1 - e;
    if (!mode || mode === 'none' || away <= 0) return null;
    const amt = Number.isFinite(amount) ? amount : 40;
    switch (mode) {
        case 'scatter': {
            // A direction per character, from anywhere on the circle, so the line gathers itself
            // out of the air rather than out of one side.
            const angle = charNoise(index) * Math.PI * 2;
            const reach = 0.5 + charNoise(index, 1) * 0.5;   // and not all from the same distance
            return {
                dx: Math.cos(angle) * amt * reach * away,
                dy: Math.sin(angle) * amt * reach * away,
                rot: (charNoise(index, 2) - 0.5) * 90 * away,
                scale: 1, alpha: e,
            };
        }
        case 'zigzag':
            // Alternating, which reads as deliberate where scatter reads as thrown.
            return { dx: 0, dy: (index % 2 ? amt : -amt) * away, rot: 0, scale: 1, alpha: e };
        case 'spin':
            return { dx: 0, dy: 0, rot: amt * away, scale: 0.4 + 0.6 * e, alpha: e };
        case 'drop':
            // Straight down onto the line, each character on its own, which is the plain reading
            // of "falling in".
            return { dx: 0, dy: -amt * away, rot: 0, scale: 1, alpha: e };
        case 'pop': {
            // Back-out easing: past its size and then back to it. A character that only grows
            // towards 1 looks inflated rather than popped, and multiplying a bump by e does not
            // help - e wins and the curve never crosses 1.
            const c1 = 1.70158, c3 = c1 + 1, k = e - 1;
            const scale = 1 + c3 * k * k * k + c1 * k * k;
            return { dx: 0, dy: 0, rot: 0, scale: Math.max(0.05, scale), alpha: Math.min(1, e * 2) };
        }
        default:
            return null;
    }
}

/**
 * What one entrance or exit contributes at eased presence `e`: 0 is fully away, 1 is settled.
 *
 * Pulled out of computeTextAnim because the same five motions are now needed twice - once for
 * the text as a block, and once per character when a stagger is set. Two copies of this would
 * be two chances for a character to move differently from the block it belongs to.
 *
 * `dir` is +1 entering and -1 leaving, and only the vertical motions read it: 'up' means upward
 * either way, which is coming from below on the way in and rising away on the way out.
 *
 * @param {string} type
 * @param {number} e
 * @param {1 | -1} dir
 * @returns {{ alpha: number, dx: number, dy: number, scale: number, blur: number } | null}
 */
export function textAnimStep(type, e, dir) {
    const away = 1 - e;
    // Adding zero, because a settled 'down' works out to -0, which is equal to 0 everywhere
    // except in a strict comparison - and that is exactly where a test would find it.
    const noMinusZero = (v) => v + 0;
    switch (type) {
        case 'fade': return { alpha: e, dx: 0, dy: 0, scale: 1, blur: 0 };
        case 'up': return { alpha: e, dx: 0, dy: noMinusZero(dir * away * 40), scale: 1, blur: 0 };
        case 'down': return { alpha: e, dx: 0, dy: noMinusZero(-dir * away * 40), scale: 1, blur: 0 };
        case 'scale': return { alpha: e, dx: 0, dy: 0, scale: 0.6 + 0.4 * e, blur: 0 };
        case 'blur': return { alpha: e, dx: 0, dy: 0, scale: 1, blur: away * 10 };
        default: return null;
    }
}

/**
 * The raw entrance progress, handed to the renderer so each character can take its own slice.
 * @typedef {object} PerCharAnim
 * @property {'typing'|'spread'|null} [inMode] which way the entrance is divided among characters
 * @property {number} spread how much of the duration separates the first character from the last
 * @property {string} [inType]
 * @property {number} [inU] 0..1 through the entrance, for the spread mode
 * @property {number} [speed] characters a second, for the typing mode
 * @property {number} [local] seconds since the cut began, for the typing mode
 * @property {number} [dur] how long one character takes to settle, for the typing mode
 * @property {string} [outType]
 * @property {number} [outU] 0..1 through the exit
 * @property {string} [fx] a per-character offset played on top of the entrance
 * @property {number} [fxAmount] how far that offset reaches, in px or degrees
 */

/**
 * How far into its own entrance one character is.
 *
 * Two ways of dividing an entrance among characters, and they answer different questions:
 *
 *   - 'spread' fits every character into one entrance window, so the whole line has arrived by
 *     the time the entrance is over however long the text is
 *   - 'typing' starts each character's entrance at the moment typing reveals it, so a character
 *     animates in rather than snapping into place. The line takes as long as the typing does,
 *     which is the point of typing
 *
 * @param {PerCharAnim} p
 * @param {number} index character index across the whole text, not within its line
 * @param {number} count
 * @returns {number} 0..1
 */
function charInProgress(p, index, count) {
    if (p.inMode === 'typing') {
        // Revealed at (index + 1) / speed: `chars` is a count, so character 0 is drawn once the
        // count reaches one. Starting the entrance at index / speed instead put every character
        // a whole keystroke into its entrance before it was drawn, which on screen looked like
        // plain typing - the animation had already mostly played by the time you could see it.
        const revealedAt = (index + 1) / Math.max(0.0001, p.speed ?? 18);
        return Math.max(0, Math.min(1, ((p.local ?? 0) - revealedAt) / Math.max(0.0001, p.dur ?? 0.4)));
    }
    return charProgress(index, count, p.inU ?? 1, p.spread ?? 0);
}

/**
 * One character's share of the entrance or exit.
 *
 * The block-level values in computeTextAnim are skipped entirely when this is in play, so this
 * is the whole of that character's entrance rather than something added on top.
 *
 * @param {PerCharAnim} perChar
 * @param {number} index character index across the whole text, not within its line
 * @param {number} count
 */
export function charAnimAt(perChar, index, count) {
    let alpha = 1, dx = 0, dy = 0, scale = 1, blur = 0, rot = 0;
    const take = (step) => {
        if (!step) return;
        alpha *= step.alpha; dx += step.dx; dy += step.dy; scale *= step.scale;
        blur = Math.max(blur, step.blur ?? 0);
        rot += step.rot ?? 0;
    };
    const hasIn = !!perChar.inType && perChar.inType !== 'none';
    const hasFx = !!perChar.fx && perChar.fx !== 'none';
    if (hasIn || hasFx) {
        const u = charInProgress(perChar, index, count);
        const e = 1 - Math.pow(1 - u, 3);                                // ease-out, as the block uses
        if (hasIn) take(textAnimStep(perChar.inType, e, 1));
        // The offset rides on top of the entrance rather than replacing it, so 'fade' plus
        // 'scatter' is a character that fades in while flying home. With no entrance chosen the
        // offset is the entrance, which is why it carries an alpha of its own.
        if (hasFx) take(charFxAt(perChar.fx, perChar.fxAmount, index, e));
    }
    if (perChar.outType && perChar.outType !== 'none') {
        const u = charProgress(index, count, perChar.outU ?? 0, perChar.spread ?? 0);
        take(textAnimStep(perChar.outType, 1 - u * u, -1));              // ease-in, mirrored
    }
    return { alpha, dx, dy, scale, blur, rot };
}

export function computeTextAnim(t, ac, time) {
    const a = t.anim;
    if (!a) return null;
    const local = time - ac.startTime;
    const dur = cutDuration(ac);
    let alpha = 1, dx = 0, dy = 0, scale = 1, blur = 0, rot = 0;

    // Either of these means the characters own the entrance, not the block. Applying it in
    // both places would double every offset and halve every fade.
    //
    // Typing wins when both are set: a character cannot start its entrance before it has been
    // revealed, so the typing clock is the one that decides, and the stagger has nothing left
    // to spread.
    const stagger = Math.max(0, Math.min(1, a.charStagger ?? 0));
    const fx = a.charFx && a.charFx !== 'none' ? a.charFx : null;
    // A per-character offset is an entrance in its own right. Requiring one of the block
    // entrances to be chosen as well was why ticking only 'typing' appeared to do nothing.
    const hasIn = (!!a.inType && a.inType !== 'none') || !!fx;
    const inMode = a.typing && hasIn ? 'typing' : ((stagger || fx) && hasIn ? 'spread' : null);

    const inDur = Math.max(0.0001, a.inDur ?? 0.4);
    const enteringIn = !!a.inType && a.inType !== 'none' && local < inDur;
    const entering = hasIn && local < inDur;
    const inU = Math.max(0, Math.min(1, local / inDur));
    if (enteringIn && !inMode) {
        const step = textAnimStep(a.inType, 1 - Math.pow(1 - inU, 3), 1);   // ease-out
        if (step) { alpha *= step.alpha; dx += step.dx; dy += step.dy; scale *= step.scale; blur = Math.max(blur, step.blur); }
    }
    const outDur = Math.max(0.0001, a.outDur ?? 0.4);
    const tailStart = dur - outDur;
    const leaving = !!a.outType && a.outType !== 'none' && local > tailStart;
    const outU = Math.max(0, Math.min(1, (local - tailStart) / outDur));
    if (leaving && !stagger) {
        const step = textAnimStep(a.outType, 1 - outU * outU, -1);          // ease-in, mirrored
        if (step) { alpha *= step.alpha; dx += step.dx; dy += step.dy; scale *= step.scale; blur = Math.max(blur, step.blur); }
    }
    // Emphasis runs on absolute time, so its rhythm stays constant whatever the cut length.
    const em = a.emAmount ?? 20, es = a.emSpeed ?? 2;
    if (a.emphasis === 'pulse') scale *= 1 + (em / 100) * 0.5 * Math.sin(2 * Math.PI * es * time);
    else if (a.emphasis === 'shake') { dx += (em / 10) * Math.sin(2 * Math.PI * es * 3.1 * time); dy += (em / 14) * Math.sin(2 * Math.PI * es * 2.3 * time + 1.1); }
    else if (a.emphasis === 'swing') rot += (em / 10) * Math.sin(2 * Math.PI * es * time);

    // Typing reveals typeSpeed characters per second; null means no slicing.
    const speed = a.typeSpeed || 18;
    let chars = null;
    if (a.typing) chars = Math.max(0, Math.floor(Math.max(0, local) * speed));

    // A typed entrance runs for as long as the typing does, not just the entrance window: the
    // last character starts its entrance when it is revealed, which can be well past inDur.
    const typingIn = inMode === 'typing' && chars != null && local >= 0;
    const spreadIn = inMode === 'spread' && entering;
    const staggeredOut = !!stagger && leaving;

    // Only present while something is actually per-character, so the renderer's cheap
    // whole-line path stays the normal one.
    const perChar = (typingIn || spreadIn || staggeredOut)
        ? {
            inMode: typingIn ? 'typing' : (spreadIn ? 'spread' : null),
            spread: stagger,
            inType: (typingIn || spreadIn) ? a.inType : 'none', inU,
            fx: (typingIn || spreadIn) ? fx : null, fxAmount: a.charFxAmount ?? 40,
            speed, local, dur: inDur,
            outType: staggeredOut ? a.outType : 'none', outU,
        }
        : null;
    return { alpha, dx, dy, scale, blur, rot, chars, perChar };
}
