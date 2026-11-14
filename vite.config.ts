import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// HARNESS ONLY (throwaway rendering tree): stub Supabase auth so
// MarketScreen can mount in the vendor-qty harness without a
// session. Several modules import './AuthProvider' relatively,
// which bypasses resolve.alias — so rewrite at resolveId, matching
// every specifier that lands on the AuthProvider module. Not part
// of the design proposal.
const authStub = {
  name: 'vendorqty-auth-stub',
  enforce: 'pre' as const,
  resolveId(source: string) {
    // '@/auth/AuthProvider', '../auth/AuthProvider', './AuthProvider'
    // (the relative form is used only inside src/auth/), and the
    // already-aliased absolute path if a core plugin got there first.
    if (/(^|\/)AuthProvider(\.tsx?)?$/.test(source) && (source.includes('auth') || source.startsWith('.'))) {
      return path.resolve(__dirname, './src/harness/authStub.tsx')
    }
    return null
  },
}

// HARNESS ONLY (iter-04 ticker tree): stub the Chef client for the
// research surface so the REAL ResearchPanel can mount without a
// Chef server. The stub serves server facts and derives the view
// through the shipped researchStateView — production numbers, no
// mock math. Only the research functions are implemented; any other
// chefClient import in this tree's pages would fail loudly at
// import time rather than silently fabricate data.
const chefStub = {
  name: 'ticker-chef-stub',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (/(^|\/)chefClient(\.tsx?)?$/.test(source)) {
      return path.resolve(__dirname, './src/harness/ticker/chefResearchStub.ts')
    }
    return null
  },
}

export default defineConfig({
  base: './',
  // The workspace write flap intermittently EPERMs node writes.
  // Point the dep cache at the base clone's already-optimized
  // .vite dir (identical package set — the vendor harness ran on
  // it), so the optimizer reuses the bundle and writes nothing.
  cacheDir: '/home/hatch/workspace/cc-vendor-qty-wt/node_modules/.vite',
  plugins: [react(), tailwindcss(), authStub, chefStub],
  server: { port: 7140, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
