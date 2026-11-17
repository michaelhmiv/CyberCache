import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Craft-zoom round-3 home-capture config: identical to
// vite.config.ts except '@/auth/AuthProvider' resolves to the
// harness stub (src/harness/authStub.tsx), so the real Home
// screen can mount in the stills rig without a live auth
// bootstrap — the real provider's bootstrap resets the runtime
// stores the harness seeds. Used ONLY through
// capture-manifest.json's viteConfig field; the app build and
// the other harness pages never see it.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/auth/AuthProvider', replacement: path.resolve(__dirname, './src/harness/authStub.tsx') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
