"""What App.jsx is actually made of, by concern.

The question is not "is it long" - it is "how many separate jobs is it doing, and does any one of
them touch things the others do not". A concern whose state and handlers are only used by each
other can leave. One threaded through everything cannot, however much anyone would like it to.
"""
import io, re, collections

src = io.open('src/App.jsx', encoding='utf-8').read()
lines = src.split('\n')

# where the component body starts and the JSX return begins
body_start = next(i for i, l in enumerate(lines) if l.startswith('export default function App()'))
ret = next(i for i, l in enumerate(lines) if i > body_start and re.match(r'^\s{4}return \(', l))

print('App.jsx: %d lines total' % len(lines))
print('  module scope (imports, constants, small components): 1-%d' % body_start)
print('  App() logic:  %d-%d   (%d lines)' % (body_start + 1, ret, ret - body_start))
print('  App() JSX:    %d-%d   (%d lines)' % (ret + 1, len(lines), len(lines) - ret))

logic = '\n'.join(lines[body_start:ret])

state = re.findall(r'const \[(\w+), (\w+)\] = use(?:State|Stored|Reducer)\(', logic)
refs = re.findall(r'const (\w+) = useRef\(', logic)
effects = len(re.findall(r'use(?:Layout)?Effect\(', logic))
memos = len(re.findall(r'useMemo\(|useCallback\(', logic))
handlers = re.findall(r'^    const (\w+) = (?:async )?\(', logic, re.M)
hooks_used = re.findall(r'= use([A-Z]\w+)\(', logic)

print('\n  %d useState/useStored/useReducer, %d useRef, %d effects, %d memo/callback'
      % (len(state), len(refs), effects, memos))
print('  %d arrow-function definitions at the top level of App()' % len(handlers))
print('  custom hooks already extracted: %s'
      % ', '.join(sorted({h for h in hooks_used if h not in ('State', 'Ref', 'Memo', 'Effect', 'Callback', 'Reducer')})))

# --- group names by concern, by keyword -----------------------------------------------------
CONCERNS = {
    'video import / overlay': r'video|scene|frameDecode|prefetch|batch',
    'server + backup': r'server|backup|api|upload|asset',
    'local files + tabs': r'file|tab|local|autosave|restore|buildData|doSave|doOpen',
    'drawing + strokes': r'stroke|draw|brush|eraser|pressure|live|lasso|selection|mosaic|fill|curve|ruler',
    'text': r'text|font',
    'timeline + playback': r'time|play|pps|scrub|marquee|track|loop|part',
    'cuts + layers': r'cut|layer|onion|tween|clip',
    'panels + view': r'panel|dock|splitter|zoom|pan|view|width|left|right|show|color|theme|ui',
    'export': r'export|gif|record|transparent',
}
names = [v for v, _ in state] + refs + handlers
buckets = collections.Counter()
unmatched = []
for n in names:
    hit = [c for c, pat in CONCERNS.items() if re.search(pat, n, re.I)]
    if hit:
        buckets[hit[0]] += 1
    else:
        unmatched.append(n)

print('\n  names by concern (first match wins, so this is a rough shape not a partition):')
for c, n in buckets.most_common():
    print('    %-26s %3d' % (c, n))
print('    %-26s %3d  %s' % ('(no keyword matched)', len(unmatched), ', '.join(unmatched[:12])))
