import { Rarity } from '@/types/game';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { rollQualityLabel } from '@/constants/rarities';
import { SHIELD_BEHAVIORS, shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { pct } from '@/lib/gear/statFormat';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import { bespokeSpriteIdForWeapon, normalizeLegendaryName } from './manifest';
import { MOVEMENT, isTickHit } from './movement';
import type { TickEvent } from '@/store/slices/tickSlice';

/**
 * Loot moment logic (P3) — the pure half of the loot celebration system
 * (pixel-production-spec.md §5: "loot is the reward; the game stops and
 * celebrates it, scaled by rarity").
 *
 * Everything here is a pure function of drop data the Chef/tick system
 * already decided: rarity → celebration tier, item → drop-card data,
 * drop list → rarity ladder, and the moment's playback state machine
 * (including the skip rule). The component (LootMoment.tsx) only renders
 * what this module derives. Nothing here rolls, alters, delays, or gates
 * a reward — presentation only, per the architecture rule that screens
 * never produce gameplay outcomes.
 */

// ── Rarity → celebration ───────────────────────────────────────────────

export const RARITY_RANK: Record<Rarity, number> = {
  [Rarity.Common]: 0,
  [Rarity.Uncommon]: 1,
  [Rarity.Rare]: 2,
  [Rarity.Epic]: 3,
  [Rarity.Legendary]: 4,
};

export type LootTier = 'modest' | 'bright' | 'grand' | 'legendary';

export interface LootCelebration {
  tier: LootTier;
  /** Beam/card color — the shared rarity identity (RARITY_FRAME_STYLES). */
  color: string;
  /** How long this drop's step holds before the ladder advances (spec §5). */
  durationMs: number;
  /** Beam width in px at stage scale. Scales with tier (spec §5). */
  beamWidthPx: number;
  /** Ground flare width, as a multiple of the beam width. */
  flareScale: number;
  /** Legendary only: the world dims ~40% behind the gold pillar. */
  dimWorld: boolean;
  /** Legendary only: rotating god rays behind the risen weapon. */
  godRays: boolean;
  /** Legendary only: a shockwave ring rolls across the ground. */
  shockwave: boolean;
  /** The item itself rises out of the beam and floats — every rarity
   *  (item-moment reveal, owner-approved 2026-11-03: the item is the
   *  moment; before this the rise was legendary-only and ordinary
   *  drops never showed the item at all). */
  weaponRise: boolean;
}

const CELEBRATION_BY_RARITY: Record<Rarity, Omit<LootCelebration, 'color'>> = {
  [Rarity.Common]: {
    tier: 'modest', durationMs: MOVEMENT.LOOT_COMMON_MS, beamWidthPx: 10, flareScale: 2.2,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: true,
  },
  [Rarity.Uncommon]: {
    tier: 'modest', durationMs: MOVEMENT.LOOT_UNCOMMON_MS, beamWidthPx: 14, flareScale: 2.4,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: true,
  },
  [Rarity.Rare]: {
    tier: 'bright', durationMs: MOVEMENT.LOOT_RARE_MS, beamWidthPx: 22, flareScale: 2.8,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: true,
  },
  [Rarity.Epic]: {
    tier: 'grand', durationMs: MOVEMENT.LOOT_EPIC_MS, beamWidthPx: 34, flareScale: 3.2,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: true,
  },
  [Rarity.Legendary]: {
    tier: 'legendary', durationMs: MOVEMENT.LOOT_LEGENDARY_MS, beamWidthPx: 68, flareScale: 3.6,
    dimWorld: true, godRays: true, shockwave: true, weaponRise: true,
  },
};

export function lootCelebrationForRarity(rarity: Rarity): LootCelebration {
  return { ...CELEBRATION_BY_RARITY[rarity], color: RARITY_FRAME_STYLES[rarity].color };
}

/**
 * The rise budget inside one celebration beat: the ladder's
 * durationMs is a HOLD inside a composite (beam ignite + rise +
 * staggered deck), and the rise itself is capped at LOOT_RISE_MS
 * with a 300ms floor — the exact curve LootMoment's risen item
 * and cache prop run. Surfaces that present a drop on the
 * ladder's timings without the moment (the Return Sheet poster)
 * rise on this budget and hold settled for the remainder of the
 * beat, instead of stretching the whole hold into one slow ease.
 */
export function lootRiseBudgetMs(durationMs: number): number {
  return Math.max(300, Math.min(MOVEMENT.LOOT_RISE_MS, durationMs - 300));
}

// ── Drop card data ─────────────────────────────────────────────────────

export interface LootCardData {
  itemId: string;
  name: string;
  rarity: Rarity;
  /** Rarity color (shared identity source). */
  color: string;
  /** What kind of gear this is: 'SNIPER', 'SHIELD', 'CLASS MOD', … */
  kindLabel: string;
  /** The card's stamp line: 'RARE SNIPER', '★ LEGENDARY BEAM', … */
  stamp: string;
  /** Legendary flavor line — the hand-written override for the named
   *  legendary (LEGENDARY_FLAVOR_OVERRIDES), else its effect's text. */
  flavor?: string;
  /** One-line real stat summary derived from the item's own fields. */
  statLine: string;
  isWeapon: boolean;
  /** Bespoke legendary sprite id when the name has fixed art (P1 map). */
  bespokeSpriteId?: string;
}

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is Shield => 'hp' in item && 'rechargeRate' in item;
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item;
// Anything else with the shared gear shape is a Relic (the fallthrough).

export function gearKindLabel(item: GearItem): string {
  if (isWeapon(item)) return item.weaponType.toUpperCase();
  if (isShield(item)) return 'SHIELD';
  if (isClassMod(item)) return 'CLASS MOD';
  if (isOrdnance(item)) return 'ORDNANCE';
  return 'RELIC';
}

const fmtInt = (value: number): string => Math.round(value).toLocaleString('en-US');
const fmtRate = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
};

