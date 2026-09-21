import { tr } from '../../i18n';
import { targetCanvasFor } from '../../core/canvasSize.js';
import { Modal } from '../Modal.jsx';
import { parseClock } from '../../core/timeCode.ts';
import { NumField, clampNum } from '../NumField.jsx';

// The video-to-frame-cuts import dialog. While extracting it shows only progress;
// pressing "Send to background" closes it and the work continues in the corner chip.
export function VideoImportModal({
    videoImport, setVideoImport, videoBusy, setVideoBusyBg, videoStopRef,
    runVideoImport, loadVideoOverlay, loadAudioUrl, parseClock, setShowHelp, canvasW, canvasH, setCanvasSize,
}) {
    return (
        <Modal title={tr('영상 → 프레임 컷')} onClose={() => setVideoImport(null)} width={420}
            closable={!videoBusy} panelStyle={{ color: '#ccc', fontSize: 12.5 }}>
            <div style={{ marginBottom: 10, color: '#9aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{videoImport.file.name}</div>
            {videoBusy ? (
                <>
                    <div style={{ marginBottom: 8 }}>{tr('프레임 추출 중…')} {videoBusy.done}/{videoBusy.total || '?'}{videoBusy.skipped ? ' ' + tr('(중복 {0}컷 통합)', videoBusy.skipped) : ''}</div>
                    <div style={{ height: 8, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: 'var(--accent-soft)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                        <span style={{ color: '#888', fontSize: 11 }}>{tr('백그라운드로 두고 다른 작업을 계속할 수 있어요.')}</span>
                        <span style={{ display: 'flex', gap: 6 }}>
                            <button className="button" onClick={() => setVideoBusyBg(true)}>{tr('백그라운드로')}</button>
                            <button className="button" onClick={() => { videoStopRef.current = true; }}>{tr('중지')}</button>
                        </span>
                    </div>
                </>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ width: 76 }}>{tr('초당 프레임')}</span>
                        <select className="time-input" style={{ width: 80 }} value={videoImport.fps} onChange={e => setVideoImport(v => ({ ...v, fps: +e.target.value }))}>
                            {[1, 2, 3, 4, 6, 8, 12, 15, 24].map(v => <option key={v} value={v}>{v} fps</option>)}
                        </select>
                        {videoImport.quality === 'compressed' && <>
                            <span style={{ width: 50, marginLeft: 6 }}>{tr('배율')}</span>
                            <select className="time-input" style={{ width: 80 }} value={videoImport.scale} onChange={e => setVideoImport(v => ({ ...v, scale: +e.target.value }))}>
                                {[[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.35, '35%'], [0.25, '25%']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={videoImport.whole} onChange={e => setVideoImport(v => ({ ...v, whole: e.target.checked }))} /> {tr('영상 전체')}
                        </label>
                        {!videoImport.whole && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('가져올 컷 개수 (중복 병합분은 제외한 실제 컷 수)')}>
                                <NumField width={70} min={1} max={5000} value={videoImport.maxFrames}
                                    onChange={n => setVideoImport(v => ({ ...v, maxFrames: clampNum(Math.floor(n) || 1, 1, 5000) }))} />
                                <span style={{ color: '#888' }}>{tr('컷')}</span>
                            </label>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={videoImport.withAudio} onChange={e => setVideoImport(v => ({ ...v, withAudio: e.target.checked }))} /> {tr('음원도 같이')}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('영상의 일부 구간만 가져오기 (mm:ss)')}>
                            <input type="checkbox" checked={videoImport.rangeOn} onChange={e => setVideoImport(v => ({ ...v, rangeOn: e.target.checked }))} /> {tr('구간만')}
                        </label>
                        {videoImport.rangeOn && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <input className="time-input" style={{ width: 60 }} placeholder="0:00" value={videoImport.startText} onChange={e => setVideoImport(v => ({ ...v, startText: e.target.value }))} />
                                <span style={{ color: '#888' }}>~</span>
                                <input className="time-input" style={{ width: 60 }} placeholder={tr('끝')} value={videoImport.endText} onChange={e => setVideoImport(v => ({ ...v, endText: e.target.value }))} />
                            </span>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('화질/용량 선택. 고화질=원본 해상도 WebP(거의 무손실, 용량 적당) / 무손실=PNG(픽셀 완전 보존, 용량 큼)')}>
                            <span style={{ color: '#888' }}>{tr('화질')}</span>
                            <select className="time-input" style={{ width: 118 }} value={videoImport.quality} onChange={e => setVideoImport(v => ({ ...v, quality: e.target.value }))}>
                                <option value="compressed">{tr('압축(작음)')}</option>
                                <option value="high">{tr('고화질 WebP')}</option>
                                <option value="lossless">{tr('무손실 PNG')}</option>
                            </select>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('긴 영상을 여러 파트로 나눠서 가져오기 (재생 시 파트별/전체 선택 가능)')}>
                            <NumField width={46} min={1} max={50} value={videoImport.parts}
                                onChange={n => setVideoImport(v => ({ ...v, parts: clampNum(Math.floor(n) || 1, 1, 50) }))} />
                            <span style={{ color: 'var(--accent-soft)' }}>{tr('파트로 나누기')}</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={tr('세로 영상(쇼츠)을 가로 캔버스에 넣으면 대부분이 여백이 됩니다. 영상에 맞추거나 직접 고르세요.')}>
                            <span style={{ color: '#888' }}>{tr('캔버스 크기')}</span>
                            <select className="time-input" style={{ width: 150 }} value={videoImport.canvasMode || 'source'}
                                onChange={e => setVideoImport(v => ({ ...v, canvasMode: e.target.value }))}>
                                <option value="source">{tr('영상 크기대로')}</option>
                                <option value="landscape">{tr('일반 (가로 1920×1080)')}</option>
                                <option value="portrait">{tr('쇼츠 (세로 1080×1920)')}</option>
                                <option value="keep">{tr('현재 캔버스 유지')}</option>
                            </select>
                        </label>
                        <span style={{ marginLeft: 'auto' }}>{tr('중복 통합')}</span>
                        <select className="time-input" style={{ width: 100 }} value={videoImport.dedupe} onChange={e => setVideoImport(v => ({ ...v, dedupe: e.target.value === 'exact' ? 'exact' : +e.target.value }))}>
                            {[['0', tr('끄기')], ['exact', tr('완전 동일')], ['3', tr('거의 같음')], ['8', tr('느슨')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>
                    <div style={{ color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                        {(() => {
                            const t = targetCanvasFor(videoImport, canvasW, canvasH);
                            const changes = t.w !== canvasW || t.h !== canvasH;
                            return <>
                                {tr('캔버스({0}×{1})에 비율 유지로 넣고, 현재 트랙 뒤에 이어서 생성됩니다.', t.w, t.h)}
                                {changes && <> <b style={{ color: 'var(--accent-soft)' }}>{tr('가져오면 캔버스가 {0}×{1}로 바뀝니다.', t.w, t.h)}</b></>}
                            </>;
                        })()}<br />
                        {videoImport.quality === 'lossless'
                            ? <><b style={{ color: 'var(--accent-soft)' }}>{tr('무손실 PNG')}</b> {tr('— 픽셀 완전 보존, 장당 용량이 큽니다(수 MB). 긴 영상은')} <b>{tr('고화질 WebP')}</b>{tr('를 권장.')}</>
                            : videoImport.quality === 'high'
                                ? <>{tr('원본 해상도')} <b style={{ color: 'var(--accent-soft)' }}>{tr('고화질 WebP(거의 무손실)')}</b> {tr('— 무손실 대비 용량 약 1/5~1/8, 화질 차이는 거의 없음.')}</>
                                : <>{tr('프레임은')} <b style={{ color: '#9b9' }}>{tr('WebP로 압축 저장')}</b>{tr('되어 원본 대비 용량이 크게 줄어듭니다')}{videoImport.scale < 1 ? ' ' + tr('(배율 {0}%로 추가 절감)', Math.round(videoImport.scale * 100)) : ''}.</>}
                        {videoImport.dedupe === 'exact'
                            ? <><br /><b style={{ color: '#9b9' }}>{tr('완전히 똑같은 프레임만')}</b> {tr('한 컷으로 합칩니다 (픽셀 단위 비교).')}</>
                            : videoImport.dedupe > 0 && <><br />{tr('이어지는')} <b style={{ color: '#9b9' }}>{tr('비슷한 화면을 한 컷으로 합칩니다')}</b> {tr('— 정지 구간이 길수록 컷 수·용량이 줄어듭니다.')}</>}
                        {!videoImport.whole && <><br />{tr('지정한 {0}컷은 중복 병합을 제외한 실제 컷 수입니다 (합쳐진 프레임은 개수에 안 셉니다).', videoImport.maxFrames)}</>}
                        {videoImport.rangeOn && <><br /><b style={{ color: 'var(--accent-soft)' }}>{videoImport.startText || '0:00'} ~ {videoImport.endText || tr('끝')}</b> {tr('구간만 가져옵니다 (mm:ss).')}</>}
                        {videoImport.parts > 1 && <><br /><b style={{ color: 'var(--accent-soft)' }}>{tr('{0}개 파트', videoImport.parts)}</b>{' '}{tr('로 나눠 가져옵니다 — 재생 시 파트별 또는 전체로 볼 수 있습니다.')}</>}
                        {videoImport.whole && <><br /><span style={{ color: '#c99' }}>{tr('전체 추출: 길이가 길면 컷이 매우 많아집니다. fps를 낮게(1~4) 두는 것을 권장합니다.')}</span></>}
                    </div>
                    {/* The text must be allowed to shrink and the button not to: without flex:1 and
                        min-width:0 the longer English copy collapses into a one-word column. */}
                    <div style={{ background: 'hsl(var(--ui-h) var(--ui-s) 12%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 6, padding: '8px 10px', marginBottom: 10, color: 'var(--accent-pale)', fontSize: 11.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ flex: '1 1 240px', minWidth: 0 }}><b style={{ color: '#8de' }}>{tr('영상 위에 덧그리기')}</b> {tr('— 프레임으로 쪼개지 않고 원본 영상을 트랙으로 깔고 그 위에 그림·텍스트. 24fps 장편도 매끄럽게 재생.')} <b style={{ color: '#8de' }}>{tr('음원도 함께')}</b> {tr('들어갑니다.')}</span>
                        <button className="button" style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }} onClick={() => {
                            const useRange = videoImport.rangeOn && parseClock(videoImport.endText) > parseClock(videoImport.startText);
                            const off = useRange ? parseClock(videoImport.startText) : 0;
                            const clip = useRange ? (parseClock(videoImport.endText) - parseClock(videoImport.startText)) : null;
                            // The canvas-size choice above applies here too. Without it a
                            // portrait clip laid down as-is is letterboxed into a landscape
                            // canvas - the same thing the frame importer does with it.
                            const tgt = targetCanvasFor(videoImport, canvasW, canvasH);
                            if (tgt.w !== canvasW || tgt.h !== canvasH) setCanvasSize({ w: tgt.w, h: tgt.h });
                            loadVideoOverlay(videoImport.file, videoImport.label || videoImport.file.name, 0, off, clip);
                            // The overlay <video> is muted; always bring the audio via a synced audio track.
                            loadAudioUrl(URL.createObjectURL(videoImport.file), (videoImport.label || tr('영상')) + tr(' (음원)'), 0, off, clip);
                            setVideoImport(null);
                        }}>{tr('영상 그대로 깔기(+음원)')}</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button className="button" onClick={() => setVideoImport(null)}>{tr('취소')}</button>
                        <button className="button button-primary" onClick={runVideoImport}>{tr('프레임으로 가져오기')}</button>
                    </div>
                </>
            )}
        </Modal>
    );
}
