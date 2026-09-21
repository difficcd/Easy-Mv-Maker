import { ChevronDown, ChevronUp, Grid3x3, Pause, Play, Plus, Repeat, Square, Trash2, Eye, EyeOff, Settings, Volume2, VolumeX } from 'lucide-react';
import { accentSoft } from '../canvas/editChrome.js';
import { safeArray } from '../core/geometry.ts';
import { tr } from '../i18n';
import { PLAYBACK_RATES, RATE_DEFAULT } from '../core/playbackRate.ts';
import { TRACK_GUTTER, timeAtX, xAtTime } from '../core/timelineZoom.js';
import { gapAt } from '../core/cutOps.js';
import { toggled } from '../core/cutSelection.ts';
import { mkCut } from '../core/document.js';
import { nextId } from '../core/ids.ts';

// Bottom timeline: playback controls, the parts bar, the ruler, track and cut blocks,
// and the audio and video tracks.
// Scrubbing, cut dragging and pinch zoom touch App state directly, so those handlers stay
// in App and arrive as props - moving them here would change behaviour, not just location.
/**
 * The bottom of the screen: the transport bar and the tracks.
 *
 * Sixty-three loose props became these: the hook bundles App already holds (playback, the
 * timeline gestures, the view, the cut list, the audio) passed whole, and the rest grouped by
 * what they are about. The body below reads the same names it always did.
 *
 * @param {object} p
 * @param {{cuts: any[], currentCutId: any, setCurrentCutId: Function, parts: any[], numTracks: number, maxTime: number}} p.doc
 * @param {{showBottom: boolean, setShowBottom: Function, timelineH: number, timelineRef: any, playheadRef: any, fmt: (s: number) => string}} p.view
 * @param {{hiddenTracks: any, toggleTrackHidden: Function, handleAddTrack: Function, handleDeleteTrack: Function}} p.tracks
 * @param {{makePartFromSelection: Function, selectPart: Function, renamePart: Function, ungroupPart: Function}} p.partOps
 * @param {{cutDragArmedRef: any, cutDragMovedRef: any, cutDragTimerRef: any, draggingCutData: any, setDraggingCutData: Function, setResizingData: Function}} p.drag
 * @param {{audioData: any, audioFile: any, videoOverlay: any, removeVideoOverlay: Function}} p.media
 * @param {{loopPlay: boolean, setLoopPlay: Function, playbackRate: number, setPlaybackRate: Function}} p.rate
 * @param {{transparentBg: boolean, setTransparentBg: Function, transparentFormat: string, setTransparentFormat: Function}} p.bg
 * @param {any} p.playback usePlayback's bundle
 * @param {any} p.gestures useTimelineGestures' bundle
 * @param {any} p.tl useTimelineView's bundle
 * @param {any} p.cutList useCutListUi's bundle
 * @param {any} p.audio useAudioTrack's bundle
 * @param {() => void} p.openPlaybackSettings
 * @param {() => void} p.openVideoSettings
 * @param {any} p.sceneDetect
 * @param {Function} p.setSceneCfg
 * @param {(cs: any[]) => void} p.addCuts
 */
