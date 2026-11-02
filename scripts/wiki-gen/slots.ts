/**
 * Slots — the printed paytable and the credit RTP derived from it.
 * Owner: src/content/slots.ts. The odds are the game's own printed
 * table (the machine shows them in-game), and the RTP is computed by
 * the game's own slotCreditRtp() from the seeded weights — the figure
 * below is whatever that derivation returns on the shipped table.
 */
import {
  SLOT_OUTCOMES,
  SLOT_LEVER_DEFAULTS,
  SLOT_TIER_NAMES,
  SLOT_KEY_FALLBACK_FRAGMENTS,
  SLOT_BUNDLE_TARGET_MULTIPLIER,
  slotCreditRtp,
  slotOutcomePercent,
} from '../../src/content/slots';
import { type GenBlock, num, pct, table } from './lib';

function slotsBody(): string {
  const rows = SLOT_OUTCOMES.map((o) => [`**${o.label}**`, `${num(slotOutcomePercent(o))}%`, o.paysLabel]);
  const tiers = [1, 2, 3].map(
    (t) => `${SLOT_TIER_NAMES[t]} — ${[SLOT_LEVER_DEFAULTS.slotBetTier1, SLOT_LEVER_DEFAULTS.slotBetTier2, SLOT_LEVER_DEFAULTS.slotBetTier3][t - 1]} cr`,
  );
  const rtp = slotCreditRtp();
  return [
    table(['Outcome', 'Chance', 'Pays'], rows),
    '',
    `- **Credit RTP: ${pct(rtp)}** — derived from the table above (Σ weight × credit multiplier over the credit outcomes), not a hardcoded figure.`,
    `- Bet tiers: ${tiers.join(' · ')}.`,
    `- Daily pull cap: **${SLOT_LEVER_DEFAULTS.slotDailyPullCap} pulls** per UTC day (a live economy lever; 0 closes the machine).`,
    `- The Vendor Bundle prize is staples worth ≈${SLOT_BUNDLE_TARGET_MULTIPLIER}× the bet; the Cache Key prize pays **${SLOT_KEY_FALLBACK_FRAGMENTS} fragments** instead when the daily cache budget is full.`,
  ].join('\n');
}

export const slotsBlock: GenBlock = {
  id: 'slots',
  owners: ['src/content/slots.ts'],
  render: slotsBody,
};