/**
 * The weapon stat figures — ONE source for every surface that prints
 * them (DISP-03, audit fix A): this celebration line and WeaponCard.
 * Formats are the card's contract: damage as rolled, speed at two
 * decimals, crit as a true percentage. The celebration used to round
 * speed to one decimal and print the crit FRACTION as
 * if it were a percent (0.095 → "0.1%"), so the same item read
 * "FR 1.5 · CRIT 0.1%" in the celebration and "Spd 1.47 · Crit 9.5%"
 * on its card in the 2026-11-01 walk. Crit formatting itself is the
 * shared `pct` from statFormat.ts — the reveal deck below the moment
 * rounds to whole percent, and the card must agree with it exactly
 * (10.3% on the card vs 10% in the deck was the papercut).
 */
export function weaponStatFigures(item: Weapon): { dmg: string; spd: string; crit: string } {
  return {
    dmg: fmtInt(item.baseDamage),
    spd: item.attackSpeed.toFixed(2),
    crit: pct(item.critChance),
  };
}

/**
 * A shield's mitigation as a display percentage. Mitigation is stored
 * as a FRACTION (the generator rolls 0.05–0.8; GearInspectSheet and
 * gearCardSummary both print ×100). The loot card used to format the
 * raw fraction — an 8% shield read "MIT 0.1%" (item-moment reveal
 * rider, verified 2026-11-03). One formatter so the card line and the
 * reveal deck can never disagree again.
 */
export function shieldMitigationPct(item: Shield): string {
  return fmtRate(item.mitigation * 100);
}

