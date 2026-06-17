/**
 * ActiveBuff data model + ConsumableActivator registry.
 *
 * This is the data layer for the HUD's active-buff tracker. It is
 * intentionally pure data + helpers (no React, no Zustand) so it
 * can be imported by the chef, the client store, and the UI layers
 * without coupling them.
 *
 * ## Authoritative boundary
 *
 * The chef emits `consumedConsumables: Record<ConsumableType, number>`
 * after a boss attempt (counts only). The client expands one row per
 * "fired" consumable into an `ActiveBuff`, deriving the duration from
 * the static `CONSUMABLES` registry. This file owns:
 *
 *   1. The `ActiveBuff` shape (the row the HUD renders).
 *   2. The `CONSUMABLE_ACTIVATORS` registry — one entry per ConsumableType
 *      describing *how* the duration is derived (`durationSource`).
 *   3. The `resolveConsumableDuration()` helper that reads the
 *      `CONSUMABLES` registry and returns a millisecond value.
 *
 * ## durationSource modes
 *
 *   - `'highQualityPerk'` — read `runtime.options.highQualityPerks[]`,
 *     pick the highest-tier perk where `minQuality <= quality`, return
 *     that perk's `effects.repairDurationSeconds * 1000`. Used by
 *     MedKit/MedKitRefined/ShieldCell and the high-Q perk consumables.
 *   - `'registryRepair'` — read `runtime.baseEffects.repairDurationSeconds`
 *     and multiply by 1000. Used by NanoSwarm and AdrenalineShot, whose
 *     regen window lives in baseEffects.
 *   - `'registryCoverage'` — read `runtime.options.activityRules.roaming.
 *     durationSeconds` (or `boss` if the consumable is boss-active but
 *     not roaming-active) and multiply by 1000. Used by Ammo Pack,
 *     Signal Scrambler, Loot Beacon, High-Capacity Ammo Pack.
 *   - `'none'` — return 0. The HUD still emits a "consumed" toast but
 *     no countdown pill.
 *
 * ## FULL_DURATION placeholder
 *
 * The chef's `FULL_DURATION = { mode: 'duration' }` is a scaling
 * *descriptor*, not a concrete number. It tells the runtime "scale
 * this field with quality"; the resolved value lives in
 * `runtime.baseEffects.<field>` (with quality applied at runtime).
 * Some of our base-effects entries are themselves quality-driven and
 * the chef doesn't emit a numeric baseline for them. For those, we
 * fall back to a sensible display default (30s) so the HUD can still
 * render a pill. **This is display-only** — the chef's actual
 * game-math is unchanged.
 */
import { ConsumableType } from '@/types/game';
import { CONSUMABLES, type ConsumableFamily } from '@/constants/consumables';

/** Display-only fallback when the chef doesn't emit a numeric duration. */
export const FULL_DURATION_FALLBACK_MS = 30_000;

/** Source of an ActiveBuff — drives tick-feed tone and ring treatment. */
export type BuffSource =
  | 'auto-eat'          // client ticker fired it (Med Kit, Shield Cell, etc.)
  | 'chef-result'       // legacy alias for boss attempt result
  | 'boss-result'       // boss attempt result included this consumable
  | 'activity-result'   // craft/repair/scrap activity used this consumable
  | 'ammo-tick'         // legacy alias for roaming coverage
  | 'loadout-armed'     // loaded long-window consumable is armed, not consumed
  | 'roaming-coverage'  // roaming coverage window display
  | 'phase-trigger'     // boss phase break fired the consumable
  | 'instant-event';    // zero-duration consumed event

export type BuffDisplayState = 'active' | 'armed' | 'recent' | 'expired';

/**
 * A single in-flight consumable effect with a known expiry.
 *
 * Constructed client-side from `consumedConsumables` after a chef result.
 * Lives in `useActiveBuffsStore` until `expiresAt <= Date.now()`.
 */
