import test from 'node:test';
import assert from 'node:assert/strict';
import { unnamed } from '../../scripts/architecture-index.mjs';

// On 2026-10-14 the map was missing 44 of the 152 files under src/. These pin down what "named"
// means, because a loose reading is how the drift was undercounted in the first place: a grep for
// the bare word found 34 missing, since "zip" and "camera" appear in prose without the files
// ever being named.

test('a file named in backticks is named', () => {
    assert.deepEqual(unnamed('- `layerOps.ts` — layer tree', ['src/core/layerOps.ts']), []);
});

test('a file mentioned only as a word in prose is not named', () => {
    // The export folder was described as "zip, gif, the recorder" and none of its files appeared.
    assert.deepEqual(unnamed('export/ turning the timeline into a file: zip, gif, the recorder.', ['src/export/zip.ts']), ['src/export/zip.ts']);
});

test('several names in one span, and paths, all count', () => {
    const doc = '- `frameExport.ts` / `exportQueue.ts` — sizes\n- `src/App.tsx` — the component\n`a.ts/b.ts`';
    assert.deepEqual(unnamed(doc, ['src/core/frameExport.ts', 'src/core/exportQueue.ts', 'src/App.tsx', 'src/x/a.ts', 'src/x/b.ts']), []);
});

test('a declaration file is named by its full name', () => {
    assert.deepEqual(unnamed('- `src/globals.d.ts` — vendor globals', ['src/globals.d.ts']), []);
    assert.deepEqual(unnamed('- `globals` — vendor globals', ['src/globals.d.ts']), ['src/globals.d.ts']);
});

test('the extension is part of the name', () => {
    // `App.jsx` in an old line does not cover App.tsx - that is exactly the stale reference the
    // map is supposed to stop carrying.
    assert.deepEqual(unnamed('- `App.jsx`', ['src/App.tsx']), ['src/App.tsx']);
});
