/**
 * NPC market service account id.
 *
 * The NPC seller is a reserved service account whose listings seed the
 * player marketplace (cold start / restock). On Route B boots the
 * account row is created on demand inside the seed transaction (see
 * src/server/jobs/store.ts); this constant is only the well-known id.
 * Lives here since slice B6 retired src/server/lib/supabaseService.ts —
 * the id was never a Supabase concept, it just shared the file.
 */
export const NPC_MARKET_USER_ID =
  process.env.NPC_MARKET_USER_ID || '00000000-0000-0000-0000-000000000000';