export interface ActiveBuff {
  /** Unique id — `${consumableId}:${attemptId}:${triggerIndex}`. */
  id: string;
  /** ConsumableType ID (e.g. 'MedKit', 'AmmoPack'). */
  consumableId: ConsumableType;
  /** Family of the consumable (used for ring color/accent). */
  family: ConsumableFamily;
  /** What triggered the buff: 'auto-eat', 'chef-result', 'ammo-tick', etc. */
  source: BuffSource;
  /** Source attempt ID (for chef-result) or slot ID (for client-side ticks). */
  sourceId: string;
  /** Wall-clock time the buff started. */
  startedAt: number;
  /** Wall-clock time the buff expires. */
  expiresAt: number;
  /** Original duration in milliseconds (cached for ring/UI calculations). */
  durationMs: number;
  /** active = fired timer, armed = loaded/ready, recent = instant flash. */
  displayState: BuffDisplayState;
  /** Optional short visual TTL for instant zero-duration effects. */
  visualTtlMs?: number;
  /** Batch quality if known; otherwise display duration is approximate. */
  qualityPercent?: number;
  /** Optional numeric value (heal amount, DPS multiplier, etc. for display). */
  value?: number;
  /** For per-interval consumables: how many ticks fired. */
  ticksFired?: number;
}

/**
 * Declarative map of consumableId → how to derive an ActiveBuff from a
 * triggering event. The chef returns the count; the client uses this
 * to expand each `consumedConsumables[type]` entry into one buff row.
 */
export interface ConsumableActivator {
  /**
   * Where to look up the duration.
   *   - 'highQualityPerk' → walks runtime.options.highQualityPerks[]
   *   - 'registryRepair'  → reads runtime.baseEffects.repairDurationSeconds
   *   - 'registryCoverage'→ reads runtime.options.activityRules.{roaming|boss}.durationSeconds
   *   - 'none'            → returns 0 (no timer pill, just 'consumed' toast)
   */
  durationSource: 'highQualityPerk' | 'registryRepair' | 'registryCoverage' | 'none';
  /** Fallback if durationSource returns 0/undefined (display-only). */
  defaultDurationMs: number;
  /** Display value (heal amount, multiplier, etc.) — chef applies the real one. */
  defaultValue: number;
  /** Source type for the buff (used for tick-feed tone selection). */
  source: BuffSource;
  /** Default UI state when this activator is converted to a display row. */
  defaultDisplayState?: BuffDisplayState;
  /** Optional short visual TTL for durationSource='none'. */
  visualTtlMs?: number;
  /** Human-readable mechanic class for inspect/ledger copy. */
  mechanicKind?:
    | 'survival-repair'
    | 'survival-boost'
    | 'ammo-coverage'
    | 'phase-break'
    | 'boss-prep'
    | 'boss-mechanic'
    | 'economy-outcome'
    | 'activity-start'
    | 'legacy-instant';
}

/**
 * The single source of truth for "what does it mean for X to fire?"
 *
 * Typed as `Record<ConsumableType, ConsumableActivator>` so adding a
 * new ConsumableType without an activator entry is a TypeScript error.
 * Same pattern as `ConsumableRing` accent typing in PR #134.
 */
