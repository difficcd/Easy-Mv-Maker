import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, rateLimit } from '../server/rateLimit.js';

/** A clock the test moves by hand, so none of this is a race. */
function clock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

test('the burst is the capacity, and then it refuses', () => {
    const c = clock();
    const l = createRateLimiter({ capacity: 3, perSecond: 1, now: c.now });
    for (let i = 0; i < 3; i++) assert.equal(l.take('a').ok, true, `call ${i}`);
    assert.equal(l.take('a').ok, false);
});

test('the allowance comes back over time', () => {
    const c = clock();
    const l = createRateLimiter({ capacity: 2, perSecond: 2, now: c.now });
    l.take('a'); l.take('a');
    assert.equal(l.take('a').ok, false);

    c.advance(500);                       // half a second at two per second = one token
    assert.equal(l.take('a').ok, true);
    assert.equal(l.take('a').ok, false);
});

test('an idle caller comes back to a full bucket and no more', () => {
    // Otherwise a long absence banks an unlimited burst, which is the thing a limiter exists to
    // prevent happening all at once.
    const c = clock();
    const l = createRateLimiter({ capacity: 3, perSecond: 1, now: c.now });
    l.take('a'); l.take('a'); l.take('a');

    c.advance(60 * 60 * 1000);            // an hour
    for (let i = 0; i < 3; i++) assert.equal(l.take('a').ok, true, `call ${i}`);
    assert.equal(l.take('a').ok, false, 'banked more than the capacity');
});

test('a bucket rather than a fixed window: no double burst at the boundary', () => {
    // A fixed window lets a caller spend the whole allowance at the end of one window and again
    // at the start of the next. Over any two seconds here, the total stays within capacity plus
    // what actually refilled.
    const c = clock();
    const l = createRateLimiter({ capacity: 5, perSecond: 5, now: c.now });
    let served = 0;
    for (let ms = 0; ms < 2000; ms += 50) {
        c.advance(50);
        if (l.take('a').ok) served++;
    }
    assert.ok(served <= 5 + 10 + 1, `served ${served} in two seconds`);
});

test('callers are counted separately', () => {
    const c = clock();
    const l = createRateLimiter({ capacity: 1, perSecond: 1, now: c.now });
    assert.equal(l.take('a').ok, true);
    assert.equal(l.take('b').ok, true);
    assert.equal(l.take('a').ok, false);
    assert.equal(l.take('b').ok, false);
});

test('retryAfter is a whole number of seconds and never zero', () => {
    const c = clock();
    const l = createRateLimiter({ capacity: 1, perSecond: 0.5, now: c.now });
    l.take('a');
    const r = l.take('a');
    assert.equal(r.ok, false);
    assert.ok(Number.isInteger(r.retryAfter) && r.retryAfter >= 1, `got ${r.retryAfter}`);
});

test('the table of callers cannot itself be used to exhaust memory', () => {
    // Without eviction, one request per forged address is a memory leak with a request behind it.
    const c = clock();
    const l = createRateLimiter({ capacity: 1, perSecond: 1, now: c.now, maxKeys: 10 });
    for (let i = 0; i < 500; i++) l.take('ip-' + i);
    assert.ok(l.size() <= 10, `held ${l.size()} entries`);
});

test('eviction drops the least recently seen, not the newest', () => {
    const c = clock();
    const l = createRateLimiter({ capacity: 1, perSecond: 0.001, now: c.now, maxKeys: 2 });
    l.take('old');
    l.take('mid');
    l.take('new');                        // evicts 'old'
    // 'new' is still known and out of tokens; 'old' was forgotten and starts fresh.
    assert.equal(l.take('new').ok, false);
    assert.equal(l.take('old').ok, true);
});

test('the middleware passes a request through and refuses the next', () => {
    const c = clock();
    const mw = rateLimit(createRateLimiter({ capacity: 1, perSecond: 1, now: c.now }), 'uploads');

    const res = () => {
        const o = { code: 0, headers: {}, body: null };
        o.setHeader = (k, v) => { o.headers[k] = v; };
        o.status = (s) => { o.code = s; return o; };
        o.json = (b) => { o.body = b; return o; };
        return o;
    };

    let passed = 0;
    const r1 = res();
    mw({ ip: '1.1.1.1' }, r1, () => passed++);
    assert.equal(passed, 1);
    assert.equal(r1.code, 0);

    const r2 = res();
    mw({ ip: '1.1.1.1' }, r2, () => passed++);
    assert.equal(passed, 1, 'let a second request through');
    assert.equal(r2.code, 429);
    assert.ok(r2.headers['Retry-After'], 'no Retry-After header');
    assert.match(r2.body.error, /uploads/);
});

test('the middleware still keys something when there is no address', () => {
    const c = clock();
    const mw = rateLimit(createRateLimiter({ capacity: 1, perSecond: 1, now: c.now }));
    let passed = 0;
    const res = { setHeader() { }, status() { return this; }, json() { return this; } };
    mw({ socket: {} }, res, () => passed++);
    mw({ socket: {} }, res, () => passed++);
    assert.equal(passed, 1);
});
