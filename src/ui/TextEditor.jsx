import React from 'react';
import { tr } from '../i18n';
import { NumField } from './NumField';
import { FONT_PRESETS, fontGroups, TEXT_ANIM_DEFAULT } from '../canvas/canvasUtils';

/**
 * The text editor, which is a tab in the cut panel rather than a window over the canvas.
 *
 * It came out of App.jsx as a whole: nothing in here needs app state beyond the text being
 * edited and the two ways of finishing with it, so it is a component in the ordinary sense
 * rather than a block that happened to live in a big file.
 *
 * @param {object} props
 * @param {any} props.textEdit the text being edited, or null when the editor is closed
 * @param {(fn: (te: any) => any) => void} props.setTextEdit
 * @param {React.RefObject<HTMLTextAreaElement>} props.textAreaRef focus goes here on open
 * @param {() => void} props.commitText
 * @param {() => void} props.cancelText
 */
export function TextEditor({ textEdit, setTextEdit, textAreaRef, commitText, cancelText }) {
    if (!textEdit) return null;
    // Every control changed one field of the text being edited, and every one of them wrote out
    // the spread and the null guard again - twenty-four copies of the same three tokens, each an
    // opportunity to guard the wrong thing or drop the guard entirely.
    //
    // It takes a function as well as an object, because four of the controls toggle a field and
    // so have to read what it was. Passing the object would have meant those four keeping the
    // long form, and a helper that covers most of the cases is the kind that gets forgotten.
    const patch = (o) => setTextEdit(te => (te ? { ...te, ...(typeof o === 'function' ? o(te) : o) } : te));
    return (
        <div className="text-panel-body">
            <textarea
                ref={textAreaRef}
                value={textEdit.text}
                onChange={e => patch({ text: e.target.value })}
                onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelText(); }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commitText(); }
                }}
                placeholder={tr('텍스트 입력 (Ctrl+Enter 완료, Esc 취소)')}
            />
            <div className="text-editor-row">
                <div className="te-section">{tr('글꼴')}</div>
                <label className="text-editor-label">Size</label>
                {/* No range at all while editing - not per keystroke, and not
                    on blur either. Any clamp during editing makes 100
                    unreachable: "1" becomes 6 before the zeros arrive, and
                    clamping when the field is left does the same thing a
                    keystroke later if focus moves between digits. The size is
                    held to 6..400 where it is used instead - textRender clamps
                    for drawing, and commitText clamps what gets saved. */}
                <NumField
                    value={textEdit.fontSize}
                    onChange={v => patch({ fontSize: v })}
                    className="text-editor-num"
                />
                {(() => {
                    const isPreset = FONT_PRESETS.some(f => f.value === textEdit.fontFamily);
                    return (
                        <>
                            <select
                                className="text-editor-font"
                                value={isPreset ? textEdit.fontFamily : '__custom__'}
                                onChange={e => {
                                    const v = e.target.value;
                                    patch(te => ({ fontFamily: v === '__custom__' ? (te.fontFamily || 'sans-serif') : v }));
                                }}
                                title={tr('폰트')}
                            >
                                <option value="__custom__">Custom</option>
                                {/* Grouped by script: a flat list of twenty
                                    is harder to use than a short one. Each
                                    option previews its own face. */}
                                {fontGroups().map(([group, fonts]) => (
                                    <optgroup key={group} label={group}>
                                        {fonts.map(f => (
                                            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            {!isPreset && (
                                <input
                                    className="text-editor-font"
                                    value={textEdit.fontFamily}
                                    onChange={e => patch({ fontFamily: e.target.value })}
                                    placeholder="Custom font-family"
                                    title={tr('커스텀 폰트')}
                                />
                            )}
                        </>
                    );
                })()}
                <input
                    type="color"
                    value={textEdit.color}
                    onChange={e => patch({ color: e.target.value })}
                    className="text-editor-color"
                    title={tr('색상')}
                />
                <button className="button" title={tr('굵게')} onClick={() => patch(te => ({ bold: !te.bold }))}
                    style={{ height: 26, width: 28, padding: 0, fontWeight: 800, background: textEdit.bold ? 'hsl(var(--ui-h) var(--ui-s) 29%)' : undefined }}>B</button>
                <button className="button" title={tr('기울임')} onClick={() => patch(te => ({ italic: !te.italic }))}
                    style={{ height: 26, width: 28, padding: 0, fontStyle: 'italic', background: textEdit.italic ? 'hsl(var(--ui-h) var(--ui-s) 29%)' : undefined }}>I</button>
                <select className="time-input" style={{ width: 52 }} title={tr('정렬')} value={textEdit.align || 'left'}
                    onChange={e => patch({ align: e.target.value })}>
                    <option value="left">◧</option><option value="center">▣</option><option value="right">◨</option>
                </select>
                <select className="time-input" style={{ width: 54 }} title={tr('줄간격')} value={textEdit.lineHeight ?? 1.25}
                    onChange={e => patch({ lineHeight: +e.target.value })}>
                    {[1, 1.15, 1.25, 1.5, 1.8, 2].map(v => <option key={v} value={v}>{v}x</option>)}
                </select>
                <select className="time-input" style={{ width: 58 }} title={tr('자간(글자 간격)')} value={textEdit.letterSpacing ?? 0}
                    onChange={e => patch({ letterSpacing: +e.target.value })}>
                    {[-2, 0, 1, 2, 4, 8, 12].map(v => <option key={v} value={v}>{tr('자간')}{v}</option>)}
                </select>
                <div className="te-section">{tr('효과')}</div>
                <label className="te-check" title={tr('가독성용 외곽선')}>
                    <input type="checkbox" checked={!!textEdit.outline} onChange={e => patch({ outline: e.target.checked })} />{tr('테두리')}
                </label>
                {textEdit.outline && <input type="color" value={textEdit.outlineColor || '#ffffff'} onChange={e => patch({ outlineColor: e.target.value })} className="text-editor-color" title={tr('테두리 색')} />}
                <label className="te-check" title={tr('그림자')}>
                    <input type="checkbox" checked={!!textEdit.shadow} onChange={e => patch({ shadow: e.target.checked })} />{tr('그림자')}
                </label>
                {textEdit.shadow && <input type="color" value={(textEdit.shadowColor || '#000000').startsWith('#') ? textEdit.shadowColor : '#000000'} onChange={e => patch({ shadowColor: e.target.value })} className="text-editor-color" title={tr('그림자 색')} />}
                <label className="te-check" title={tr('위→아래 2색 그라데이션')}>
                    <input type="checkbox" checked={!!textEdit.gradient} onChange={e => patch({ gradient: e.target.checked })} />{tr('그라데이션')}
                </label>
                {textEdit.gradient && <input type="color" value={textEdit.color2 || '#ffffff'} onChange={e => patch({ color2: e.target.value })} className="text-editor-color" title={tr('그라데이션 끝 색')} />}
                <label className="te-check" title={tr('글자 뒤 배경 박스')}>
                    <input type="checkbox" checked={!!textEdit.bgColor} onChange={e => patch(te => ({ bgColor: e.target.checked ? (te.bgColor || '#ffffff') : '' }))} />{tr('배경')}
                </label>
                {textEdit.bgColor && <input type="color" value={textEdit.bgColor.startsWith('#') ? textEdit.bgColor : '#ffffff'} onChange={e => patch({ bgColor: e.target.value })} className="text-editor-color" title={tr('배경 색')} />}
                <NumField className="time-input" width={54} title={tr('회전(도)')} value={textEdit.rotation ?? 0} step={5}
                    onChange={v => patch({ rotation: v })} />
                <NumField className="time-input" width={54} title={tr('곡률(도) — 양수는 위로 휩니다')} value={textEdit.curve ?? 0} step={10}
                    onChange={v => patch({ curve: Math.max(-180, Math.min(180, v)) })} />
                <label className="te-check" title={tr('좌우 반전')}>
                    <input type="checkbox" checked={!!textEdit.flipX} onChange={e => patch({ flipX: e.target.checked })} />{tr('좌우뒤집기')}
                </label>
                <label className="te-check" title={tr('상하 반전')}>
                    <input type="checkbox" checked={!!textEdit.flipY} onChange={e => patch({ flipY: e.target.checked })} />{tr('상하뒤집기')}
                </label>
                {/* Text animation, visible only during playback. */}
                {(() => {
                    const an = { ...TEXT_ANIM_DEFAULT, ...(textEdit.anim || {}) };
                    const on = !!textEdit.anim;
                    const set = (o) => patch({ anim: { ...an, ...o } });
                    return (<>
                        <div className="te-section">{tr('애니메이션')}</div>
                        <label className="te-check" title={tr('재생할 때만 적용됩니다')}>
                            <input type="checkbox" checked={on}
                                onChange={e => patch({ anim: e.target.checked ? { ...TEXT_ANIM_DEFAULT } : null })} />{tr('애니메이션')}
                        </label>
                        {on && <>
                            <select className="time-input" style={{ width: 74 }} title={tr('등장')} value={an.inType} onChange={e => set({ inType: e.target.value })}>
                                <option value="none">{tr('등장없음')}</option><option value="fade">{tr('페이드')}</option><option value="up">{tr('아래→위')}</option>
                                <option value="down">{tr('위→아래')}</option><option value="scale">{tr('확대')}</option><option value="blur">{tr('흐림')}</option>
                            </select>
                            <select className="time-input" style={{ width: 74 }} title={tr('퇴장')} value={an.outType} onChange={e => set({ outType: e.target.value })}>
                                <option value="none">{tr('퇴장없음')}</option><option value="fade">{tr('페이드')}</option><option value="up">{tr('위로')}</option>
                                <option value="down">{tr('아래로')}</option><option value="scale">{tr('축소')}</option><option value="blur">{tr('흐림')}</option>
                            </select>
                            {/* A stagger is a modifier: it needs an entrance or a letter effect to
                                spread, and typing overrides it entirely. Offering it when it can do
                                nothing is what made the whole feature look broken. */}
                            {!an.typing && (an.inType !== 'none' || an.outType !== 'none' || (an.charFx ?? 'none') !== 'none') &&
                            <select className="time-input" style={{ width: 92 }} title={tr('글자 하나씩 — 등장/퇴장이 글자마다 차례로 일어납니다')} value={an.charStagger ?? 0}
                                onChange={e => set({ charStagger: +e.target.value })}>
                                <option value="0">{tr('통째로')}</option><option value="0.4">{tr('글자별 약하게')}</option>
                                <option value="0.7">{tr('글자별')}</option><option value="0.9">{tr('글자별 크게')}</option>
                            </select>}
                            <select className="time-input" style={{ width: 74 }} title={tr('계속 반복되는 강조')} value={an.emphasis} onChange={e => set({ emphasis: e.target.value })}>
                                <option value="none">{tr('강조없음')}</option><option value="pulse">{tr('두근두근')}</option><option value="shake">{tr('흔들기')}</option><option value="swing">{tr('갸우뚱')}</option>
                            </select>
                            {an.emphasis !== 'none' && <>
                                <input type="number" className="time-input" style={{ width: 50 }} title={tr('강조 세기')} value={an.emAmount} step={5} min={0}
                                    onChange={e => set({ emAmount: Math.max(0, +e.target.value || 0) })} />
                                <input type="number" className="time-input" style={{ width: 50 }} title={tr('강조 속도')} value={an.emSpeed} step={0.5} min={0}
                                    onChange={e => set({ emSpeed: Math.max(0, +e.target.value || 0) })} />
                            </>}
                            <label className="te-check" title={tr('한 글자씩 나타남 — 등장 효과를 고르면 글자마다 그 효과로 들어옵니다')}>
                                <input type="checkbox" checked={!!an.typing} onChange={e => set({ typing: e.target.checked })} />{tr('타이핑')}
                            </label>
                            {an.typing && <input type="number" className="time-input" style={{ width: 56 }} title={tr('초당 글자수')} value={an.typeSpeed} step={2} min={1}
                                onChange={e => set({ typeSpeed: Math.max(1, +e.target.value || 1) })} />}
                            {/* Its own control rather than a modifier on the entrance: this is an
                                entrance in itself, and needing to pick a second one as well was
                                why ticking only 'typing' looked like it did nothing. */}
                            <select className="time-input" style={{ width: 96 }} title={tr('글자마다 따로 — 각 글자가 저마다 다른 곳에서 들어옵니다')} value={an.charFx ?? 'none'}
                                onChange={e => set({ charFx: e.target.value })}>
                                <option value="none">{tr('글자효과없음')}</option><option value="scatter">{tr('흩어져 모임')}</option>
                                <option value="drop">{tr('하나씩 떨어짐')}</option><option value="zigzag">{tr('위아래 번갈아')}</option>
                                <option value="spin">{tr('돌면서')}</option><option value="pop">{tr('톡톡 튀어나옴')}</option>
                            </select>
                            {(an.charFx ?? 'none') !== 'none' && <input type="number" className="time-input" style={{ width: 56 }} title={tr('글자 효과 세기 (px, 회전은 도)')} value={an.charFxAmount ?? 40} step={10} min={0}
                                onChange={e => set({ charFxAmount: Math.max(0, +e.target.value || 0) })} />}
                        </>}
                    </>);
                })()}
                <div className="te-footer">
                    <button className="button button-primary" onClick={commitText} style={{ height: 28, padding: '0 12px' }}>{tr('완료')}</button>
                    <button className="button" onClick={cancelText} style={{ height: 28, padding: '0 12px' }}>{tr('취소')}</button>
                </div>
            </div>
        </div>
    );
}
