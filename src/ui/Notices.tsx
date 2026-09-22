import { tr } from '../i18n.ts';
/** A count of things done out of a total. */
interface Progress { done: number; total: number }
/** The frame extraction in progress: its count, and whether it is still fetching the file. */
interface VideoBusy extends Progress { fetching?: boolean }
/** Everything the notice layer shows: the extraction chip, the backup chip, the toast and the error banner. */
export interface NoticesProps {
    videoBusy: VideoBusy | null;
    videoBusyBg: boolean;
    setVideoBusyBg: (on: boolean) => void;
    videoStopRef: { current: boolean };
    backupProg: Progress | null;
    toast: string | null;
    setToast: (s: string | null) => void;
    appError: string | null;
    setAppError: (s: string | null) => void;
}


// What the app says to the user while they keep working.
//
// Fetching a video and the automatic backup both take a while, so neither blocks the screen.
// They used to raise a full-screen overlay that stopped all work, which made a slow network
// look like a frozen app. Everything here is a corner chip or a bottom banner instead: it is
// visible, it is dismissable, and nothing underneath it stops.

/** The stack of background chips, bottom-right. Renders nothing when there is nothing to say. */
function BackgroundChips({ fetching, backupProg, toast, setToast }: { fetching: boolean, backupProg: Progress | null, toast: string | null, setToast: (s: string | null) => void }) {
    if (!fetching && !backupProg && !toast) return null;
    return (
        <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1500, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {fetching && (
                <div className="bg-chip">
                    <span className="bg-spin" /> {tr('영상 받는 중…')} <span style={{ color: '#888' }}>{tr('(작업 계속 가능)')}</span>
                </div>
            )}
            {backupProg && (
                <div className="bg-chip">
                    <span className="bg-spin" /> {tr('서버 백업')} {backupProg.done}/{backupProg.total}
                </div>
            )}
            {toast && (
                <div className="bg-chip" style={{ borderColor: 'var(--accent-hi)' }}>
                    {toast}
                    <button className="icon-btn" style={{ marginLeft: 4 }} onClick={() => setToast(null)}>✕</button>
                </div>
            )}
        </div>
    );
}

/** Frame extraction after it has been sent to the background: progress, reopen, stop. */
function VideoBusyChip({ videoBusy, setVideoBusyBg, videoStopRef }: { videoBusy: VideoBusy, setVideoBusyBg: (on: boolean) => void, videoStopRef: { current: boolean } }) {
    return (
        <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', color: '#ccc', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
            <span>{tr('프레임 추출')} {videoBusy.done}/{videoBusy.total || '?'}</span>
            <div style={{ width: 80, height: 6, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: `${videoBusy.total ? (videoBusy.done / videoBusy.total * 100) : 0}%`, background: 'var(--accent-soft)' }} /></div>
            <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => setVideoBusyBg(false)}>{tr('열기')}</button>
            <button className="button" style={{ height: 26, padding: '0 8px' }} onClick={() => { videoStopRef.current = true; }}>{tr('중지')}</button>
        </div>
    );
}

/** Failure banner: keeps the error on screen. With the API server down, a blocked alert used to
 *  make it look as though nothing had happened at all. */
function ErrorBanner({ appError, setAppError }: { appError: string | null, setAppError: (s: string | null) => void }) {
    return (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3000,
            maxWidth: 640, background: '#3a1414', border: '1px solid #a33', color: '#ffd9d9',
            borderRadius: 8, padding: '10px 14px', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center',
            boxShadow: '0 8px 28px rgba(0,0,0,.5)' }}>
            <span style={{ flex: 1 }}>{appError}</span>
            <button className="button" style={{ height: 26, padding: '0 10px' }} onClick={() => setAppError(null)}>{tr('닫기')}</button>
        </div>
    );
}

export function Notices({ videoBusy, videoBusyBg, setVideoBusyBg, videoStopRef, backupProg, toast, setToast, appError, setAppError }: NoticesProps) {
    return (
        <>
            <BackgroundChips fetching={!!videoBusy?.fetching} backupProg={backupProg} toast={toast} setToast={setToast} />
            {videoBusy && videoBusyBg && !videoBusy.fetching && (
                <VideoBusyChip videoBusy={videoBusy} setVideoBusyBg={setVideoBusyBg} videoStopRef={videoStopRef} />
            )}
            {appError && <ErrorBanner appError={appError} setAppError={setAppError} />}
        </>
    );
}
