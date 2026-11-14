import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Harness vite config for the numbers-home take (THROWAWAY,
 * 2026-11-14) — copied verbatim from the dash/numbers tree: it is
 * the repo's own vite.base.config.ts plus an auth-stub plugin
 * (every AuthProvider specifier resolves to the offline stub in
 * src/harness/authStub.tsx) and fs.allow for the workspace root.
 * The repo's own vite.config.ts stays untouched in this tree; the
 * capture driver serves this file explicitly
 * (vite --config vite.config.ts).
 */
const authStubPlugin = {
  name: 'numbers-home-auth-stub',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (/AuthProvider/.test(id)) {
      return path.resolve(rootDir, 'src/harness/authStub.tsx');
    }
    return null;
  },
};

export default defineConfig({
  base: './',
  plugins: [authStubPlugin, react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    fs: {
      allow: [rootDir],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi/')) return 'pixi';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
