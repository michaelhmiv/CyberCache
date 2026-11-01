/**
 * Compact resource number formatting (device feedback r2).
 *
 * Bounds: full digits under 1,000; locale-grouped to 9,999
 * ("9,999"); K form to 999,949 ("999.9K"); M form to 999,949,999
 * ("999.9M"); B form above that. The widest possible output is 6
 * glyphs for any value under 10^12, which fits a phone-width
 * resource chip at the bar's value size — a resource value must
 * never need an ellipsis.
 */
export function compactResourceValue(n: number): string {
  if (n >= 999_950_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}
