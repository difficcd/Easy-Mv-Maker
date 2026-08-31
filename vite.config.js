import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qrcode } from 'vite-plugin-qrcode'

// Forward /api to the project-storage server, so saving and loading are same-origin and there
// is no CORS to configure. Shared between dev and preview - they used to differ, and preview
// silently having no backend is a hard thing to notice.
const API_PROXY = {
  '/api': { target: 'http://localhost:8787', changeOrigin: true },
};

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so Capacitor/Android WebView can load /assets (avoids white screen).
  base: './',
  // qrcode prints a scannable QR of the Network URL on `npm run dev` so a tablet can connect.
  plugins: [react(), qrcode()],
  server: {
    host: true, // expose on LAN so a tablet on the same Wi-Fi can connect
    port: 5173,
    strictPort: false,
    proxy: API_PROXY,
  },
  // `vite preview` does not inherit the dev server's proxy. Without this, the built app served
  // by preview has no backend at all: it probes /api/projects on load, gets an error from the
  // static server, and shows itself as offline. That is also what the boot smoke test saw.
  preview: {
    port: 4173,
    proxy: API_PROXY,
  },
})
