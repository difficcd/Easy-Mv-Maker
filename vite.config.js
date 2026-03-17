import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // Capacitor/Android WebView can load assets under non-root schemes; relative base avoids white-screen from /assets paths.
  base: './',
  plugins: [react()],
})