export function Timeline({
    doc, view, tracks, partOps, drag, media, rate, bg, playback, gestures, tl, cutList, audio, openPlaybackSettings, openVideoSettings, sceneDetect, setSceneCfg, addCuts,
}) {
    const { cuts, currentCutId, setCurrentCutId, parts, numTracks, maxTime } = doc;
    const { showBottom, setShowBottom, timelineH, timelineRef, playheadRef, fmt } = view;
    const { hiddenTracks, toggleTrackHidden, handleAddTrack, handleDeleteTrack } = tracks;
    const { makePartFromSelection, selectPart, renamePart, ungroupPart } = partOps;
    const { cutDragArmedRef, cutDragMovedRef, cutDragTimerRef, draggingCutData, setDraggingCutData, setResizingData } = drag;
    const { audioData, audioFile, videoOverlay, removeVideoOverlay } = media;
    const { loopPlay, setLoopPlay, playbackRate, setPlaybackRate } = rate;
    const { transparentBg, setTransparentBg, transparentFormat, setTransparentFormat } = bg;
    const { isPlaying, currentTime, setCurrentTime, playPause: handlePlayPause, stop: handleStop } = playback;
    const { seekToTime, goToScene, startTimelinePan, onTimelinePointerDown, zoomTimelineAt } = gestures;
    const { pps, snapLinePos, win: tlWin } = tl;
    const { activePartId, marquee, selectedCutIds, setSelectedCutIds } = cutList;
    const { muted: audioMuted, setMuted: setAudioMuted, handleDeleteAudio } = audio;

    return (
    <div className="timeline" style={{ height: showBottom ? timelineH : 44, flexShrink: 0 }}>
        <div className="tl-controls">
            <button className="icon-btn" onClick={() => setShowBottom(v => !v)}>{showBottom ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
            {showBottom && <>
                <div className="time-display">{fmt(currentTime)}</div>
                <button className="button button-primary" onClick={handlePlayPause} style={{ background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' }}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button>
                <button className="button" onClick={handleStop} style={{ borderColor: 'var(--accent-hi)', color: 'var(--accent-soft)' }}><Square size={16} /></button>
                <button className={`button${loopPlay ? ' button-primary' : ''}`} onClick={() => setLoopPlay(v => !v)} title={tr('반복 재생')}
                    style={loopPlay ? { background: 'var(--accent)', borderColor: 'var(--accent-hi)', color: '#fff' } : undefined}><Repeat size={16} /></button>
                {videoOverlay?.cuts?.length > 0 && <>
                    <button className="button" onClick={() => goToScene(-1)} title={tr('이전 장면(컷)')}>{tr('◀컷')}</button>
                    <button className="button" onClick={() => goToScene(1)} title={tr('다음 장면(컷)')}>{tr('컷▶')}</button>
                </>}
                {/* The speed is remembered between sessions, so it has to be visible that it is
                    set: an accent border when it is not 1x, or a project someone left at 0.25x
                    weeks ago reads as an app that got slow.

                    Only the playback effect sets the audio element's rate. This handler set it
                    too, which was harmless while the speed reset every session and is not now:
                    a video export deliberately runs the loop at 1x, and a change made here
                    during one would have put the audio alone at the chosen speed. */}
                <select className="time-input" title={tr('재생 속도 (기억됩니다 · 내보내기는 항상 정상 속도)')}
                    style={{
                        width: 60, marginLeft: 8,
                        borderColor: playbackRate === RATE_DEFAULT ? undefined : 'color-mix(in srgb, var(--accent-soft) 55%, transparent)',
                        color: playbackRate === RATE_DEFAULT ? undefined : 'var(--accent-pale)',
                    }}
                    value={playbackRate} onChange={e => setPlaybackRate(+e.target.value)}>
                    {PLAYBACK_RATES.map(v => <option key={v} value={v}>{v}x</option>)}
                </select>
                {/* The way to the playback settings, where a preview speed can be made the
                    film's real one. Beside the selector because that is where the question
                    comes up; behind a gear because the answer rewrites every cut. */}
                <button className="icon-btn" onClick={openPlaybackSettings}
                    style={{ marginLeft: 2, color: playbackRate === RATE_DEFAULT ? undefined : 'var(--accent-pale)' }}
                    title={tr('재생 설정 — 이 속도를 실제 속도로 굳히기')}>
                    <Settings size={12} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 12 }} title={tr('타임라인 확대/축소 (마우스 휠은 커서 기준)')}>
                    <button className="icon-btn" onClick={() => { const el = timelineRef.current; const r = el?.getBoundingClientRect(); zoomTimelineAt(r ? r.left + el.clientWidth / 2 : 0, 1 / 1.25); }}>−</button>
                    <span style={{ fontSize: 11, color: '#888', minWidth: 30, textAlign: 'center' }}>{Math.round(pps)}</span>
                    <button className="icon-btn" onClick={() => { const el = timelineRef.current; const r = el?.getBoundingClientRect(); zoomTimelineAt(r ? r.left + el.clientWidth / 2 : 0, 1.25); }}>＋</button>
                </div>
                <span style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>Max: {fmt(maxTime)}</span>
                {/* Everything below is pinned to the right-hand end. Video settings sits at the
                    very edge so it is always in the same place - the gear on the track row goes
                    with the row when it is folded away, which is exactly when it is wanted. */}
                <div style={{ flex: '1 1 auto', minWidth: 8 }} />
                {audioFile && audioData && hiddenTracks.audio && (
                    <button className="button" onClick={() => toggleTrackHidden('audio')}
                        title={tr('접힌 트랙 — 눌러서 펼치기')}><Eye size={12} /> Audio</button>
                )}
                {videoOverlay && hiddenTracks.video && (
                    <button className="button" onClick={() => toggleTrackHidden('video')}
                        title={tr('접힌 트랙 — 눌러서 펼치기')}><Eye size={12} /> {videoOverlay.name || tr('영상')}</button>
                )}
                <button className={`button${transparentBg ? ' active' : ''}`} onClick={() => setTransparentBg(!transparentBg)}
                    title={transparentBg
                        ? tr('배경 투명 — 내보내면 배경 없이 나옵니다. 눌러서 흰 배경으로')
                        : tr('배경 흰색 — 눌러서 투명하게 (체커보드로 표시됩니다)')}>
                    {transparentBg ? <Grid3x3 size={12} /> : <Square size={12} />} {tr('캔버스 배경')}
                </button>
                {transparentBg && (
                    <select className="time-input" style={{ width: 104 }} value={transparentFormat}
                        onChange={e => setTransparentFormat(e.target.value)}
                        title={tr('투명 배경 내보내기 형식')}>
                        <option value="gif">{tr('GIF (한 파일, 720px)')}</option>
                        <option value="png">{tr('PNG 시퀀스 (ZIP)')}</option>
                    </select>
                )}
                {videoOverlay && (
                    <button className="button" onClick={openVideoSettings} title={tr('영상 설정 (농도, 장면 감지)')}>
                        <Settings size={12} /> {tr('영상 설정')}
                    </button>
                )}
            </>}
        </div>
        {showBottom && (parts.length > 0 || selectedCutIds.size > 0) && (
            <div className="parts-bar" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', overflowX: 'auto', flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: '#777', marginRight: 2, flexShrink: 0 }}>{tr('파트')}</span>
                <button className={`chip${!activePartId ? ' chip-active' : ''}`} onClick={() => selectPart(null)} title={tr('전체 재생')} style={{ flexShrink: 0 }}>{tr('전체')}</button>
                {parts.map((p, i) => (
                    <button key={p.id} className={`chip${activePartId === p.id ? ' chip-active' : ''}`} style={{ flexShrink: 0 }}
                        onClick={() => selectPart(p.id)} onDoubleClick={() => renamePart(p.id)}
                        title={tr('{0} · {1}컷 (클릭: 이 파트만 재생 / 더블클릭: 이름변경)', p.name, p.count)}>
                        {p.name.slice(0, 14)} <span style={{ opacity: 0.6 }}>·{p.count}</span>
                        <span onClick={e => { e.stopPropagation(); ungroupPart(p.id); }} title={tr('파트 해제 (컷은 유지)')} style={{ marginLeft: 4, opacity: 0.5, cursor: 'pointer' }}>✕</span>
                    </button>
                ))}
                {selectedCutIds.size > 0 && (
                    <button className="chip" onClick={makePartFromSelection} title={tr('선택한 컷을 새 파트로 묶기')} style={{ flexShrink: 0, color: 'var(--accent-soft)', borderColor: 'var(--accent-hi)' }}>+ {tr('선택 {0}컷 → 새 파트', selectedCutIds.size)}</button>
                )}
            </div>
        )}
        {showBottom && (
            <div className="tl-tracks" ref={timelineRef}
                onPointerDownCapture={startTimelinePan}
                onMouseDown={e => { if (e.button === 1) e.preventDefault(); }} /* 브라우저 가운데클릭 자동스크롤 방지 */
                onAuxClick={e => { if (e.button === 1) e.preventDefault(); }}
                onPointerDown={onTimelinePointerDown} style={{ position: 'relative', touchAction: 'none' }}>
                <div style={{ minWidth: '100%', width: `${Math.max(100, maxTime * pps + 150)}px`, position: 'relative' }}>
                    <div className="ruler" style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 20, background: 'hsl(var(--ui-h) var(--ui-s) 14%)', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', zIndex: 20 }}>
                        <div style={{ position: 'sticky', left: 0, width: TRACK_GUTTER, height: '100%', background: 'hsl(var(--ui-h) var(--ui-s) 14%)', zIndex: 21, float: 'left' }} />
                        {(() => {
                            const iMin = Math.max(0, Math.floor((tlWin.left - TRACK_GUTTER) / pps));
                            const iMax = Math.min(Math.ceil(maxTime), Math.ceil((tlWin.right - TRACK_GUTTER) / pps));
                            const ticks = [];
                            for (let i = iMin; i <= iMax; i++) ticks.push(
                                <div key={i} style={{ position: 'absolute', left: `${xAtTime(i, pps)}px`, borderLeft: '1px solid #333', height: i % 5 === 0 ? 20 : 10, fontSize: 10, paddingLeft: 2, top: 0, color: '#555' }}>{i % 5 === 0 ? i : ''}</div>
                            );
                            return ticks;
                        })()}
                    </div>
                    <div style={{ marginTop: 8 }}>
                        {Array.from({ length: numTracks }).map((_, ti) => (
                            <div key={ti} className="tl-track"
                                onDoubleClick={e => {
                                    // A double-click on empty track fills the gap with a cut. The
                                    // row scrolls with the timeline, so its own left edge is the
                                    // origin and there is no scroll offset to add.
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const t = timeAtX(0, e.clientX - rect.left, pps);
                                    if (t < 0) return;
                                    const gap = gapAt(cuts, ti, t);
                                    if (!gap) return;
                                    e.stopPropagation();
                                    const newCut = mkCut({ id: nextId(), name: `Cut ${cuts.length + 1}`, startTime: gap.start, endTime: gap.end, track: ti });
                                    addCuts([newCut]);
                                    setCurrentCutId(newCut.id);
                                    setCurrentTime(gap.start);
                                }}
                            >
                                <div className="tl-track-label">
                                    <span>Track {ti}</span>
                                    <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteTrack(ti); }}><Trash2 size={9} /></button>
                                </div>
                                {cuts.filter(c => (c.track || 0) === ti).filter(cut => { const l = xAtTime(cut.startTime, pps), r = l + (cut.endTime - cut.startTime) * pps; return r >= tlWin.left && l <= tlWin.right; }).map(cut => (
                                    <div key={cut.id} data-cutid={cut.id}
                                        className={`cut-block${currentCutId === cut.id ? ' cut-block-active' : ''}${selectedCutIds.has(cut.id) ? ' cut-block-selected' : ''}`}
                                        style={{ left: `${xAtTime(cut.startTime, pps)}px`, width: `${(cut.endTime - cut.startTime) * pps}px`, cursor: draggingCutData?.cutId === cut.id ? 'grabbing' : 'grab', touchAction: 'none', opacity: activePartId && cut.partId !== activePartId ? 0.3 : 1 }}
                                        onClick={e => { e.stopPropagation(); if (cutDragMovedRef.current || e.shiftKey || e.ctrlKey || e.metaKey) return; setCurrentCutId(cut.id); setSelectedCutIds(new Set([cut.id])); }}
                                        onPointerDown={e => {
                                            e.stopPropagation();
                                            if (e.shiftKey || e.ctrlKey || e.metaKey) { // add/remove from selection, no drag
                                                setSelectedCutIds(p => toggled(p, cut.id));
                                                setCurrentCutId(cut.id); cutDragMovedRef.current = false; return;
                                            }
                                            setCurrentCutId(cut.id);
                                            // Pressing a cut that's part of a multi-selection keeps the group (so it can be
                                            // dragged together); pressing any other cut selects just that one.
                                            const inGroup = selectedCutIds.has(cut.id) && selectedCutIds.size > 1;
                                            const group = inGroup ? cuts.filter(c => selectedCutIds.has(c.id)).map(c => ({ id: c.id, startTime: c.startTime, endTime: c.endTime, track: c.track })) : null;
                                            if (!inGroup) setSelectedCutIds(new Set([cut.id]));
                                            cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350);
                                            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
                                            setDraggingCutData({ cutId: cut.id, startX: e.clientX, startY: e.clientY, initialStart: cut.startTime, initialTrack: cut.track, group });
                                        }}>
                                        <div className="rh rh-left" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch { } setResizingData({ cutId: cut.id, edge: 'left', startX: e.clientX, initialStart: cut.startTime, initialEnd: cut.endTime }); }} />
                                        {cut.name}
                                        <div className="rh rh-right" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch { } setResizingData({ cutId: cut.id, edge: 'right', startX: e.clientX, initialStart: cut.startTime, initialEnd: cut.endTime }); }} />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    {audioFile && audioData && !hiddenTracks.audio && (
                        <div className="tl-track" style={{ background: 'hsl(var(--ui-h) var(--ui-s) 12%)' }}>
                            <div className="tl-track-label" style={{ background: 'hsl(var(--ui-h) var(--ui-s) 12%)' }}>
                                <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTrackHidden('audio'); }}
                                    title={tr('트랙 접기 — 재생바로 보냅니다. 소리는 계속 재생됩니다.')}>
                                    <EyeOff size={10} />
                                </button>
                                <span>Audio</span>
                                {/* Monitoring only. The export always contains the track, so this
                                    cannot silently produce a video with no music. */}
                                <button className="icon-btn" onClick={e => { e.stopPropagation(); setAudioMuted(v => !v); }}
                                    title={audioMuted ? tr('소리 켜기 (내보내기에는 항상 들어갑니다)') : tr('소리 끄기 — 듣지 않고 그릴 때. 내보내기에는 그대로 들어갑니다')}
                                    style={audioMuted ? { color: 'var(--accent-hi)' } : undefined}>
                                    {audioMuted ? <VolumeX size={9} /> : <Volume2 size={9} />}
                                </button>
                                <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteAudio(); }} title={tr('오디오 삭제')}><Trash2 size={9} /></button></div>
                            <div className="cut-block" style={{ left: `${xAtTime(audioData.startTime, pps)}px`, width: `${(audioData.endTime - audioData.startTime) * pps}px`, background: '#374151', borderColor: '#4b5563', cursor: draggingCutData?.cutId === 'audio' ? 'grabbing' : 'grab', touchAction: 'none' }}
                                onPointerDown={e => { e.stopPropagation(); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setDraggingCutData({ cutId: 'audio', startX: e.clientX, startY: e.clientY, initialStart: audioData.startTime, initialTrack: 0 }); }}>
                                <div className="rh rh-left" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch { } setResizingData({ cutId: 'audio', edge: 'left', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                                <span>Audio</span>
                                <div className="rh rh-right" style={{ touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch { } setResizingData({ cutId: 'audio', edge: 'right', startX: e.clientX, initialStart: audioData.startTime, initialEnd: audioData.endTime, initialOffset: audioData.offset }); }} />
                            </div>
                        </div>
                    )}
                    {videoOverlay && !hiddenTracks.video && (
                        <div className="tl-track" style={{ background: '#0f1e2a' }}>
                            <div className="tl-track-label" style={{ background: '#0f1e2a' }}>
                                <button className="icon-btn" onClick={e => { e.stopPropagation(); toggleTrackHidden('video'); }}
                                    title={tr('트랙 접기 — 재생바로 보냅니다. 영상은 계속 보입니다 (농도로 조절).')}>
                                    <EyeOff size={10} />
                                </button>
                                <button className="tl-track-name" onClick={e => { e.stopPropagation(); openVideoSettings(); }}
                                    title={tr('영상 설정 (농도, 장면 감지)')}>{videoOverlay.name || tr('영상')}</button>
                                {sceneDetect ? <span style={{ fontSize: 9, color: '#7aa' }}>{tr('컷 감지')} {sceneDetect.total ? Math.round(sceneDetect.done / sceneDetect.total * 100) : 0}%</span>
                                    : videoOverlay.cuts?.length ? <span style={{ fontSize: 9, color: '#7aa' }}>{tr('{0}컷', videoOverlay.cuts.length)}</span> : null}
                                <button className="icon-btn" title={tr('장면(컷) 감지 설정')} style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setSceneCfg({ threshold: 14, rangeOn: false, startText: '0:00', endText: '' }); }}></button>
                                <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); removeVideoOverlay(); }} title={tr('영상 트랙 삭제')}><Trash2 size={9} /></button></div>
                            <div className="cut-block" style={{ left: `${xAtTime(videoOverlay.startTime, pps)}px`, width: `${(videoOverlay.endTime - videoOverlay.startTime) * pps}px`, background: '#155e75', borderColor: '#22d3ee55', cursor: draggingCutData?.cutId === 'video' ? 'grabbing' : 'grab', touchAction: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                onPointerDown={e => { e.stopPropagation(); cutDragMovedRef.current = false; clearTimeout(cutDragTimerRef.current); cutDragArmedRef.current = e.pointerType !== 'touch'; if (e.pointerType === 'touch') cutDragTimerRef.current = setTimeout(() => { cutDragArmedRef.current = true; }, 350); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setDraggingCutData({ cutId: 'video', startX: e.clientX, startY: e.clientY, initialStart: videoOverlay.startTime, initialTrack: 0 }); }}>
                                {videoOverlay.name}
                                {/* scene-cut markers: click to jump the playhead to that scene */}
                                {safeArray(videoOverlay.cuts).map((vt, i) => {
                                    const rel = (vt - (videoOverlay.cutOffset || 0));
                                    if (rel < 0 || rel > (videoOverlay.endTime - videoOverlay.startTime)) return null;
                                    return <div key={i} title={tr('장면 {0} ({1})', i + 1, fmt((videoOverlay.cutStart || 0) + rel))}
                                        onPointerDown={e => { e.stopPropagation(); }}
                                        onClick={e => { e.stopPropagation(); seekToTime((videoOverlay.cutStart || 0) + rel); }}
                                        style={{ position: 'absolute', top: 0, bottom: 0, left: `${rel * pps}px`, width: 2, background: '#fde047', boxShadow: '0 0 3px rgba(253,224,71,.7)', cursor: 'pointer' }} />;
                                })}
                            </div>
                        </div>
                    )}
                    {/* Sticky, and sized to its contents rather than the full track width. As a
                        full-width row it scrolled away with everything else: at 50px a second a
                        one-minute project is three thousand pixels wide, so scrolling to look at
                        a later cut took the button off the left of the screen and it read as
                        missing. The width matters as much as the sticky - a block as wide as the
                        content has nothing to pin. */}
                    <div style={{ marginTop: 8, position: 'sticky', left: 0, width: 'fit-content', paddingLeft: TRACK_GUTTER, zIndex: 15 }}>
                        <button className="small-btn" onClick={handleAddTrack}><Plus size={11} /> {tr('트랙 추가')}</button>
                    </div>
                    {marquee && (
                        <div style={{ position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, background: accentSoft(0.15), border: `1px solid ${accentSoft(0.8)}`, zIndex: 16, pointerEvents: 'none' }} />
                    )}
                    <div className="playhead" ref={playheadRef} style={{ left: `${xAtTime(currentTime, pps)}px` }}><div className="playhead-dot" /></div>
                    {snapLinePos !== null && (
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${snapLinePos}px`, width: 2, background: '#888', opacity: 0.85, zIndex: 15, pointerEvents: 'none', boxShadow: '0 0 6px rgba(136,136,136,.5)' }} />
                    )}
                </div>
            </div>
        )}
    </div>
    );
}
