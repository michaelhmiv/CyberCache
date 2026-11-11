/**
 * The market listing deposit (economy tuning D3/P8; owner ruling
 * 2026-11-10) — the ONE owner of the deposit figure, mirroring how
 * marketFee.ts owns the sale fee.
 *
 * Creating any player-market listing charges this much Scrap,
 * snapshotted onto the listing at creation (SQL:
 * market_listings.deposit_scrap, migration 0087). The deposit
 * refunds in full when the listing sells — for a Quick-Buy sweep,
 * on the leg that closes the listing — and BURNS when the seller
 * cancels. Listings never expire in the shipped game
 * (src/lib/market/listingAge.ts), so there is no expiry leg. The
 * 5% sale fee and its floor are a separate mechanism and do not
 * change.
 *
 * The figure is an economy-config lever (marketListingDepositScrap
 * in src/server/economy/config.ts) so the Chef can move it without
 * a code change; this constant is the client-safe default the
 * lever falls back to and the listing form displays.
 */
export const MARKET_LISTING_DEPOSIT_SCRAP = 25;

/** Clamp a raw lever/config value into the deposit's legal band. */
export function clampListingDepositScrap(raw: number | null | undefined): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MARKET_LISTING_DEPOSIT_SCRAP;
  return Math.min(100000, Math.max(0, n));
}
