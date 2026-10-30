import { Rarity } from '@/types/game';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import { bespokeSpriteIdForWeaponName } from './manifest';
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
  /** Legendary only: the weapon rises out of the beam and floats. */
  weaponRise: boolean;
}

const CELEBRATION_BY_RARITY: Record<Rarity, Omit<LootCelebration, 'color'>> = {
  [Rarity.Common]: {
    tier: 'modest', durationMs: MOVEMENT.LOOT_COMMON_MS, beamWidthPx: 10, flareScale: 2.2,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: false,
  },
  [Rarity.Uncommon]: {
    tier: 'modest', durationMs: MOVEMENT.LOOT_UNCOMMON_MS, beamWidthPx: 14, flareScale: 2.4,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: false,
  },
  [Rarity.Rare]: {
    tier: 'bright', durationMs: MOVEMENT.LOOT_RARE_MS, beamWidthPx: 22, flareScale: 2.8,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: false,
  },
  [Rarity.Epic]: {
    tier: 'grand', durationMs: MOVEMENT.LOOT_EPIC_MS, beamWidthPx: 34, flareScale: 3.2,
    dimWorld: false, godRays: false, shockwave: false, weaponRise: false,
  },
  [Rarity.Legendary]: {
    tier: 'legendary', durationMs: MOVEMENT.LOOT_LEGENDARY_MS, beamWidthPx: 68, flareScale: 3.6,
    dimWorld: true, godRays: true, shockwave: true, weaponRise: true,
  },
};

export function lootCelebrationForRarity(rarity: Rarity): LootCelebration {
  return { ...CELEBRATION_BY_RARITY[rarity], color: RARITY_FRAME_STYLES[rarity].color };
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
  /** Legendary flavor line — the item's legendary-effect text, when it has one. */
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

/** The card's stat line — real numbers from the item's own rolled fields. */
export function lootStatLine(item: GearItem): string {
  if (isWeapon(item)) {
    return `DMG ${fmtInt(item.baseDamage)} · FR ${fmtRate(item.attackSpeed)} · CRIT ${fmtRate(item.critChance)}%`;
  }
  if (isShield(item)) {
    return `HP ${fmtInt(item.hp)} · RECHARGE ${fmtRate(item.rechargeRate)}/s · MIT ${fmtRate(item.mitigation)}%`;
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

/** Flavor text for the gold card: the legendary effect's own description. */
export function lootFlavor(item: GearItem): string | undefined {
  if (item.rarity !== Rarity.Legendary || !isWeapon(item) || !item.legendaryEffectId) return undefined;
  return LEGENDARY_EFFECTS.find((effect) => effect.id === item.legendaryEffectId)?.description;
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
    bespokeSpriteId: bespokeSpriteIdForWeaponName(item.name),
  };
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