/** The card's stat line — real numbers from the item's own rolled fields. */
export function lootStatLine(item: GearItem): string {
  if (isWeapon(item)) {
    const figures = weaponStatFigures(item);
    return `Dmg ${figures.dmg} · Spd ${figures.spd} · Crit ${figures.crit}`;
  }
  if (isShield(item)) {
    // Behavior (Phase 2c): named on the loot card when non-Standard.
    const behavior = shieldBehaviorOf(item);
    const behaviorLabel =
      behavior !== 'standard' ? ` · ${SHIELD_BEHAVIORS[behavior].name.toUpperCase()}` : '';
    return `HP ${fmtInt(item.hp)} · RECHARGE ${fmtRate(item.rechargeRate)}/s · MIT ${shieldMitigationPct(item)}%${behaviorLabel}`;
  }
  if (isClassMod(item)) {
    const boosts = Object.keys(item.nodeBoosts ?? {}).length;
    return boosts > 0 ? `TREE ${item.treeBonus.toUpperCase()} · +${boosts} NODES` : `TREE ${item.treeBonus.toUpperCase()}`;
  }
  if (isOrdnance(item)) {
    return `DMG ${fmtInt(item.damage)} · SHLD ${fmtInt(item.shieldDamage)} · ARM ${fmtInt(item.armorDamage)}`;
  }
  const relic = item as Relic;
  return relic.affixes?.[0]?.displayText ?? 'No affixes';
}

/**
 * Hand-written flavor lines for the named legendaries, keyed by normalized
 * legendary name — the same key space as the bespoke-sprite map
 * (BESPOKE_LEGENDARY_SPRITES). P3 shipped the effect description as the
 * card's flavor and flagged these overrides as P4 asset-production work;
 * the voice is the approved proof's ("Sets the sky on fire. Literally."):
 * one short, dry, characterful line per legendary. Covers all 25 effects
 * in LEGENDARY_EFFECTS plus Emberfall, the proof's named rifle.
 */
export const LEGENDARY_FLAVOR_OVERRIDES: Record<string, string> = {
  emberfall: 'Sets the sky on fire. Literally.',
  'debt collector': 'It always collects. Eventually is not in its vocabulary.',
  'warranty void': 'The manufacturer has been notified. They are devastated.',
  'ricochet gospel': 'It gets there in the end. Faith, but with angles.',
  'bad decision': 'You knew. You fired it anyway.',
  'glass sun': 'Do not look directly at the results.',
  'the accountant': 'Every shot reconciled. Nothing gets written off.',
  'armor eater': "It doesn't break armor. It has lunch.",
  'thunder receipt': 'Itemized. Dated. Delivered at muzzle velocity.',
  'second opinion': 'Ask again. The answer has two barrels.',
  'salvage rights': 'Everything it kills is legally yours. Twice over.',
  overclocked: 'The warranty is gone. So is the speed limit.',
  'borrowed time': 'Due back at the end of the fight. Late fees are severe.',
  kickback: 'Every seventh hit sends a thank-you note.',
  'vampiric ledger': 'It bills in blood. It pays out in credits.',
  'echo chamber': 'It agrees with everything you fire. Loudly. Twice.',
  'insurance fraud': 'Act of god? No. Act of gun.',
  'market crash': "Sell. SELL. It's already sold.",
  'stable loop': 'It hums at a frequency that makes physics behave.',
  'phase shifter': 'Walls are a suggestion it politely declines.',
  'hot swapper': 'Reloading is a rumor it never believed.',
  'chain lightning': 'It introduces your enemies to each other.',
  'molten core': "The planet's worst idea, chambered.",
  'cryo stasis': 'It gives them time to think. Forever.',
  'void bargain': 'Sign here. The fine print signs back.',
  jackpot: "Every 150th pull pays out. It keeps count so you don't have to.",
};

export function legendaryFlavorOverride(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return LEGENDARY_FLAVOR_OVERRIDES[normalizeLegendaryName(name)];
}

/**
 * Flavor text for the gold card. A hand-written override wins — by the
 * weapon's own name first (Emberfall), then by its legendary effect's
 * name (every real drop) — and the effect's own description is the
 * fallback for any legendary without an override line.
 */
