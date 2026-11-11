import { CONSUMABLES, type ConsumableRuntimeEffects } from '@/constants/consumables';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';

const signedPct = (delta: number): string => `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%`;

/**
 * Derive a one-line, glance-ready effect summary string from a consumable's
 * `runtime.baseEffects`. Replaces the static `ledgerText` log line on the
 * dashboard HUD with real numbers (heal HP, +X% DPS, +X% loot, etc.).
 *
 * Returns null only when no effect could be derived AND there's no ledger
 * fallback — in which case callers should render nothing.
 */
export function buildEffectSummary(
  def: typeof CONSUMABLES[string] | undefined,
  buff: ActiveBuff,
  isBufferConsumable: boolean,
): string | null {
  if (!def) return null;
  const e: ConsumableRuntimeEffects = def.runtime.baseEffects ?? {};
  // bossSlowMultiplier is declared on ConsumableEffectRules (the
  // boss-path rules), not on ConsumableRuntimeEffects, and no def
  // currently places it in runtime.baseEffects — so this reads
  // undefined today. Kept as a widened read because baseEffects is an
  // open record the runtime-effects builder copies verbatim: a def
  // that adds the key would surface here with no further wiring.
  const bossSlowMultiplier = (e as { bossSlowMultiplier?: number }).bossSlowMultiplier;
  const parts: string[] = [];

  // ─ Survival / heal / repair ─
  if (isBufferConsumable && typeof buff.value === 'number' && buff.value > 0) {
    parts.push(`+${Math.round(buff.value)} HP buffer`);
  } else if (typeof e.healHp === 'number' && e.healHp > 0) {
    parts.push(`Heal ${Math.round(e.healHp)} HP`);
  } else if (typeof e.healHpPctOfPool === 'number' && e.healHpPctOfPool > 0) {
    parts.push(`Heal ${Math.round(e.healHpPctOfPool * 100)}% of pool`);
  }
  if (typeof e.shieldRestore === 'number' && e.shieldRestore > 0) {
    parts.push(`+${Math.round(e.shieldRestore)} Shield`);
  }
  if (typeof e.shieldRestorePctOfCapacity === 'number' && e.shieldRestorePctOfCapacity > 0) {
    parts.push(`Shield +${Math.round(e.shieldRestorePctOfCapacity * 100)}% of cap`);
  }
  if (typeof e.repairTotalHp === 'number' && e.repairTotalHp > 0) {
    const dur = typeof e.repairDurationSeconds === 'number' && e.repairDurationSeconds > 0
      ? ` / ${Math.round(e.repairDurationSeconds)}s`
      : '';
    parts.push(`Repair ${Math.round(e.repairTotalHp)} HP${dur}`);
  }
  if (typeof e.repairTotalHpPctOfPool === 'number' && e.repairTotalHpPctOfPool > 0) {
    const dur = typeof e.repairDurationSeconds === 'number' && e.repairDurationSeconds > 0
      ? ` / ${Math.round(e.repairDurationSeconds)}s`
      : '';
    parts.push(`Repair ${Math.round(e.repairTotalHpPctOfPool * 100)}% of pool${dur}`);
  }

  // ─ Multiplier effects (delta from 1.0) ─
  if (typeof e.dpsMultiplier === 'number' && e.dpsMultiplier !== 1) {
    parts.push(`${signedPct(e.dpsMultiplier - 1)} DPS`);
  }
  if (typeof e.survivalMultiplier === 'number' && e.survivalMultiplier !== 1) {
    parts.push(`${signedPct(e.survivalMultiplier - 1)} Surv`);
  }
  if (typeof e.armorBreakMultiplier === 'number' && e.armorBreakMultiplier !== 1) {
    parts.push(`${signedPct(e.armorBreakMultiplier - 1)} Armor Brk`);
  }
  if (typeof e.shieldBreakMultiplier === 'number' && e.shieldBreakMultiplier !== 1) {
    parts.push(`${signedPct(e.shieldBreakMultiplier - 1)} Shield Brk`);
  }
  if (typeof e.mechanicMultiplier === 'number' && e.mechanicMultiplier !== 1) {
    parts.push(`${signedPct(e.mechanicMultiplier - 1)} Mech`);
  }
  if (typeof bossSlowMultiplier === 'number' && bossSlowMultiplier !== 1) {
    parts.push(`${signedPct(-(bossSlowMultiplier - 1))} Boss Spd`);
  }
  if (typeof e.incomingDpsMultiplier === 'number' && e.incomingDpsMultiplier !== 1) {
    parts.push(`${signedPct(-(e.incomingDpsMultiplier - 1))} Inc DPS`);
  }
  if (typeof e.incomingAccuracyMultiplier === 'number' && e.incomingAccuracyMultiplier !== 1) {
    parts.push(`${signedPct(-(e.incomingAccuracyMultiplier - 1))} Inc Acc`);
  }
  if (typeof e.reloadPenaltyReduction === 'number' && e.reloadPenaltyReduction > 0) {
    parts.push(`${signedPct(e.reloadPenaltyReduction)} Reload`);
  }
  if (typeof e.critChanceBonus === 'number' && e.critChanceBonus > 0) {
    parts.push(`${signedPct(e.critChanceBonus)} Crit`);
  }
  if (typeof e.armorBypass === 'number' && e.armorBypass > 0) {
    parts.push(`${signedPct(e.armorBypass)} Armor Bypass`);
  }
  if (typeof e.ordnanceBoostMultiplier === 'number' && e.ordnanceBoostMultiplier !== 1) {
    parts.push(`${signedPct(e.ordnanceBoostMultiplier - 1)} Ordnance`);
  }

  // ─ Fraction-of-1 effects (signed +X% / -X%) ─
  if (typeof e.bonusLootChance === 'number' && e.bonusLootChance > 0) {
    parts.push(`${signedPct(e.bonusLootChance)} Loot`);
  }
  if (typeof e.extraLootRollChance === 'number' && e.extraLootRollChance > 0) {
    parts.push(`${signedPct(e.extraLootRollChance)} Double Roll`);
  }
  if (typeof e.rareMaterialChance === 'number' && e.rareMaterialChance > 0) {
    parts.push(`${signedPct(e.rareMaterialChance)} Rare Mat`);
  }
  if (typeof e.rarityBias === 'number' && e.rarityBias > 0) {
    parts.push(`${signedPct(e.rarityBias)} Rarity`);
  }
  if (typeof e.eventChanceBonus === 'number' && e.eventChanceBonus > 0) {
    parts.push(`${signedPct(e.eventChanceBonus)} Event`);
  }
  if (typeof e.deathFeeReduction === 'number' && e.deathFeeReduction > 0) {
    parts.push(`${signedPct(-e.deathFeeReduction)} Death Fee`);
  }
  if (typeof e.dotDamageReduction === 'number' && e.dotDamageReduction > 0) {
    parts.push(`${signedPct(-e.dotDamageReduction)} DoT`);
  }
  if (typeof e.fatigueDamagePct === 'number' && e.fatigueDamagePct > 0) {
    parts.push(`${signedPct(e.fatigueDamagePct)} Fatigue`);
  }
  if (typeof e.shieldRegenInterruptChance === 'number' && e.shieldRegenInterruptChance > 0) {
    parts.push(`${signedPct(e.shieldRegenInterruptChance)} Shield Brk%`);
  }
  if (typeof e.staggerChance === 'number' && e.staggerChance > 0) {
    parts.push(`${signedPct(e.staggerChance)} Stagger`);
  }
  if (typeof e.dodgeChanceBonus === 'number' && e.dodgeChanceBonus > 0) {
    parts.push(`${signedPct(e.dodgeChanceBonus)} Dodge`);
  }

  if (parts.length > 0) return parts.join(' · ');
  // Defensive fallback — the static log line — only if no numeric effects were derived.
  return def.runtime.ledgerText || null;
}
