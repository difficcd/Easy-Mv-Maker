// App-level names that nothing ever reaches.
//
// The other checks here answer "is this written down" - helper-index, i18n. This one answers "is
// this reached", which is a different question and catches a different thing: a feature taken out
// of the UI and left behind in the component.
//
// The naive version of this asks whether a name is mentioned anywhere else, and it is not enough.
// The palette feature was nine names - two pieces of state and seven functions - and every one of
// them was mentioned, by its siblings. Six functions referring to each other look busy and are
// dead, and a scan built on mentions cannot tell the difference.
//
// So: reachability. The roots are the things the app runs on its own - the JSX it returns, the
// bodies of its effects, and the arguments it hands to its hooks. Anything not reachable from a
// root by a chain of references is dead, however many times it appears.
//
// Deliberately only App.jsx. It is the file where this happens, because it is the file big enough
// to lose something in; the extracted hooks are small enough that a dead name in one is visible.

import { readFileSync } from 'node:fs';

const FILE = 'src/App.jsx';
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

const bodyAt = lines.findIndex(l => l.startsWith('export default function App()'));
const retAt = lines.findIndex((l, i) => i > bodyAt && /^ {4}return \(/.test(l));
if (bodyAt < 0 || retAt < 0) {
    console.error(`${FILE}: could not find the App component's body. This check needs updating.`);
    process.exit(1);
}

/** The line a name is defined on, for every name defined at the top level of App(). */
const owner = new Map();
const defLines = [];
for (let i = bodyAt; i < retAt; i++) {
    const pair = /^ {4}const \[(\w+), (\w+)\] = /.exec(lines[i]);
    if (pair) {
        owner.set(pair[1], i); owner.set(pair[2], i); defLines.push(i); continue;
    }
    const one = /^ {4}(?:const|let|function) (\w+)/.exec(lines[i]);
    if (one) { owner.set(one[1], i); defLines.push(i); }
}

/** Where a top-level statement beginning at `start` ends: at the next one, or at the return. */
const spans = new Map();
const starts = [...new Set(defLines)].sort((a, b) => a - b);
starts.forEach((s, k) => spans.set(s, [s, k + 1 < starts.length ? starts[k + 1] : retAt]));

const names = [...owner.keys()];
const mentioned = (text) => names.filter(n => new RegExp(`\\b${n}\\b`).test(text));

// What each definition refers to.
const refs = new Map();
for (const [name, at] of owner) {
    const [a, b] = spans.get(at);
    refs.set(name, new Set(mentioned(lines.slice(a, b).join('\n')).filter(n => n !== name)));
}

// The roots. Three kinds, and the last two are why a naive version reports live names as dead:
//   - the JSX, which is everything the component actually renders
//   - the body of an effect, which React runs whether or not anything refers to it
//   - the arguments of a hook call, which the hook consumes. `const {a} = useThing({b})` defines
//     a and *uses* b, so the right-hand side is a root even though the line is a definition.
let rootText = lines.slice(retAt).join('\n');
for (let i = bodyAt; i < retAt; i++) {
    const isEffect = /^ {4}use(?:Layout)?Effect\(/.test(lines[i]);
    const isHookCall = spans.has(i) && /=\s*use[A-Z]\w*\(/.test(
        lines.slice(...spans.get(i)).join('\n'));
    if (!isEffect && !isHookCall) continue;
    const [a, b] = spans.get(i) ?? [i, nextTopLevel(i)];
    const text = lines.slice(a, b).join('\n');
    // For a hook call, only the arguments are a root - not the names it defines. `useState` is
    // a hook too, so taking the whole line would make every piece of state a root of itself,
    // and then no state could ever be reported. Everything up to the first `=` is the
    // left-hand side, and it is the part to leave out.
    rootText += '\n' + (isHookCall ? text.slice(text.indexOf('=') + 1) : text);
}

/** For an effect, which is not a definition: the next top-level statement after `i`. */
function nextTopLevel(i) {
    for (const s of starts) if (s > i) return s;
    return retAt;
}

const reached = new Set();
const queue = mentioned(rootText);
while (queue.length) {
    const n = queue.pop();
    if (reached.has(n) || !refs.has(n)) continue;
    reached.add(n);
    for (const m of refs.get(n)) if (!reached.has(m)) queue.push(m);
}

const dead = names.filter(n => !reached.has(n)).sort((a, b) => owner.get(a) - owner.get(b));
if (!dead.length) {
    console.log(`Reachability passed - all ${names.length} App-level names are reached.`);
    process.exit(0);
}

const byLine = new Map();
for (const n of dead) {
    const at = owner.get(n);
    byLine.set(at, [...(byLine.get(at) ?? []), n]);
}
console.error(`${dead.length} App-level name(s) that nothing reaches:\n`);
for (const [at, group] of [...byLine].sort((a, b) => a[0] - b[0])) {
    console.error(`  ${FILE}:${at + 1}  ${group.join(', ')}`);
}
console.error(`
Reached means: used by the JSX, by an effect, or by something that is itself reached.
A group that only refers to itself is dead however busy it looks - that is how a palette
feature survived being taken out of the colour panel.

If one of these is genuinely live, this check is wrong about how it is reached; say so here
rather than working around it.`);
process.exit(1);
