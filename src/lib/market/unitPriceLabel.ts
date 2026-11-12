/**
 * Per-unit price label for stack listings (audit M-2): the charged
 * total is `price` and unit prices are exact fractions (25cr over a
 * ×17 stack is 1.4705…/ea) — rounding the label to whole credits
 * ("1cr ea") implied a 17cr total for a 25cr stack. Print the exact
 * unit price: whole when it divides evenly, two decimals otherwise.
 * Used by the market row's fact line and the listing header in
 * MarketScreen, which printed the same rounded figure.
 */
export function fmtUnitPrice(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toFixed(2);
}