export const CONSUMABLE_ACTIVATORS: Record<ConsumableType, ConsumableActivator> = {
  // SURVIVAL (5) — auto-eat path
  [ConsumableType.MedKit]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 0,
    defaultValue: 150,
    source: 'auto-eat',
  },
  [ConsumableType.MedKitRefined]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 0,
    defaultValue: 260,
    source: 'auto-eat',
  },
  [ConsumableType.ShieldCell]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 0,
    defaultValue: 120,
    source: 'auto-eat',
  },
  [ConsumableType.NanoSwarm]: {
    durationSource: 'registryRepair',
    defaultDurationMs: FULL_DURATION_FALLBACK_MS,
    defaultValue: 300,
    source: 'auto-eat',
  },
  [ConsumableType.AdrenalineShot]: {
    durationSource: 'registryRepair',
    defaultDurationMs: 20_000,
    defaultValue: 1.1,
    source: 'auto-eat',
  },

  // AMMO (8) — chef-side decision (boss) + per-interval (roaming)
  [ConsumableType.AmmoPack]: {
    durationSource: 'registryCoverage',
    defaultDurationMs: 600_000,
    defaultValue: 1.05,
    source: 'chef-result',
  },
  [ConsumableType.HighCapacityAmmoPack]: {
    durationSource: 'registryCoverage',
    defaultDurationMs: 1_200_000,
    defaultValue: 1.05,
    source: 'chef-result',
  },
  [ConsumableType.ArmorPiercingAmmo]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.25,
    source: 'chef-result',
  },
  [ConsumableType.CorrosiveAmmo]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 10_000,
    defaultValue: 1.3,
    source: 'chef-result',
  },
  [ConsumableType.CryoAmmo]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.11,
    source: 'chef-result',
  },
  [ConsumableType.ElementalCoating]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.08,
    source: 'chef-result',
  },
  [ConsumableType.IncendiaryAmmo]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 6_000,
    defaultValue: 1.08,
    source: 'chef-result',
  },
  [ConsumableType.ShockAmmo]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.3,
    source: 'chef-result',
  },

  // TACTICAL (5) — fightStart or bossMechanic
  [ConsumableType.BossScanner]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1,
    source: 'chef-result',
  },
  [ConsumableType.Jammer]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.2,
    source: 'chef-result',
  },
  [ConsumableType.SignalScrambler]: {
    durationSource: 'registryCoverage',
    defaultDurationMs: 600_000,
    defaultValue: 1.1,
    source: 'chef-result',
  },
  [ConsumableType.TargetPainter]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.15,
    source: 'chef-result',
  },
  [ConsumableType.OverchargeStim]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.12,
    source: 'chef-result',
  },

  // ORDNANCE (6) — phase break
  [ConsumableType.CorrosiveCharge]: {
    durationSource: 'highQualityPerk',
    defaultDurationMs: 8_000,
    defaultValue: 1.35,
    source: 'chef-result',
  },
  [ConsumableType.EMPCharge]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.35,
    source: 'chef-result',
  },
  [ConsumableType.MagnetizedPayload]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 2,
    source: 'chef-result',
  },
  [ConsumableType.OrdnanceCharge]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.15,
    source: 'chef-result',
  },
  [ConsumableType.PhaseShiftGrenade]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.5,
    source: 'chef-result',
  },
  [ConsumableType.VoidAmmo]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.22,
    source: 'chef-result',
  },

  // ECONOMY (7 incl. legacy grenade) — outcome-gated or per-activity
  [ConsumableType.DataSkimmer]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 0.25,
    source: 'chef-result',
  },
  [ConsumableType.InsuranceToken]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 0.5,
    source: 'chef-result',
  },
  [ConsumableType.LootBeacon]: {
    durationSource: 'registryCoverage',
    defaultDurationMs: 600_000,
    defaultValue: 0.1,
    source: 'chef-result',
  },
  [ConsumableType.LuckBooster]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 0.25,
    source: 'chef-result',
  },
  [ConsumableType.SalvageContract]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.15,
    source: 'activity-result',
  },
  [ConsumableType.WorkshopRushTicket]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 0.2,
    source: 'activity-result',
  },

  // LEGACY — kept for save compatibility; not vendor-stocked.
  [ConsumableType.Grenade]: {
    durationSource: 'none',
    defaultDurationMs: 0,
    defaultValue: 1.15,
    source: 'chef-result',
  },
};


export const INSTANT_EVENT_VISUAL_TTL_MS = 2_500;

export function getConsumableDisplayState(consumableId: ConsumableType, durationMs: number): BuffDisplayState {
  const activator = CONSUMABLE_ACTIVATORS[consumableId];
  if (activator.defaultDisplayState) return activator.defaultDisplayState;
  return durationMs > 0 ? 'active' : 'recent';
}

export function getConsumableVisualTtl(consumableId: ConsumableType, durationMs: number): number | undefined {
  const activator = CONSUMABLE_ACTIVATORS[consumableId];
  if (durationMs > 0) return undefined;
  return activator.visualTtlMs ?? INSTANT_EVENT_VISUAL_TTL_MS;
}

export function getConsumableMechanicKind(consumableId: ConsumableType): NonNullable<ConsumableActivator['mechanicKind']> {
  const activator = CONSUMABLE_ACTIVATORS[consumableId];
  if (activator.mechanicKind) return activator.mechanicKind;
  const def = CONSUMABLES[consumableId];
  if (consumableId === ConsumableType.Grenade) return 'legacy-instant';
  if (def?.family === 'survival') return activator.durationSource === 'registryRepair' ? 'survival-repair' : 'survival-boost';
  if (activator.durationSource === 'registryCoverage') return 'ammo-coverage';
  if (def?.family === 'ordnance' || def?.trigger === 'shieldPhase' || def?.trigger === 'armorPhase') return 'phase-break';
  if (def?.family === 'economy') return def.runtime.activityScopes.some((scope) => ['crafting', 'scrapping', 'repair'].includes(scope)) ? 'activity-start' : 'economy-outcome';
  if (def?.family === 'tactical') return def.trigger === 'bossMechanic' ? 'boss-mechanic' : 'boss-prep';
  return 'boss-prep';
}

