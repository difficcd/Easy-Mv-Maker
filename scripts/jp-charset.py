"""Write out the characters the bundled Japanese fonts are subset to.

Derived rather than typed. JIS X 0208 arranges characters in 94 rows of 94 cells, and in EUC-JP
a row/cell pair is simply (0xA0+row, 0xA0+cell) - so the set can be enumerated by decoding, which
is exact and needs no table to be kept up to date.

  rows 1-8    punctuation, digits, Latin, kana, Greek, Cyrillic, box drawing
  rows 16-47  level 1 kanji, ~2965 of them, ordered by reading

Level 2 (rows 48-84) is the rare half: mostly names and classical text. Leaving it out is what
keeps the bundle to a size an APK can carry, and the CDN families are still there online.

ASCII is added on top because a subset without it cannot render a Latin word inside a Japanese
line, which lyrics do constantly.

    python scripts/jp-charset.py build/jp-charset.txt
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

chars = []
chars += [chr(c) for c in range(0x20, 0x7F)]          # ASCII
chars += jis_rows(range(1, 9))                        # symbols, kana, Greek, Cyrillic
chars += jis_rows(range(16, 48))                      # level 1 kanji
chars += ['…', '─', '　']               # ellipsis, rule, ideographic space

seen, unique = set(), []
for ch in chars:
    if ch not in seen:
        seen.add(ch)
        unique.append(ch)

path = sys.argv[1] if len(sys.argv) > 1 else 'build/jp-charset.txt'
io.open(path, 'w', encoding='utf-8', newline='\n').write(''.join(unique))
kanji = sum(1 for ch in unique if '一' <= ch <= '鿿')
print('%d characters (%d kanji) -> %s' % (len(unique), kanji, path))
