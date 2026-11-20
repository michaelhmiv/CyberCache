import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Store-screenshots capture config (dash/store-shots): identical
// to vite.config.ts except the AuthProvider module resolves to
// the harness stub (src/harness/authStub.tsx), so the real
// screens can mount in the stills rig without a live auth
// bootstrap — the real provider's bootstrap resets the runtime
// stores the harness seeds. The stub is bound under every
// specifier the tree uses for the module: the canonical
// '@/auth/AuthProvider' AND the relative forms src/auth
// internals use. Used ONLY through capture-manifest.json's
// viteConfig field; the app build and the other harness pages
// never see it.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/auth/AuthProvider', replacement: path.resolve(__dirname, './src/harness/authStub.tsx') },
      { find: /^\.\/AuthProvider$/, replacement: path.resolve(__dirname, './src/harness/authStub.tsx') },
      { find: /^\.\.\/auth\/AuthProvider$/, replacement: path.resolve(__dirname, './src/harness/authStub.tsx') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
