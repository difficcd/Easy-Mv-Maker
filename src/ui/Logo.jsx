import React from 'react';

/**
 * The app mark: three frames receding, the front one carrying a play mark.
 *
 * The stack is the onion skin, which is what this app is actually for, and the play mark says the
 * stack is a film rather than a pile of drawings.
 *
 * Solid shapes, not outlines. The first version drew the two frames behind as thin strokes at low
 * opacity, which reads as depth at 256px and as dirt at the 26px this is actually rendered at -
 * a 3px stroke is under half a pixel once it is scaled down, so the ghosts turned to smudges.
 * A filled shape cannot thin out.
 *
 * It draws in `currentColor` and lightens the frames behind with opacity, so the whole mark
 * follows the theme the user picked while staying one colour. `public/icon.svg` is the same mark
 * with the default accent baked in, because a favicon has no theme to follow.
 *
 * @param {object} props
 * @param {number} [props.size]
 * @param {string} [props.className]
 */
export function Logo({ size = 26, className = '' }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 64 64"
            role="img" aria-label="Easy MV Maker" focusable="false">
            <rect x="20" y="6" width="38" height="38" rx="11" fill="currentColor" opacity="0.45" />
            <rect x="13" y="13" width="38" height="38" rx="11" fill="currentColor" opacity="0.72" />
            <rect x="6" y="20" width="38" height="38" rx="11" fill="currentColor" />
            {/* Painted rather than cut out: a knockout shows whatever is behind the mark, which on
                a dark bar is a dark triangle on a dark square. */}
            <path d="M19 29 L36 39 L19 49 Z" fill="#fff" />
        </svg>
    );
}