export function lootFlavor(item: GearItem): string | undefined {
  if (item.rarity !== Rarity.Legendary || !isWeapon(item)) return undefined;
  const effect = item.legendaryEffectId
    ? LEGENDARY_EFFECTS.find((entry) => entry.id === item.legendaryEffectId)
    : undefined;
  return legendaryFlavorOverride(item.name) ?? legendaryFlavorOverride(effect?.name) ?? effect?.description;
}

export function lootCardData(item: GearItem): LootCardData {
  const kindLabel = gearKindLabel(item);
  return {
    itemId: item.id,
    name: item.name,
    rarity: item.rarity,
    color: RARITY_FRAME_STYLES[item.rarity].color,
    kindLabel,
    stamp: item.rarity === Rarity.Legendary ? `★ LEGENDARY ${kindLabel}` : `${item.rarity.toUpperCase()} ${kindLabel}`,
    flavor: lootFlavor(item),
    statLine: lootStatLine(item),
    isWeapon: isWeapon(item),
    bespokeSpriteId: bespokeSpriteIdForWeapon(item),
  };
}

// ── The reveal deck (item-moment reveal, 2026-11-03) ───────────────────
// The stage presentation's stat deck: the item's own numbers staged the
// way the approved exploration specified — the effective value at hero
// size, two support figures beside it, affix percentages vivid, a
// dedicated strip for an activity module, and the roll quality read
// honestly. Pure derivation from the item, like lootCardData; the
// component (LootMoment.tsx) only renders what this returns.

export interface LootDeckFigure {
  label: string;
  value: string;
}

/** One affix line split into its leading signed figure (rendered vivid)
 *  and the remainder. Mirrors the exploration renderer's rich_line: a
 *  figure exists only when the text opens with a signed percentage. */
export interface LootDeckAffixLine {
  figure: string;
  rest: string;
}

export function splitAffixFigure(text: string): LootDeckAffixLine {
  const match = /^([+-][\d.]+%)/.exec(text);
  if (!match) return { figure: '', rest: text };
  return { figure: match[1], rest: text.slice(match[1].length) };
}

export interface LootDeckData {
  name: string;
  rarity: Rarity;
  color: string;
  /** 'LEGENDARY SNIPER · FIRE · LV 7' — rarity · kind · element · level. */
  stamp: string;
  /** The legendary effect banner (legendary weapons with a resolvable
   *  effect only). Name renders uppercase in rarity color. */
  effect: { name: string; description: string } | null;
  /** The hero figure (effective value). Relics carry no core stat —
   *  null there; their affix rows are the read. */
  hero: LootDeckFigure | null;
  /** Support figures beside the hero (SPD/CRIT, RECHARGE/MITIGATION…). */
  supports: LootDeckFigure[];
  /** Non-activity affixes, figure-split. */
  affixes: LootDeckAffixLine[];
  /** The activity-module strip: the module's own displayText, split
   *  into its title ('Salvage Module [95%]') and its yield lines. */
  module: { title: string; lines: LootDeckAffixLine[] } | null;
  /** Weapons only — gear items carry no rollQuality. */
  quality: { value: number; label: string } | null;
  flavor?: string;
}

const affixesOfItem = (item: GearItem): Affix[] =>
  'affixes' in item && Array.isArray(item.affixes) ? item.affixes : [];

