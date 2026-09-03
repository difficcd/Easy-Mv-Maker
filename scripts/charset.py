"""Write out the characters a bundled face is subset to.

Derived rather than typed, so the sets can be checked by reading this file instead of trusted.

    python scripts/charset.py ja build/fonts/ja.txt
    python scripts/charset.py ko build/fonts/ko.txt

Japanese takes JIS X 0208, which arranges characters in 94 rows of 94 cells; in EUC-JP a row/cell
pair is simply (0xA0+row, 0xA0+cell), so the set can be enumerated by decoding.

  rows 1-8    punctuation, digits, Latin, kana, Greek, Cyrillic, box drawing
  rows 16-47  level 1 kanji, ~2965 of them

Level 2 (rows 48-84) is the rare half - mostly names and classical text - and leaving it out is
what keeps the bundle to a size an APK can carry.

Korean takes the whole modern syllable block rather than a classic subset. There are 11,172 of
them and they cost about a megabyte a face, which is affordable; picking a subset would mean
guessing which syllables a lyric uses, and being wrong shows up as one missing glyph in the
middle of a word.

ASCII is in both, because a subset without it cannot render a Latin word inside a line, which
lyrics do constantly.
"""
import io
import sys


def jis_rows(rows):
    out = []
    for row in rows:
        for cell in range(1, 95):
            try:
                out.append(bytes([0xA0 + row, 0xA0 + cell]).decode('euc_jp'))
            except UnicodeDecodeError:
                pass          # not every cell in a row is assigned
    return out


def japanese():
    chars = [chr(c) for c in range(0x20, 0x7F)]
    chars += jis_rows(range(1, 9))
    chars += jis_rows(range(16, 48))
    chars += ['…', '─', '　']
    return chars


def korean():
    chars = [chr(c) for c in range(0x20, 0x7F)]
    chars += [chr(c) for c in range(0x3000, 0x3040)]      # CJK punctuation
    chars += [chr(c) for c in range(0x3130, 0x3190)]      # compatibility jamo
    chars += [chr(c) for c in range(0xAC00, 0xD7A4)]      # every modern syllable
    chars += [chr(c) for c in range(0xFF01, 0xFF61)]      # fullwidth forms
    chars += list('…—–·※「」『』〈〉《》')
    return chars


SETS = {'ja': japanese, 'ko': korean}

lang = sys.argv[1]
if lang not in SETS:
    raise SystemExit('unknown language %r; expected one of %s' % (lang, ', '.join(SETS)))
path = sys.argv[2]

unique = list(dict.fromkeys(SETS[lang]()))
io.open(path, 'w', encoding='utf-8', newline='\n').write(''.join(unique))

kanji = sum(1 for ch in unique if '一' <= ch <= '鿿')
hangul = sum(1 for ch in unique if '가' <= ch <= '힣')
detail = ('%d kanji' % kanji) if lang == 'ja' else ('%d hangul syllables' % hangul)
print('%s: %d characters (%s) -> %s' % (lang, len(unique), detail, path))
