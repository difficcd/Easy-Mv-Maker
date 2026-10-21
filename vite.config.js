import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qrcode } from 'vite-plugin-qrcode'

// Forward /api to the project-storage server, so saving and loading are same-origin and there
// is no CORS to configure. Shared between dev and preview - they used to differ, and preview
// silently having no backend is a hard thing to notice.
const API_PROXY = {
  '/api': { target: 'http://localhost:8787', changeOrigin: true },
};

// Serving on the LAN is what lets the tablet connect, so it stays the default. But it also puts
// /api on the LAN, through the proxy above - and the API has no authentication, so anyone on the
// same Wi-Fi can read, overwrite and delete projects. That used to happen silently, while
// SECURITY.md described a loopback-only server. MV_LAN=0 keeps the dev server on this machine,
// for a network you do not trust; otherwise it says so when it starts. The API server's own
// warning for MV_API_HOST is the model.
const LAN = process.env.MV_LAN !== '0';
const lanWarning = {
  name: 'mv-lan-warning',
  configureServer(server) {
    if (!LAN) return;
    server.httpServer?.once('listening', () => {
      server.config.logger.warn([
        '',
        '  [mv] /api is reachable from your network through this dev server, with no authentication.',
        '       Anyone on the same Wi-Fi can read and change your projects. On a network you do not',
        '       trust, start it with MV_LAN=0 (see SECURITY.md).',
        '',
      ].join('\n'));
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so Capacitor/Android WebView can load /assets (avoids white screen).
  base: './',
  // qrcode prints a scannable QR of the Network URL on `npm run dev` so a tablet can connect.
  plugins: [react(), qrcode(), lanWarning],
  server: {
    host: LAN, // on the LAN so a tablet on the same Wi-Fi can connect; MV_LAN=0 keeps it local
    // 5175, not Vite's default: another project on this machine holds 5173 permanently. The two
    // did not collide loudly, which was the problem - that one listens on ::1 and this one on
    // ::, `localhost` resolves to ::1 first, and so the browser quietly got the *other* app on
    // the address this one had just printed. strictPort turns the next such clash into a
    // refusal to start, which is the one outcome that cannot be mistaken for working.
    port: 5175,
    strictPort: true,
    proxy: API_PROXY,
  },
  build: {
    // Vite warns past 500 kB, counting the file on disk. Measured 2026-09-23: the bundle is
    // 648 kB on disk and **209 kB gzipped**, which is what actually travels, and that is a
    // reasonable first load for an app that is a canvas editor rather than a page. The fonts
    // are the heavy assets here (6 MB across eight CJK woff2) and they are not on this path -
    // each is an @font-face the browser fetches only if a text object uses that family.
    //
    // Raised rather than silenced, so a real regression still warns: this trips again at
    // roughly a third more code, and a warning that fires on every single build is one that
    // stops being read.
    chunkSizeWarningLimit: 900,
  },
  // `vite preview` does not inherit the dev server's proxy. Without this, the built app served
  // by preview has no backend at all: it probes /api/projects on load, gets an error from the
  // static server, and shows itself as offline. That is also what the boot smoke test saw.
  preview: {
    port: 4173,
    // Enforced, not preferred. The smoke test drives http://localhost:4173 by name; if the port
    // were taken and vite quietly moved to 4174, the test would pass or fail against whatever
    // else was listening there.
    strictPort: true,
    proxy: API_PROXY,
  },
})
