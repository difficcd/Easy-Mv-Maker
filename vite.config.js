import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qrcode } from 'vite-plugin-qrcode'

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
    // Forward /api to the project-storage server (same-origin save/load, no CORS).
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
})
