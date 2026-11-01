/**
 * Compact resource number formatting (device feedback r2).
 *
 * Bounds: full digits under 1,000; locale-grouped to 9,999
 * ("9,999"); K form to 999,949 ("999.9K"); M form to 999,949,999
 * ("999.9M"); B form above that. The widest possible output is 6
 * glyphs for any value under 10^12, which fits a phone-width
 * resource chip at the bar's value size — a resource value must
 * never need an ellipsis.
 *
 * Fractional balances (audit UX-05): roaming pays fractional
 * credits/scrap (+0.75cr/+0.15 scrap per tick) that bank server-side,
 * so a non-integer value under 10,000 renders with ONE decimal —
 * "5100.3", never the bare integer that made scrap look frozen.
 * Ungrouped on purpose: "5,100.3" would be 7 glyphs and break the
 * bound; a fraction that rounds up to 10000.0 falls into the K form.
 */
export function compactResourceValue(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 999_950_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (!Number.isInteger(n)) {
    const fixed = (Math.round(n * 10) / 10).toFixed(1);
    if (Number(fixed) < 10_000) return fixed;
    return `${(n / 1_000).toFixed(1)}K`;
  }
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}
