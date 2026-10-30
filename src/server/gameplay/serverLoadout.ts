/**
 * serverLoadout — build engine inputs from the server's OWN records.
 *
 * Trust hardening (Phase 0 Slice 6): the roaming claim and verify-boss
 * routes used to pass the request body's `equippedGear` /
 * per-slot gear objects and `skillBonuses` straight into the engines.
 * The engines re-derived modifiers from whatever gear they were
 * handed (internal consistency) but never checked the player OWNED
 * that gear or had earned those skill bonuses — a forged body with
 * god-tier gear fabricated claim payouts and boss victories.
 *
 * The routes now derive both inputs here, from the gameplay store's
 * records (item_instances rows with runtime_state 'equipped' +
 * profiles.skill_spends), exactly the derivation offline settlement
 * has used since Slice 3. Body copies are ignored for all economy
 * math. This module is the one owner of that derivation: slot
 * identification mirrors the engines' structural predicates so the
 * derived loadout is the loadout the engines think it is.
 */
import { computeSkillBonuses, type ClassModBoosts } from '../../lib/skills/skillBonuses';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '../../types/items';
import type { EquippedItemEntry } from './store';

/** Class mod boosts (treeBonus + nodeBoosts) from a flat gear array. */
export function classModBoostsFromGear(equippedGear: GearItem[]): ClassModBoosts {
  const equippedClassMod = equippedGear.find(
    (g): g is ClassMod => 'treeBonus' in g,
  );
  return equippedClassMod
    ? { treeBonus: equippedClassMod.treeBonus, nodeBoosts: { ...equippedClassMod.nodeBoosts } }
    : { nodeBoosts: {} };
}

/**
 * The skillBonuses record the engines consume, rebuilt from the
 * server's records: profiles.skill_spends + the equipped class mod's
 * boosts, through the one shared computeSkillBonuses the client
 * store's getBonuses() also delegates to — so a derived record equals
 * what an honest client would have reported.
 */
export function skillBonusesFromRecords(
  equippedGear: GearItem[],
  skillSpends: Record<string, number>,
): Record<string, number> {
  return computeSkillBonuses(skillSpends, classModBoostsFromGear(equippedGear));
}

/** Per-slot gear fields the boss sim consumes (BossSimulationInput minus boss/intent fields). */
export interface BossLoadoutSlots {
  primary: Weapon | null;
  secondary: Weapon | null;
  heavy: Weapon | null;
  ordnance: Ordnance | null;
  shield: Shield | null;
  classMod: ClassMod | null;
  relic: Relic | null;
}

/**
 * A stored weapon payload the engines can actually price. Mirrors
 * the client adapter's rule (serverItemAdapter): a weapon payload
 * missing its required numeric fields is corrupt/incomplete — the
 * bootstrap Starter Pistol row (migration 0004) is exactly this
 * shape — and is rejected rather than patched with defaults. The
 * adapter hides such rows from the client loadout, so an honest
 * client's boss attempt runs that slot EMPTY; the derivation must
 * agree, or the sim would price NaN DPS for the slot instead.
 */
const REQUIRED_WEAPON_FIELDS = [
  'baseDamage',
  'attackSpeed',
  'critChance',
  'critDamage',
  'combatPower',
  'bossPower',
  'farmPower',
] as const;

export function isUsableWeaponPayload(item: GearItem): boolean {
  if (!('weaponType' in item)) return false;
  const record = item as unknown as Record<string, unknown>;
  return REQUIRED_WEAPON_FIELDS.every((field) => typeof record[field] === 'number');
}

/**
 * Map slot-tagged equipped entries onto the boss sim's per-slot
 * fields. Slot identity comes from the item_instances rows
 * (equipped_slot), NOT from array position: a weapon equipped only in
 * the secondary slot stays the secondary. If duplicate rows ever
 * claim one slot, the first (slot-order) row wins — matching the
 * single-equip invariant the loadout store maintains.
 */
export function bossSlotsFromEquipped(entries: EquippedItemEntry[]): BossLoadoutSlots {
  const bySlot = new Map<string, GearItem>();
  for (const entry of entries) {
    if (!bySlot.has(entry.slot)) bySlot.set(entry.slot, entry.item);
  }
  const weapon = (slot: string): Weapon | null => {
    const item = bySlot.get(slot);
    return item && isUsableWeaponPayload(item) ? (item as Weapon) : null;
  };
  const shield = bySlot.get('shield');
  const classMod = bySlot.get('classMod');
  const relic = bySlot.get('relic');
  const ordnance = bySlot.get('ordnance');
  return {
    primary: weapon('primary'),
    secondary: weapon('secondary'),
    heavy: weapon('heavy'),
    ordnance: ordnance && 'damage' in ordnance && !('weaponType' in ordnance) ? (ordnance as Ordnance) : null,
    shield: shield && 'mitigation' in shield ? (shield as Shield) : null,
    classMod: classMod && 'treeBonus' in classMod ? (classMod as ClassMod) : null,
    relic:
      relic && 'affixes' in relic && !('weaponType' in relic) && !('damage' in relic) && !('hp' in relic) && !('treeBonus' in relic)
        ? (relic as Relic)
        : null,
  };
}