export function lootDeckData(item: GearItem): LootDeckData {
  const kindLabel = gearKindLabel(item);
  const element = 'element' in item ? String(item.element).toUpperCase() : null;
  const stamp = [
    `${item.rarity.toUpperCase()} ${kindLabel}`,
    ...(element ? [element] : []),
    `LV ${item.level}`,
  ].join(' · ');

  let effect: LootDeckData['effect'] = null;
  let hero: LootDeckFigure | null = null;
  let supports: LootDeckFigure[] = [];
  let quality: LootDeckData['quality'] = null;

  if (isWeapon(item)) {
    const figures = weaponStatFigures(item);
    hero = { label: 'DAMAGE', value: figures.dmg };
    supports = [
      { label: 'SPD', value: figures.spd },
      { label: 'CRIT', value: figures.crit },
    ];
    quality = { value: item.rollQuality, label: rollQualityLabel(item.rollQuality).toUpperCase() };
    if (item.rarity === Rarity.Legendary && item.legendaryEffectId) {
      const entry = LEGENDARY_EFFECTS.find((candidate) => candidate.id === item.legendaryEffectId);
      if (entry) effect = { name: entry.name, description: entry.description };
    }
  } else if (isShield(item)) {
    hero = { label: 'SHIELD HP', value: fmtInt(item.hp) };
    supports = [
      { label: 'RECHARGE', value: `${fmtRate(item.rechargeRate)}/s` },
      { label: 'MITIGATION', value: `${shieldMitigationPct(item)}%` },
    ];
    const behavior = shieldBehaviorOf(item);
    if (behavior !== 'standard') {
      supports = [...supports, { label: 'BEHAVIOR', value: SHIELD_BEHAVIORS[behavior].name.toUpperCase() }];
    }
  } else if (isOrdnance(item)) {
    hero = { label: 'DAMAGE', value: fmtInt(item.damage) };
    supports = [
      { label: 'SHLD', value: fmtInt(item.shieldDamage) },
      { label: 'ARM', value: fmtInt(item.armorDamage) },
    ];
  } else if (isClassMod(item)) {
    const boosts = Object.values(item.nodeBoosts ?? {});
    hero = { label: 'NODE BOOST', value: `+${boosts.reduce((sum, value) => sum + value, 0)}` };
    supports = [
      { label: 'TREE', value: item.treeBonus.toUpperCase() },
      { label: 'NODES', value: `${boosts.length}` },
    ];
  }

  let module: LootDeckData['module'] = null;
  const affixes: LootDeckAffixLine[] = [];
  for (const affix of affixesOfItem(item)) {
    if (affix.category === 'activity' && affix.subStats && !module) {
      const parts = affix.displayText.split(' · ');
      module = { title: parts[0] ?? affix.displayText, lines: parts.slice(1).map(splitAffixFigure) };
    } else {
      affixes.push(splitAffixFigure(affix.displayText));
    }
  }

  return {
    name: item.name,
    rarity: item.rarity,
    color: RARITY_FRAME_STYLES[item.rarity].color,
    stamp,
    effect,
    hero,
    supports,
    affixes,
    module,
    quality,
    // With the effect banner up, the banner already carries the
    // effect's description — the flavor line is the hand-written
    // override only, never the same text twice. Without a banner,
    // lootFlavor's own fallback chain applies.
    flavor: effect
      ? legendaryFlavorOverride(item.name) ?? legendaryFlavorOverride(effect.name)
      : lootFlavor(item),
  };
}

/**
 * The deck's row-landing schedule (ms from the step's start) — the
 * exploration's beat map fitted inside the EXISTING step durations
 * (movement.ts is law; nothing here extends a step). The deck panel is
 * fixed at final geometry from its first frame; rows land at these
 * times. Legendary withholds name/hero so the rise gets a clean frame
 * first; affixes stagger; flavor lands last.
 */
export interface LootDeckSchedule {
  panelMs: number;
  bannerMs: number;
  nameMs: number;
  heroMs: number;
  affixStartMs: number;
  affixStaggerMs: number;
  moduleMs: number;
  qualityMs: number;
  flavorMs: number;
}

