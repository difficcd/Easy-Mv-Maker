import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const isNativeCapacitor = (() => {
    try { return !!window.Capacitor; } catch { return false; }
})();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        // Capacitor bundles assets already; SW can cause stale-cache white screens on updates.
        if (isNativeCapacitor) {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            } catch { }
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch { }
            return;
        }
        navigator.serviceWorker.register('/sw.js').catch(() => { })
    })
}

const showFatalOverlay = (title, err) => {
    try {
        const root = document.getElementById('root') || document.body;
        const box = document.createElement('div');
        box.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:999999',
            'padding:16px',
            'background:#0b0b12',
            'color:#e5e7eb',
            'font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            'font-size:12px',
            'line-height:1.35',
            'overflow:auto',
            '-webkit-text-size-adjust:100%',
        ].join(';');
        const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err ?? '');
        box.textContent =
            `${title}\n\n` +
            `URL: ${location.href}\n` +
            `UA: ${navigator.userAgent}\n` +
            `Capacitor: ${isNativeCapacitor}\n\n` +
            `${msg}`;
        root.innerHTML = '';
        root.appendChild(box);
    } catch { }
};

window.addEventListener('error', (e) => {
    showFatalOverlay('Runtime Error', e?.error || e?.message || e);
});
window.addEventListener('unhandledrejection', (e) => {
    showFatalOverlay('Unhandled Promise Rejection', e?.reason || e);
});

try {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
} catch (e) {
    showFatalOverlay('App Boot Failed', e);
}
