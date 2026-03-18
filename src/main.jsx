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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
