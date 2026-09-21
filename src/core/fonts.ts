// The fonts offered for text objects.

// Fonts offered for text objects, grouped by script because a flat list of twenty is harder to
// use than a short one.
//
// The CJK families cost less than their size suggests: Google Fonts serves them split by
// unicode-range, so the browser fetches only the subsets whose glyphs actually appear. Loading
// the app with no Japanese on screen downloads no Japanese.
export interface FontPreset { value: string; label: string; group: string }

export const FONT_PRESETS: FontPreset[] = [
    { value: 'sans-serif', label: 'Sans', group: 'Basic' },
    { value: 'serif', label: 'Serif', group: 'Basic' },
    { value: 'monospace', label: 'Mono', group: 'Basic' },

    { value: '"Pretendard", sans-serif', label: 'Pretendard', group: '한국어' },
    { value: '"Noto Sans KR", sans-serif', label: 'Noto Sans KR', group: '한국어' },
    { value: '"Nanum Gothic", sans-serif', label: 'Nanum Gothic', group: '한국어' },
    { value: '"Gowun Dodum", sans-serif', label: 'Gowun Dodum', group: '한국어' },
    { value: '"Noto Serif KR", serif', label: 'Noto Serif KR', group: '한국어' },
    { value: '"Malgun Gothic", sans-serif', label: 'Malgun Gothic', group: '한국어' },
    { value: '"Apple SD Gothic Neo", sans-serif', label: 'Apple SD Gothic Neo', group: '한국어' },

    // Gothic, mincho, two rounded weights, and one heavy face for titles.
    { value: '"Noto Sans JP", sans-serif', label: 'Noto Sans JP ゴシック', group: '日本語' },
    { value: '"Noto Serif JP", serif', label: 'Noto Serif JP 明朝', group: '日本語' },
    { value: '"Zen Maru Gothic", sans-serif', label: 'Zen Maru Gothic 丸ゴシック', group: '日本語' },
    { value: '"M PLUS Rounded 1c", sans-serif', label: 'M PLUS Rounded 1c', group: '日本語' },
    { value: '"Shippori Mincho", serif', label: 'Shippori Mincho しっぽり明朝', group: '日本語' },
    { value: '"Dela Gothic One", sans-serif', label: 'Dela Gothic One 太字', group: '日本語' },
    { value: '"Yusei Magic", sans-serif', label: 'Yusei Magic 手書き', group: '日本語' },

    { value: '"Anton", sans-serif', label: 'Anton', group: 'Display' },
    { value: '"Bebas Neue", sans-serif', label: 'Bebas Neue', group: 'Display' },
];

/**
 * The presets in the order they should appear, as [group, fonts] pairs.
 * @param {typeof FONT_PRESETS} [presets]
 * @returns {[string, typeof FONT_PRESETS][]}
 */
export function fontGroups(presets: readonly FontPreset[] = FONT_PRESETS): Array<[string, FontPreset[]]> {
    /** @type {[string, typeof FONT_PRESETS][]} */
    const out: Array<[string, FontPreset[]]> = [];
    for (const f of presets) {
        const name = f.group || '';
        const last = out[out.length - 1];
        if (last && last[0] === name) last[1].push(f);
        else out.push([name, [f]]);
    }
    return out;
}
