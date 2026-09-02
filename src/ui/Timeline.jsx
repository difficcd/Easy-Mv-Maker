import React from 'react';
import { ChevronDown, ChevronUp, Grid3x3, Pause, Play, Plus, Repeat, Square, Trash2, Eye, EyeOff, Settings } from 'lucide-react';
import { safeArray, accentSoft } from '../canvas/canvasUtils';
import { tr } from '../i18n';
import { TRACK_GUTTER } from '../core/timelineZoom.js';

// Bottom timeline: playback controls, the parts bar, the ruler, track and cut blocks,
// and the audio and video tracks.
// Scrubbing, cut dragging and pinch zoom touch App state directly, so those handlers stay
// in App and arrive as props - moving them here would change behaviour, not just location.
export function Timeline({
    activePartId, audioData, audioFile, audioRef, currentCutId,
    currentTime, cutDragArmedRef, cutDragMovedRef, cutDragTimerRef, cuts,
    draggingCutData, fmt, goToScene, handleAddTrack, handleDeleteAudio,
    handleDeleteTrack, handlePlayPause, handleStop, isPlaying, loopPlay,
    makePartFromSelection, marquee, maxTime, mkLayer, numTracks,
    onTimelinePointerDown, onTimelinePointerMove, onTimelinePointerUp, parts, playbackRate,
    playheadRef, pps, removeVideoOverlay, renamePart, sceneDetect,
    seekToTime, selectPart, selectedCutIds, setCurrentCutId, setCurrentTime,
    addCuts, setDraggingCutData, setLoopPlay, setPlaybackRate, setResizingData,
    setSceneCfg, setSelectedCutIds, setShowBottom, showBottom, snapLinePos,
    startTimelinePan, timelineH, timelineRef, tlWin, ungroupPart,
    videoOverlay, hiddenTracks, toggleTrackHidden, openVideoSettings, zoomTimelineAt,
    transparentBg, setTransparentBg,
}) {
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
                <select className="time-input" style={{ width: 60, marginLeft: 8 }} value={playbackRate} onChange={e => { const r = +e.target.value; setPlaybackRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }} title={tr('재생 속도')}>
                    {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map(v => <option key={v} value={v}>{v}x</option>)}
                </select>
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
                onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerCancel={onTimelinePointerUp} style={{ position: 'relative', touchAction: 'none' }}>
                <div style={{ minWidth: '100%', width: `${Math.max(100, maxTime * pps + 150)}px`, position: 'relative' }}>
                    <div className="ruler" style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 20, background: 'hsl(var(--ui-h) var(--ui-s) 14%)', borderBottom: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', zIndex: 20 }}>
                        <div style={{ position: 'sticky', left: 0, width: TRACK_GUTTER, height: '100%', background: 'hsl(var(--ui-h) var(--ui-s) 14%)', zIndex: 21, float: 'left' }} />
                        {(() => {
                            const iMin = Math.max(0, Math.floor((tlWin.left - 60) / pps));
                            const iMax = Math.min(Math.ceil(maxTime), Math.ceil((tlWin.right - 60) / pps));
                            const ticks = [];
                            for (let i = iMin; i <= iMax; i++) ticks.push(
                                <div key={i} style={{ position: 'absolute', left: `${i * pps + 60}px`, borderLeft: '1px solid #333', height: i % 5 === 0 ? 20 : 10, fontSize: 10, paddingLeft: 2, top: 0, color: '#555' }}>{i % 5 === 0 ? i : ''}</div>
                            );
                            return ticks;
                        })()}
                    </div>
                    <div style={{ marginTop: 8 }}>
                        {Array.from({ length: numTracks }).map((_, ti) => (
                            <div key={ti} className="tl-track"
                                onDoubleClick={e => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = e.clientX - rect.left - 60;
                                    if (x < 0) return;
                                    const t = x / pps;
                                    const hit = cuts.find(c => c.track === ti && t >= c.startTime && t < c.endTime);
                                    if (hit) return;
                                    e.stopPropagation();
                                    const trackCuts = cuts.filter(c => c.track === ti).sort((a, b) => a.startTime - b.startTime);
                                    let gapStart = 0, gapEnd = t + 1;
                                    for (const c of trackCuts) { if (c.endTime <= t) gapStart = c.endTime; }
                                    for (const c of trackCuts) { if (c.startTime > t) { gapEnd = c.startTime; break; } }
                                    if (gapEnd - gapStart < 0.05) return;
                                    const newCut = { id: Date.now(), name: `Cut ${cuts.length + 1}`, startTime: gapStart, endTime: gapEnd, track: ti, layers: [mkLayer(1)], activeLayerId: 1 };
                                    addCuts([newCut]);
                                    setCurrentCutId(newCut.id);
                                    setCurrentTime(gapStart);
                                }}
                            >
                                <div className="tl-track-label">
                                    <span>Track {ti}</span>
                                    <button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteTrack(ti); }}><Trash2 size={9} /></button>
                                </div>
                                {cuts.filter(c => (c.track || 0) === ti).filter(cut => { const l = cut.startTime * pps + 60, r = l + (cut.endTime - cut.startTime) * pps; return r >= tlWin.left && l <= tlWin.right; }).map(cut => (
                                    <div key={cut.id} data-cutid={cut.id}
                                        className={`cut-block${currentCutId === cut.id ? ' cut-block-active' : ''}${selectedCutIds.has(cut.id) ? ' cut-block-selected' : ''}`}
                                        style={{ left: `${cut.startTime * pps + 60}px`, width: `${(cut.endTime - cut.startTime) * pps}px`, cursor: draggingCutData?.cutId === cut.id ? 'grabbing' : 'grab', touchAction: 'none', opacity: activePartId && cut.partId !== activePartId ? 0.3 : 1 }}
                                        onClick={e => { e.stopPropagation(); if (cutDragMovedRef.current || e.shiftKey || e.ctrlKey || e.metaKey) return; setCurrentCutId(cut.id); setSelectedCutIds(new Set([cut.id])); }}
                                        onPointerDown={e => {
                                            e.stopPropagation();
                                            if (e.shiftKey || e.ctrlKey || e.metaKey) { // add/remove from selection, no drag
                                                setSelectedCutIds(p => { const s = new Set(p); s.has(cut.id) ? s.delete(cut.id) : s.add(cut.id); return s; });
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
                                <span>Audio</span><button className="icon-btn del-btn" onClick={e => { e.stopPropagation(); handleDeleteAudio(); }} title={tr('오디오 삭제')}><Trash2 size={9} /></button></div>
                            <div className="cut-block" style={{ left: `${audioData.startTime * pps + 60}px`, width: `${(audioData.endTime - audioData.startTime) * pps}px`, background: '#374151', borderColor: '#4b5563', cursor: draggingCutData?.cutId === 'audio' ? 'grabbing' : 'grab', touchAction: 'none' }}
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
                            <div className="cut-block" style={{ left: `${videoOverlay.startTime * pps + 60}px`, width: `${(videoOverlay.endTime - videoOverlay.startTime) * pps}px`, background: '#155e75', borderColor: '#22d3ee55', cursor: draggingCutData?.cutId === 'video' ? 'grabbing' : 'grab', touchAction: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
                        <button className="small-btn" onClick={handleAddTrack}><Plus size={11} /> Add Track</button>
                    </div>
                    {marquee && (
                        <div style={{ position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, background: accentSoft(0.15), border: `1px solid ${accentSoft(0.8)}`, zIndex: 16, pointerEvents: 'none' }} />
                    )}
                    <div className="playhead" ref={playheadRef} style={{ left: `${currentTime * pps + 60}px` }}><div className="playhead-dot" /></div>
                    {snapLinePos !== null && (
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${snapLinePos}px`, width: 2, background: '#888', opacity: 0.85, zIndex: 15, pointerEvents: 'none', boxShadow: '0 0 6px rgba(136,136,136,.5)' }} />
                    )}
                </div>
            </div>
        )}
    </div>
    );
}
