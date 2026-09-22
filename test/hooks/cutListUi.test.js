import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The bug this guards against is #241, and it was not a wrong calculation - it was two lists
// that had drifted apart. Opening a project cleared the active part and the expanded rows;
// starting a new one also cleared the selection; neither cleared the collapsed rows, the rename
// in progress or the marquee. A selection carried into another document does not go empty, it
// silently becomes a selection of whichever cuts happen to share those ids.
//
// So the thing worth checking is not what reset() computes. It is that reset() clears
// *everything the hook holds* - because the way this comes back is someone adding a seventh
// piece of state and updating only the places they happened to be looking at.

const src = readFileSync('src/hooks/useCutListUi.ts', 'utf8');

/** The setter of every piece of state the hook declares. */
const setters = [...src.matchAll(/const \[\s*\w+\s*,\s*(set\w+)\s*\]\s*=\s*useState/g)].map(m => m[1]);

/** The body of reset(), from its declaration to the closing of its useCallback. */
const resetBody = (src.match(/const reset = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/) || [])[1];

test('the hook holds state at all, and reset exists', () => {
    // If either of these goes, every assertion below passes vacuously.
    assert.ok(setters.length >= 6, `found only ${setters.length} pieces of state`);
    assert.ok(resetBody, 'no reset() in useCutListUi');
});

test('reset clears every piece of state the hook holds', () => {
    const missed = setters.filter(s => !resetBody.includes(`${s}(`));
    assert.deepEqual(
        missed, [],
        `reset() does not clear: ${missed.join(', ')}. A document being replaced must not leave `
        + 'behind anything naming the old one - cut ids are not unique across documents (#241).',
    );
});
