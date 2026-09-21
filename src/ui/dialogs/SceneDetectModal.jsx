import { tr } from '../../i18n';
import { Modal } from '../Modal.jsx';

// Scene-change detection settings. Only opens when there is a video overlay.
export function SceneDetectModal({ sceneCfg, setSceneCfg, sceneDetect, runSceneDetect, videoOpacity, setVideoOpacity, cancelSceneDetect, autoSceneDetect, setAutoSceneDetect, clearVideoCuts, hasCuts }) {
    return (
        <Modal title={tr('영상 설정')} onClose={() => setSceneCfg(null)} width={360}
            panelStyle={{ color: '#ccc', fontSize: 12.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 56 }}>{tr('농도')}</span>
                <input type="range" min={0} max={100} step={1} style={{ flex: 1 }}
                    value={Math.round((videoOpacity ?? 1) * 100)}
                    onChange={e => setVideoOpacity(+e.target.value / 100)} />
                <span style={{ width: 40, color: '#888', textAlign: 'right' }}>{Math.round((videoOpacity ?? 1) * 100)}%</span>
            </div>
            <div style={{ color: '#888', marginBottom: 12 }}>{tr('영상 투명도 — 위에 그린 그림이 잘 보이도록 흐리게 할 수 있습니다.')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ width: 56 }}>{tr('민감도')}</span>
                <input type="range" min={6} max={30} step={1} value={30 - sceneCfg.threshold + 6} onChange={e => setSceneCfg(v => ({ ...v, threshold: 30 - (+e.target.value) + 6 }))} style={{ flex: 1 }} />
                <span style={{ width: 60, color: '#888', textAlign: 'right' }}>{sceneCfg.threshold <= 10 ? tr('민감') : sceneCfg.threshold >= 20 ? tr('둔감') : tr('보통')}</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <input type="checkbox" checked={sceneCfg.rangeOn} onChange={e => setSceneCfg(v => ({ ...v, rangeOn: e.target.checked }))} /> {tr('구간만 감지 (전체보다 빠름)')}
            </label>
            {sceneCfg.rangeOn && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingLeft: 22 }}>
                    <input className="time-input" style={{ width: 70 }} placeholder="0:00" value={sceneCfg.startText} onChange={e => setSceneCfg(v => ({ ...v, startText: e.target.value }))} />
                    <span style={{ color: '#888' }}>~</span>
                    <input className="time-input" style={{ width: 70 }} placeholder={tr('끝(mm:ss)')} value={sceneCfg.endText} onChange={e => setSceneCfg(v => ({ ...v, endText: e.target.value }))} />
                </div>
            )}
            <div style={{ color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                {tr('장면이 바뀌는 지점을 정밀하게 찾아')} <b style={{ color: '#fde047' }}>{tr('노란 표시')}</b>{tr('로 타임라인에 찍습니다. 민감도를 올리면 미세한 전환도 잡습니다.')}
                {sceneDetect && <><br /><b style={{ color: 'var(--accent-soft)' }}>{tr('감지 중…')} {sceneDetect.total ? Math.round(sceneDetect.done / sceneDetect.total * 100) : 0}%</b></>}
            </div>
            {/* Detection is a scan of the whole video: worth it for a cut-heavy clip, pure
                cost for a single continuous take. Hence a choice rather than something that
                always happens on load. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}
                title={tr('영상을 불러올 때 장면 전환을 자동으로 찾습니다. 긴 영상에서는 시간이 걸립니다.')}>
                <input type="checkbox" checked={!!autoSceneDetect} onChange={e => setAutoSceneDetect(e.target.checked)} />
                {tr('자동 컷 감지')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                {hasCuts && <button className="button" onClick={clearVideoCuts}>{tr('컷 표시 지우기')}</button>}
                <button className="button" onClick={() => setSceneCfg(null)}>{tr('닫기')}</button>
                {sceneDetect
                    ? <button className="button" onClick={cancelSceneDetect}>{tr('감지 취소')}</button>
                    : <button className="button button-primary" onClick={() => runSceneDetect(sceneCfg)}>{tr('감지')}</button>}
            </div>
        </Modal>
    );
}
