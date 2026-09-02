import React, { useId } from 'react';

/**
 * The app mark: three frames receding, the front one carrying a play mark.
 *
 * The stack is the onion skin, which is what this app is actually for, and the play mark says the
 * stack is a film rather than a pile of drawings. One colour throughout - the ghosts are the same
 * value at lower opacity, the way onion skin looks on the canvas.
 *
 * It draws in `currentColor` rather than a fixed hex, so it follows the theme the user picked.
 * `public/icon.svg` is the same mark with the default accent baked in, because a favicon has no
 * theme to follow.
 *
 * @param {{ size?: number, className?: string }} props
 */
export function Logo({ size = 26, className = '' }) {
    // The mask needs an id, and an id that appears twice on a page makes one of the two elements
    // silently use the other's mask.
    const maskId = useId();
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 64 64"
            role="img" aria-label="Easy MV Maker" focusable="false">
            <defs>
                <mask id={maskId}>
                    <rect x="0" y="0" width="64" height="64" fill="#000" />
                    <rect x="4" y="22" width="40" height="40" rx="12" fill="#fff" />
                    <path d="M18 32 L34 42 L18 52 Z" fill="#000" />
                </mask>
            </defs>
            <g fill="none" stroke="currentColor" strokeWidth="3.5">
                <rect x="21" y="4" width="39" height="39" rx="12" opacity="0.3" />
                <rect x="13" y="13" width="39" height="39" rx="12" opacity="0.58" />
            </g>
            <rect x="4" y="22" width="40" height="40" rx="12" fill="currentColor" mask={`url(#${maskId})`} />
        </svg>
    );
}
