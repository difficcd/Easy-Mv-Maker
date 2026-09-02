import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tr, setLangValue, getLang, LANGS } from '../src/i18n.js';
import { JA } from '../src/i18n.ja.js';

const HANGUL = /[가-힣]/;

/**
 * The English dictionary is the authority on what keys exist; read it out of the source.
 *
 * The escapes are undone because the source holds `\n` as two characters while the module the
 * JS engine loaded holds one - three keys carry a newline, and comparing the two forms without
 * this reports them as orphans that do not exist.
 */
function englishKeys() {
    const src = readFileSync('src/i18n.js', 'utf8');
    const body = src.slice(src.indexOf('const EN = {'));
    return [...body.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)]
        .map(m => m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

test('the three languages are the ones the switch offers', () => {
    assert.deepEqual(LANGS, ['en', 'ko', 'ja']);
});

test('an unknown language falls back to English rather than being stored', () => {
    setLangValue('fr');
    assert.equal(getLang(), 'en');
    setLangValue('ja');
    assert.equal(getLang(), 'ja');
});

test('Japanese mode never shows Korean for a string the dictionary has a key for', () => {
    setLangValue('ja');
    const leaking = englishKeys().filter(k => HANGUL.test(k) && HANGUL.test(tr(k)));
    assert.deepEqual(leaking, [], 'these come out Korean in the Japanese UI');
});

test('a padded key is served by the trimmed entry, with the padding kept', () => {
    setLangValue('ja');
    const out = tr('삭제 실패: ');
    assert.ok(out.endsWith(' '), `padding lost: ${JSON.stringify(out)}`);
    assert.ok(!HANGUL.test(out), out);
});

test('placeholders survive translation', () => {
    setLangValue('ja');
    assert.equal(tr('{0}컷', 7), '7カット');
    assert.match(tr('팔레트 {0}', 3), /3/);
});

test('a string in neither dictionary comes back as it went in', () => {
    setLangValue('ja');
    assert.equal(tr('이건 사전에 없는 문장입니다'), '이건 사전에 없는 문장입니다');
});

test('Korean mode does no lookup at all', () => {
    setLangValue('ko');
    assert.equal(tr('펜'), '펜');
});

test('English is unaffected by the Japanese dictionary', () => {
    setLangValue('en');
    assert.equal(tr('펜'), 'Pen');
});

test('every Japanese entry is a key English also has', () => {
    const en = new Set(englishKeys());
    const trimmed = new Set([...en].map(k => k.trim()));
    const orphans = Object.keys(JA).filter(k => !en.has(k) && !trimmed.has(k));
    assert.deepEqual(orphans, []);
});

test('no Japanese value was left as the Korean it was copied from', () => {
    const untranslated = Object.entries(JA)
        .filter(([k, v]) => HANGUL.test(v) && v === k)
        .map(([k]) => k);
    assert.deepEqual(untranslated, []);
});
