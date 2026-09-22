import { tr } from '../../i18n';

// Progress for opening or uploading a large project. total 0 means the length is unknown,
// which shows as an indeterminate bar.
export function ProgressOverlay({ progress }: { progress: { label: string, done: number, total: number } | null | undefined }) {
    if (!progress) return null;
    const { label, done, total } = progress;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 340, background: 'hsl(var(--ui-h) var(--ui-s) 15%)', border: '1px solid hsl(var(--ui-h) var(--ui-s) 24%)', borderRadius: 10, padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
                <div style={{ fontSize: 13, color: '#ddd', marginBottom: 10 }}>{label}…</div>
                <div style={{ height: 8, background: 'hsl(var(--ui-h) var(--ui-s) 20%)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={pct == null
                        ? { height: '100%', width: '40%', borderRadius: 99, background: 'var(--accent)', animation: 'mvIndet 1.1s ease-in-out infinite' }
                        : { height: '100%', width: `${pct}%`, borderRadius: 99, background: 'var(--accent)', transition: 'width .12s linear' }} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{pct == null ? tr('잠시만 기다려 주세요') : `${done} / ${total}`}</span>
                    <span>{pct == null ? '' : `${pct}%`}</span>
                </div>
            </div>
        </div>
    );
}
