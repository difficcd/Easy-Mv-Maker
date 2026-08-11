import React from 'react';
import { clampNum, liveNumber, commitNumber } from './numInput';

// A number input you can actually type into. The rules, and why the plain controlled input does
// not work, are in numInput.js; this is the component around them.
//
// While the field has focus it shows exactly the characters typed, and reports a value upward
// only once that text parses as a number - unclamped, so a live preview follows along. The range
// is applied when the field is left or Enter is pressed, the first moment the input is finished.
//
// Callers that must never see an out-of-range value (a speed of 0 would divide by zero) keep
// their own guard in onChange. That guard cannot disturb the typing: a focused field displays its
// own draft, not the prop, so the parent rejecting a value is invisible until the field is left.

export { clampNum, liveNumber, commitNumber };

export function NumField({
    value, onChange, min = undefined, max = undefined, step = 1,
    className = 'time-input', style = undefined, title = '', width = undefined,
}) {
    const [draft, setDraft] = React.useState(null); // a string while focused, otherwise null

    const commit = (raw) => {
        const next = commitNumber(raw, { min, max, fallback: value });
        setDraft(null);
        if (next !== value) onChange(next);
    };

    return (
        <input
            type="number"
            className={className}
            title={title}
            min={min}
            max={max}
            step={step}
            style={width != null ? { width, ...style } : style}
            value={draft ?? value}
            onFocus={e => setDraft(e.target.value)}
            onChange={e => {
                const raw = e.target.value;
                setDraft(raw);
                const live = liveNumber(raw);
                if (live != null && live !== value) onChange(live);
            }}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); }
                if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
            }}
        />
    );
}

export default NumField;
