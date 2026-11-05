/**
 * Compact listing age — the only time fact a listing carries.
 * Listings never expire in the data model (listedAt is the sole
 * timestamp), so the Market's compact rows print AGE, never an
 * ends-at. Pure display math; the caller passes its render-time
 * clock snapshot so every row on the screen ages consistently.
 */
export function listingAgeLabel(listedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - listedAt) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