/**
 * Resolve the duration (in milliseconds) for a consumable at a given quality.
 *
 * Dispatches on `CONSUMABLE_ACTIVATORS[consumableId].durationSource`:
 *   - `'highQualityPerk'`: walks `runtime.options.highQualityPerks[]`,
 *      picks the highest-tier perk where `minQuality <= quality`,
 *      returns `effects.repairDurationSeconds * 1000`. Returns 0 if no
 *      perk matches or the matched perk has no `repairDurationSeconds`.
 *   - `'registryRepair'`: returns `runtime.baseEffects.repairDurationSeconds * 1000`.
 *      If that field is `undefined`, returns the activator's `defaultDurationMs`.
 *   - `'registryCoverage'`: returns `runtime.options.activityRules.roaming.
 *      durationSeconds * 1000`, or `boss.durationSeconds * 1000` if the
 *      consumable's `activityScopes` includes `'boss'` but not `'roaming'`.
 *      Returns 0 if no rule matches.
 *   - `'none'`: returns 0.
 *
 * **FULL_DURATION placeholder handling:** the chef emits
 * `{ mode: 'duration' }` for fields whose numeric value is computed at
 * runtime (quality-driven). The resolved numeric value lives in
 * `runtime.baseEffects.<field>` once the quality has been applied.
 * Some registry entries (e.g. NanoSwarm) declare the placeholder
 * alongside a real numeric baseline — those work via `registryRepair`.
 * If neither the baseline nor a perk provides a numeric value, we fall
 * back to the activator's `defaultDurationMs` (30s display default).
 */
export function resolveConsumableDuration(
  consumableId: ConsumableType,
  quality: number,
): number {
  const activator = CONSUMABLE_ACTIVATORS[consumableId];
  const def = CONSUMABLES[consumableId];

  // Defensive: if a ConsumableType is somehow missing from CONSUMABLES
  // (data drift), fall back to the activator's display default.
  if (!def) return activator.defaultDurationMs;

  switch (activator.durationSource) {
    case 'none':
      return 0;

    case 'highQualityPerk': {
      const perks = def.runtime.highQualityPerks ?? [];
      // Walk in array order and keep the *last* matching perk — the
      // registry is sorted ascending by minQuality, so the last match
      // is the highest tier that the player's quality unlocks.
      let matchedSeconds: number | undefined;
      for (const perk of perks) {
        if (quality >= perk.minQuality) {
          const seconds = perk.effects.repairDurationSeconds;
          if (typeof seconds === 'number') {
            matchedSeconds = seconds;
          }
        }
      }
      return typeof matchedSeconds === 'number' ? matchedSeconds * 1000 : 0;
    }

    case 'registryRepair': {
      const seconds = def.runtime.baseEffects.repairDurationSeconds;
      if (typeof seconds === 'number' && seconds > 0) {
        return seconds * 1000;
      }
      // FULL_DURATION placeholder handling: chef emits `{ mode: 'duration' }`
      // for quality-scaled repair windows. The resolved numeric value
      // lives elsewhere; if it's missing here, use the display fallback
      // (30s) so the HUD pill still renders a sensible number.
      return activator.defaultDurationMs;
    }

    case 'registryCoverage': {
      const activityRules = def.runtime.activityRules ?? {};
      // Pick roaming first (most common coverage window). Fall back to
      // boss if the consumable is boss-active but not roaming-active.
      const scopes = def.runtime.activityScopes;
      const prefersBoss = scopes.includes('boss') && !scopes.includes('roaming');
      const rule = prefersBoss ? activityRules.boss : activityRules.roaming;
      const seconds = rule?.durationSeconds;
      if (typeof seconds === 'number' && seconds > 0) {
        return seconds * 1000;
      }
      // FULL_DURATION placeholder fallback for coverage consumables.
      return activator.defaultDurationMs;
    }
  }
}
