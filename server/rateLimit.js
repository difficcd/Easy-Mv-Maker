// A small token bucket, so one caller cannot use the whole server.
//
// CodeQL raised six high-severity alerts for unlimited routes, and it is right for the case that
// matters: this server is meant to be deployed. On loopback the worst outcome is a runaway script
// on the same machine; on a host it is somebody filling the disk with project assets, or pointing
// the importer at YouTube in a loop until the address is rate-limited by Google instead.
//
// A bucket rather than a fixed window, because a fixed window lets a caller spend the whole
// allowance in the last second of one window and again in the first second of the next - twice
// the intended burst, at the moment it matters least to be generous.
//
// Written here rather than added as a dependency: it is thirty lines, it has to be understood to
// be trusted, and the tests are the point.

/**
 * @typedef {object} Bucket
 * @property {number} tokens what is left
 * @property {number} at when it was last refilled, in ms
 */

/**
 * A limiter that hands out `capacity` requests and refills at `perSecond`.
 *
 * @param {object} opts
 * @param {number} opts.capacity the burst a caller may spend at once
 * @param {number} opts.perSecond how fast the allowance comes back
 * @param {() => number} [opts.now] injectable clock, so the tests are not a race
 * @param {number} [opts.maxKeys] evict least-recently-seen callers past this many, so the map is
 *   not itself a way to exhaust memory
 */
export function createRateLimiter({ capacity, perSecond, now = Date.now, maxKeys = 10000 }) {
    /** @type {Map<string, Bucket>} */
    const buckets = new Map();

    /**
     * Take one token for `key`.
     * @param {string} key
     * @returns {{ok: true} | {ok: false, retryAfter: number}} seconds to wait, rounded up
     */
    function take(key) {
        const t = now();
        let b = buckets.get(key);
        if (!b) {
            b = { tokens: capacity, at: t };
        } else {
            // Refill for the time that passed, capped - an idle caller comes back to a full
            // bucket and no more, or a long absence would bank an unlimited burst.
            b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * perSecond);
            b.at = t;
        }

        // Re-inserting makes the map insertion-ordered by recency, which is what lets the oldest
        // entry be the one evicted below.
        buckets.delete(key);
        buckets.set(key, b);
        if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);

        if (b.tokens < 1) {
            return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / perSecond) };
        }
        b.tokens -= 1;
        return { ok: true };
    }

    return { take, size: () => buckets.size };
}

/**
 * Express middleware around a limiter.
 *
 * Keyed by IP. That is the honest limit of what this can do: behind a proxy every caller may look
 * like one address, and a caller with many addresses looks like many callers. It is a brake on
 * accidents and casual abuse, not an access control - #41 covers the authentication that is.
 *
 * @param {ReturnType<typeof createRateLimiter>} limiter
 * @param {string} [what] named in the message, so a 429 says which limit was hit
 */
export function rateLimit(limiter, what = 'requests') {
    return (req, res, next) => {
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const r = limiter.take(key);
        if (r.ok) return next();
        res.setHeader('Retry-After', String(r.retryAfter));
        res.status(429).json({ error: `too many ${what}; retry in ${r.retryAfter}s` });
    };
}