export function lootDeckSchedule(
  rarity: Rarity,
  opts: { affixCount: number; hasModule: boolean },
): LootDeckSchedule {
  const celebration = lootCelebrationForRarity(rarity);
  const step = celebration.durationMs;
  const base: Record<Rarity, Omit<LootDeckSchedule, 'moduleMs' | 'qualityMs' | 'flavorMs'>> = {
    [Rarity.Common]: { panelMs: 160, bannerMs: 300, nameMs: 300, heroMs: 480, affixStartMs: 580, affixStaggerMs: 100 },
    [Rarity.Uncommon]: { panelMs: 200, bannerMs: 340, nameMs: 340, heroMs: 520, affixStartMs: 620, affixStaggerMs: 105 },
    [Rarity.Rare]: { panelMs: 240, bannerMs: 380, nameMs: 380, heroMs: 560, affixStartMs: 680, affixStaggerMs: 110 },
    [Rarity.Epic]: { panelMs: 280, bannerMs: 420, nameMs: 420, heroMs: 640, affixStartMs: 760, affixStaggerMs: 120 },
    [Rarity.Legendary]: { panelMs: 560, bannerMs: 700, nameMs: 820, heroMs: 1100, affixStartMs: 1450, affixStaggerMs: 150 },
  };
  const b = base[rarity];
  const lastAffixMs = b.affixStartMs + b.affixStaggerMs * Math.max(0, opts.affixCount - 1);
  const moduleMs = opts.hasModule ? lastAffixMs + b.affixStaggerMs : 0;
  const qualityMs =
    rarity === Rarity.Legendary
      ? step - 250
      : Math.min(step - 120, Math.max(b.affixStartMs + b.affixStaggerMs * opts.affixCount, moduleMs + (opts.hasModule ? 110 : 0)));
  return { ...b, moduleMs, qualityMs, flavorMs: qualityMs };
}

// ── The ladder ─────────────────────────────────────────────────────────

/**
 * Multi-drop order (spec §5): ascending rarity ladder — each drop builds
 * on the last and the best drop takes the finale slot. Stable within a
 * rarity (original order preserved).
 */
export function orderLootLadder<T extends GearItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RARITY_RANK[a.item.rarity] - RARITY_RANK[b.item.rarity] || a.index - b.index)
    .map((entry) => entry.item);
}

export interface LootMomentStep {
  item: GearItem;
  card: LootCardData;
  celebration: LootCelebration;
}

export interface LootMomentPlan {
  steps: LootMomentStep[];
  /** The best drop — always the last step (the ladder's finale slot). */
  finale: LootMomentStep;
  hasLegendary: boolean;
  /** Sum of step durations — the unskipped playback length. */
  totalMs: number;
}

export function planLootMoment(items: readonly GearItem[]): LootMomentPlan | null {
  if (!items.length) return null;
  const steps = orderLootLadder(items).map((item) => ({
    item,
    card: lootCardData(item),
    celebration: lootCelebrationForRarity(item.rarity),
  }));
  return {
    steps,
    finale: steps[steps.length - 1],
    hasLegendary: steps.some((step) => step.celebration.tier === 'legendary'),
    totalMs: steps.reduce((sum, step) => sum + step.celebration.durationMs, 0),
  };
}

// ── Escalation: full vs light ──────────────────────────────────────────

export type LootSurface = 'feed' | 'stage';
export type LootMomentMode = 'full' | 'light';

/**
 * Escalation rule (spec §5: "never blocking idle flow for repeat trash"):
 * - 'stage' surfaces (boss result, cache reveal — moments the player
 *   deliberately triggered) always play the FULL celebration.
 * - 'feed' surfaces (roaming/idle drops ticking by) play LIGHT — an
 *   in-scene beam + card that never dims or blocks — unless a legendary
 *   drops, which always earns the full treatment.
 */
export function lootMomentMode(items: readonly GearItem[], surface: LootSurface): LootMomentMode | null {
  if (!items.length) return null;
  if (surface === 'stage') return 'full';
  return items.some((item) => item.rarity === Rarity.Legendary) ? 'full' : 'light';
}

// ── Playback state machine (skip rules) ────────────────────────────────

