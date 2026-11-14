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

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), authStub],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
