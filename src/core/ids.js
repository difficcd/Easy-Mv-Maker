// Ids for the things a document is made of: cuts, layers, strokes, texts.
//
// These were `Date.now()`, written out nineteen times. A millisecond is long enough to create
// several objects in, so two of them could come out with the same id - and two call sites had
// already noticed and worked around it by hand, writing `Date.now() + 1` for the second object
// they made. A workaround at two of nineteen sites is a bug report, not a fix.
//
// Where it actually bites: duplicating a selection of cuts hands out a contiguous block,
// `base + 0 … base + n`. Do that twice inside the same few milliseconds and the second block
// overlaps the first, and cuts are looked up with `find(c => c.id === id)` - so selecting one
// selects the wrong one, and deleting one deletes the wrong one.
//
// The shape is deliberately unchanged: still a number, still roughly the clock, so it still
// sorts by creation and nothing that reads an id has to care. It simply cannot repeat.

let last = 0;

/**
 * The next id: the clock, or one past the last id when the clock has not moved.
 *
 * Monotonic within a session, which is all that is needed - ids are only compared inside one
 * document, and a document reopened later gets ids from a clock that has moved on.
 *
 * @returns {number}
 */
export function nextId() {
    const now = Date.now();
    last = now > last ? now : last + 1;
    return last;
}

/**
 * A unique string id, optionally prefixed.
 *
 * The clock in base 36 followed by eight random characters. The clock keeps ids sorting by
 * creation and makes them readable in a saved file; the random tail is what actually makes them
 * unique, because several of these are minted inside one millisecond routinely - importing a
 * video mints one per frame.
 *
 * This existed five times over in four shapes: tails of `slice(2)`, `slice(2, 6)` and
 * `slice(2, 7)`, and one that wrote the clock in decimal rather than base 36. Four different
 * collision odds for one idea, none of them chosen on purpose. The prefix is cosmetic: nothing
 * reads it back, it is there so a stray id in a debugger says what it belongs to.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
export function randomId(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Reset the counter. For tests only, so one test's calls cannot make another's assertions
 * depend on how many ids were handed out before it ran.
 */
export function resetIds() {
    last = 0;
}
