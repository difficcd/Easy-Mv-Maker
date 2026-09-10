import test from 'node:test';
import assert from 'node:assert/strict';
import { importedNames, unusedImports } from '../scripts/unused-imports.mjs';

const names = (src) => importedNames(src).map(i => i.name);
const unused = (src) => unusedImports(src).map(i => `${i.name}:${i.why}`);

test('a side-effect import is not swallowed into the next statement', () => {
    // The bug this caught on its first run: with a greedy clause, `import './App.css';` ran into
    // the import below it and the whole thing came back as one name called "'./App.css';\nimport".
    const src = `import './App.css';\nimport { a, b } from './x.js';\na(); b();\n`;
    assert.deepEqual(names(src), ['a', 'b']);
    assert.deepEqual(unused(src), []);
});

test('a default and named imports on one line are both seen', () => {
    const src = `import React, { useState } from 'react';\nReact; useState();\n`;
    assert.deepEqual(names(src), ['React', 'useState']);
});

test('a renamed import is checked under the name the file actually uses', () => {
    const used = `import { thing as other } from './x.js';\nother();\n`;
    assert.deepEqual(unused(used), []);
    const not = `import { thing as other } from './x.js';\nthing();\n`;
    assert.deepEqual(unused(not), ['other:never used']);
});

test('a namespace import counts as used when a member of it is', () => {
    assert.deepEqual(unused(`import * as fs from 'node:fs';\nfs.readFileSync('x');\n`), []);
});

test('the same name imported twice is reported even though it is used', () => {
    // This really happened: `setLayerClipped` had its own import line while the big cutsReducer
    // block already brought it in. Both were "used", so a plain usage check would say nothing.
    const src = `import { a, b } from './x.js';\nimport { a } from './x.js';\na(); b();\n`;
    assert.deepEqual(unused(src), ['a:imported twice']);
});

test('a name used only in a comment is left alone', () => {
    // A JSDoc @type is a real use as far as the typechecker is concerned, and prose is not worth
    // a false alarm.
    assert.deepEqual(unused(`import { Thing } from './x.js';\n/** @type {Thing} */\nlet v;\n`), []);
});

test('a module path that contains an imported name does not count as using it', () => {
    // `import { applyCamera } from './core/camera.js'` - the word camera is in the path.
    const src = `import { camera } from './core/camera.js';\nnothing();\n`;
    assert.deepEqual(unused(src), ['camera:never used']);
});

test('an unused name among used ones is picked out', () => {
    const src = `import { a, b, c } from './x.js';\na(); c();\n`;
    assert.deepEqual(unused(src), ['b:never used']);
});

test('a multi-line import clause is read', () => {
    const src = `import {\n    a,\n    b,\n} from './x.js';\na();\n`;
    assert.deepEqual(names(src), ['a', 'b']);
    assert.deepEqual(unused(src), ['b:never used']);
});

test('a name that only appears as part of a longer identifier is not a use', () => {
    assert.deepEqual(unused(`import { pad } from './x.js';\npadding();\n`), ['pad:never used']);
});
