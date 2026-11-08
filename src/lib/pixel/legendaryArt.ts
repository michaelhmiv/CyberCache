import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import { LEGENDARY_AUTHORED, type LegendaryAuthoredSet } from './legendaryAuthoredData';

/**
 * Bespoke legendary weapon art — resolution + authored data access.
 *
 * Legendaries have fixed identities, so they get fixed art (production
 * spec §3). Through P4 wave 2 that art was a baked sprite per legendary
 * in the pixel manifest. Full Visual Program V4 (2026-11-07) re-authored
 * all 26 as hand-authored pxl data (legendaryAuthoredData.ts): the ids
 * below now name AUTHORED DATA SETS, not manifest sprites, and every
 * surface renders them through the same compositor path as procedural
 * weapons. The id space ('legendary-<slug>') is unchanged, so loot
 * cards, the parity fixture, and the wiki plates keep one vocabulary.
 *
 * This module is deliberately pure (no Vite asset imports): the
 * compositors and the node-side wiki generator both load it. It lived
 * in manifest.ts through V3; manifest.ts re-exports these names for
 * compatibility.
 *
 * The game's named legendaries are the 25 effects in
 * `src/constants/legendaryEffects.ts`: a legendary weapon's named
 * identity is the effect it carries (its name is what the loot card,
 * the codex, and the player call it). The map is keyed by the effect's
 * name — the same key space as a weapon that literally carries the
 * name (Emberfall, the name-keyed proof legendary with no effect def).
 * Procedural weapons never hit this map.
 */
export const BESPOKE_LEGENDARY_SPRITES: Record<string, string> = {
  emberfall: 'legendary-emberfall',
  'debt collector': 'legendary-debt-collector',
  'warranty void': 'legendary-warranty-void',
  'ricochet gospel': 'legendary-ricochet-gospel',
  'bad decision': 'legendary-bad-decision',
  'glass sun': 'legendary-glass-sun',
  'the accountant': 'legendary-the-accountant',
  'armor eater': 'legendary-armor-eater',
  'thunder receipt': 'legendary-thunder-receipt',
  'second opinion': 'legendary-second-opinion',
  'salvage rights': 'legendary-salvage-rights',
  overclocked: 'legendary-overclocked',
  'borrowed time': 'legendary-borrowed-time',
  kickback: 'legendary-kickback',
  'vampiric ledger': 'legendary-vampiric-ledger',
  'echo chamber': 'legendary-echo-chamber',
  'insurance fraud': 'legendary-insurance-fraud',
  'market crash': 'legendary-market-crash',
  'stable loop': 'legendary-stable-loop',
  'phase shifter': 'legendary-phase-shifter',
  'hot swapper': 'legendary-hot-swapper',
  'chain lightning': 'legendary-chain-lightning',
  'molten core': 'legendary-molten-core',
  'cryo stasis': 'legendary-cryo-stasis',
  'void bargain': 'legendary-void-bargain',
  jackpot: 'legendary-jackpot',
};

export function normalizeLegendaryName(name: string): string {
  return name.trim().toLowerCase();
}

export function bespokeSpriteIdForWeaponName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return BESPOKE_LEGENDARY_SPRITES[normalizeLegendaryName(name)];
}

/**
 * Bespoke art id for a legendary effect id, resolved through the
 * effect's name into the same name-keyed map — so a dropped legendary,
 * whose rolled weapon name is procedural, still finds the fixed art
 * for the named legendary it actually is.
 */
export function bespokeSpriteIdForLegendaryEffect(effectId: string | undefined): string | undefined {
  if (!effectId) return undefined;
  const effect = LEGENDARY_EFFECTS.find((entry) => entry.id === effectId);
  return effect ? bespokeSpriteIdForWeaponName(effect.name) : undefined;
}

/**
 * Full bespoke resolution for a weapon: its own name wins (a weapon
 * named Emberfall is Emberfall), otherwise its legendary effect's name
 * decides. Returns undefined for procedural weapons — the compositor's
 * procedural path.
 */
export function bespokeSpriteIdForWeapon(weapon: {
  name?: string;
  legendaryEffectId?: string;
}): string | undefined {
  return bespokeSpriteIdForWeaponName(weapon.name) ?? bespokeSpriteIdForLegendaryEffect(weapon.legendaryEffectId);
}

/** The authored data set behind a bespoke legendary id, if it exists. */
export function legendaryAuthoredSetForId(id: string | undefined): LegendaryAuthoredSet | undefined {
  return id ? LEGENDARY_AUTHORED[id] : undefined;
}

/** The authored data set a weapon resolves to, if it is a named legendary. */
export function legendaryAuthoredForWeapon(weapon: {
  name?: string;
  legendaryEffectId?: string;
}): LegendaryAuthoredSet | undefined {
  return legendaryAuthoredSetForId(bespokeSpriteIdForWeapon(weapon));
}
