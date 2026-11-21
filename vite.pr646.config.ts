import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// PR #646 before/after capture config (dash/pr646-before +
// dash/pr646-after, dev only): identical to the store-shots
// config — the AuthProvider module resolves to the harness stub
// (src/harness/pr646AuthStub.tsx) under every specifier the tree
// uses, so the real screens mount without a live auth bootstrap.
// Used ONLY through capture-manifest.json's viteConfig field.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/auth/AuthProvider', replacement: path.resolve(__dirname, './src/harness/pr646AuthStub.tsx') },
      { find: /^\.\/auth\/AuthProvider$/, replacement: path.resolve(__dirname, './src/harness/pr646AuthStub.tsx') },
      { find: /^\.\.\/auth\/AuthProvider$/, replacement: path.resolve(__dirname, './src/harness/pr646AuthStub.tsx') },
      { find: /^\.\/AuthProvider$/, replacement: path.resolve(__dirname, './src/harness/pr646AuthStub.tsx') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