export interface LootMomentState {
  stepIndex: number;
  /** playing → advancing through the ladder; settled → skipped to the
   *  completed stack; done → hand control back to the host. */
  status: 'playing' | 'settled' | 'done';
  skipped: boolean;
}

export const initialLootMomentState: LootMomentState = { stepIndex: 0, status: 'playing', skipped: false };

export type LootMomentAction =
  | { type: 'advance'; stepCount: number }
  | { type: 'tap'; seenBefore: boolean }
  | { type: 'settleDone' };

/**
 * Skip rule (spec §5: "skippable on tap after first view"): the first
 * time a player ever sees the moment it plays through, so they learn
 * what it is; after that, a tap settles straight to the completed stack
 * (every card visible, finale in place) and the moment ends after the
 * skip linger. Skipping only ever changes presentation state — the
 * drops themselves were awarded before the moment started and nothing
 * here can lose one.
 */
export function lootMomentReducer(state: LootMomentState, action: LootMomentAction): LootMomentState {
  switch (action.type) {
    case 'advance': {
      if (state.status !== 'playing') return state;
      if (state.stepIndex + 1 >= action.stepCount) return { ...state, status: 'done' };
      return { ...state, stepIndex: state.stepIndex + 1 };
    }
    case 'tap': {
      if (state.status !== 'playing' || !action.seenBefore) return state;
      return { ...state, status: 'settled', skipped: true };
    }
    case 'settleDone': {
      return state.status === 'settled' ? { ...state, status: 'done' } : state;
    }
  }
}

// ── Tick-feed adapter ──────────────────────────────────────────────────

/**
 * The gear item a tick event actually dropped, or null. Hit events share
 * tone 'loot' with drops (their label is a negative damage number and
 * they carry no gear), so both the gear payload and the hit check gate
 * this — a damage tick must never celebrate as loot.
 */
export function gearDropFromEvent(event: TickEvent | undefined): GearItem | null {
  if (!event || event.tone !== 'loot' || !event.gear) return null;
  if (isTickHit(event)) return null;
  return event.gear;
}

/**
 * Loot-rise honesty (Michael's ruling, 2026-11-02): the rise over the kill
 * site must picture what the tick ACTUALLY granted — never the cache crate
 * for a lesser find. The mapping is driven by the grant the event carries:
 *
 * - tone 'fragment' — a cache-key fragment (value = fragments awarded;
 *   5 fragments settle into 1 key in the rewards layer) → key-shard rise.
 * - tone 'material' / 'essence' — a material or essence find → its own icon.
 * - tone 'kill' — every tick pays base credits + scrap + XP (chef.ts),
 *   and tone 'cash' pays credits/scrap → the scrap (or coin) rise.
 * - tone 'cache' — the union's real cache-grant tone (a completed key or
 *   an actual Cache Box grant) → the crate rise. No roaming producer
 *   emits it today, so the crate is unreachable from roaming ticks —
 *   that is the correct outcome, not a gap to fill with an invented grant.
 * - Gear drops are the LootMoment's, and damage ticks (tone 'loot',
 *   label '-N') are not loot at all: both map to null here.
 */
export type LootRiseVisual = 'crate' | 'fragment' | 'material' | 'essence' | 'scrap' | 'credits';

export function lootRiseVisualForEvent(event: TickEvent | undefined): LootRiseVisual | null {
  if (!event || event.id === 'idle-loop-ready') return null;
  if (gearDropFromEvent(event)) return null;
  switch (event.tone) {
    case 'cache':
      return 'crate';
    case 'fragment':
      return 'fragment';
    case 'material':
      return 'material';
    case 'essence':
      return 'essence';
    case 'kill':
      // Kill ticks always pay base scrap alongside credits and XP.
      return 'scrap';
    case 'cash':
      return event.label.toLowerCase().includes('scrap') ? 'scrap' : 'credits';
    default:
      return null;
  }
}
