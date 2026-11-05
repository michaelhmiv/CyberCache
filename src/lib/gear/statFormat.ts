/**
 * The ONE percent formatter for item stats. The stat deck
 * (`itemStatDeck.ts`) and the loot-moment card (`lootMoment.ts`)
 * both print a weapon's crit chance; the deck rounded to whole
 * percent ("10%") while the card printed one decimal ("10.3%"), so
 * the same item disagreed with itself on the reveal page. Both now
 * compose from here — do not re-implement percent rounding in a
 * surface.
 */
export const pct = (value: number) => `${Math.round(value * 100)}%`;
export const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
