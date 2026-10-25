import test from 'node:test';
import assert from 'node:assert/strict';
import { folderName, parentFolder, joinFolder, childFolders, projectsIn, crumbs, canMoveFolder, normFolder, movePath, removedPath, withAncestors } from '../../src/core/projectFolders.ts';

const folders = ['Songs', 'Songs/Chorus', 'Songs/Chorus/Take 2', 'Songs/Bridge', 'Practice', 'Practicebook'];

test('a folder shows only what is directly inside it', () => {
    assert.deepEqual(childFolders(folders, ''), ['Practice', 'Practicebook', 'Songs']);
    assert.deepEqual(childFolders(folders, 'Songs'), ['Songs/Bridge', 'Songs/Chorus']);
    assert.deepEqual(childFolders(folders, 'Practice'), [], 'a folder whose name starts the same is not inside');
});

test('projects are listed in their own folder only', () => {
    const ps = [{ id: 'a', folder: '' }, { id: 'b', folder: 'Songs' }, { id: 'c' }, { id: 'd', folder: 'Songs/Chorus' }];
    assert.deepEqual(projectsIn(ps, '').map(p => p.id), ['a', 'c']);
    assert.deepEqual(projectsIn(ps, 'Songs').map(p => p.id), ['b']);
});

test('the trail runs from the top to the open folder', () => {
    assert.deepEqual(crumbs(''), [{ name: '', path: '' }]);
    assert.deepEqual(crumbs('Songs/Chorus').map(c => c.path), ['', 'Songs', 'Songs/Chorus']);
});

test('names and parents', () => {
    assert.equal(folderName('Songs/Chorus'), 'Chorus');
    assert.equal(parentFolder('Songs/Chorus'), 'Songs');
    assert.equal(parentFolder('Songs'), '');
    assert.equal(joinFolder('', 'A'), 'A');
    assert.equal(joinFolder('A', 'B'), 'A/B');
});

test('a folder cannot move into itself, under itself, or where it already is', () => {
    assert.equal(canMoveFolder('Songs', 'Songs'), false);
    assert.equal(canMoveFolder('Songs', 'Songs/Chorus'), false);
    assert.equal(canMoveFolder('Songs/Chorus', 'Songs'), false);
    assert.equal(canMoveFolder('Songs/Chorus', ''), true);
    assert.equal(canMoveFolder('Songs', 'Practice'), true);
});

test('the browser storage folders move the way the server ones do', () => {
    assert.equal(normFolder(' Songs / ../Chorus '), 'Songs/Chorus');
    assert.equal(normFolder(null), '');
    assert.equal(movePath('a/b/c', 'a/b', 'x'), 'x/c');
    assert.equal(movePath('a/bc', 'a/b', 'x'), 'a/bc');
    assert.equal(removedPath('a/b/c', 'a/b'), 'a/c');
    assert.equal(removedPath('a', 'a'), '');
    assert.deepEqual(withAncestors(['a/b']), ['a', 'a/b']);
});
