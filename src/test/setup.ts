import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Set dummy Supabase env vars so modules that call `requireSupabaseConfig`
// at import time (via the supabase client) don't throw in test runs that
// don't have a real `.env`. The values are never used to make real
// network calls — the per-test `vi.mock` of `verifiedOps` and
// `runtimeSupabaseSync` is what actually prevents real network access.
//
// This unblocks test files like `idleTickerSurvival.test.ts` and
// `idleTickerKillCycle.test.ts` that import the ticker (which in
// turn imports the supabase client) in environments without Supabase
// credentials configured.
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key';
