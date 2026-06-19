import { CONSUMABLES } from '@/constants/consumables';
import { computeMedKitBuffer } from '@/lib/combat/damageContract';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import type { StatSource } from '@/lib/stats/statSources';
import { formatMultiplierOrWhole, formatSignedPct, formatWhole } from '@/lib/stats/formatStat';

export type ConsumableStatSourceBuckets = {
  health: StatSource[];
  effectiveHp: StatSource[];
  dps: StatSource[];
  shieldBreak: StatSource[];
  armorBreak: StatSource[];
  rareFind: StatSource[];
  scrap: StatSource[];
  offline: StatSource[];
};

export type BuildConsumableStatSourcesInput = {
  consumableInventory?: Record<string, number>;
  activeBuffs?: ActiveBuff[];
  medKitBuffer?: number;
};

const emptyBuckets = (): ConsumableStatSourceBuckets => ({
  health: [],
  effectiveHp: [],
  dps: [],
  shieldBreak: [],
  armorBreak: [],
  rareFind: [],
  scrap: [],
  offline: [],
});

function labelFor(consumableId: string, count: number): string {
  const name = CONSUMABLES[consumableId]?.name ?? consumableId;
  return count > 0 ? `${name} ×${count}` : name;
}

function consumableSource(
  consumableId: string,
  count: number,
  detail: string,
  value: number,
  display: string,
  segmentLabel?: string,
): StatSource {
  const source = labelFor(consumableId, count);
  return {
    source,
    segmentLabel: segmentLabel ?? source,
    detail,
    value,
    display,
    tone: 'amber',
    bucket: 'consumable',
  };
}

function activeBuffTotal(activeBuffs: ActiveBuff[], consumableId: string): number {
  return activeBuffs
    .filter((buff) => buff.consumableId === consumableId)
    .filter((buff) => buff.displayState === 'active' || buff.displayState === 'armed' || buff.displayState === 'recent')
    .reduce((sum, buff) => sum + (buff.value ?? 0), 0);
}

export function buildConsumableStatSources(input: BuildConsumableStatSourcesInput): ConsumableStatSourceBuckets {
  const buckets = emptyBuckets();
  const inventory = input.consumableInventory ?? {};
  const activeBuffs = input.activeBuffs ?? [];

  const medKitCount = inventory.MedKit ?? 0;
  const activeMedKitValue = activeBuffTotal(activeBuffs, 'MedKit');
  const inventoryMedKitPotential = medKitCount > 0 ? medKitCount * computeMedKitBuffer('MedKit') : 0;
  const medKitValue = input.medKitBuffer && input.medKitBuffer > 0
    ? input.medKitBuffer
    : activeMedKitValue > 0
      ? activeMedKitValue
      : inventoryMedKitPotential;

  if (medKitValue > 0) {
    buckets.health.push(consumableSource(
      'MedKit',
      medKitCount,
      input.medKitBuffer && input.medKitBuffer > 0
        ? 'Server-authoritative survival buffer'
        : activeMedKitValue > 0
          ? 'Active survival buffer'
          : 'Inventory-backed survival buffer',
      medKitValue,
      formatWhole(medKitValue),
    ));
  }

  for (const [consumableId, count] of Object.entries(inventory)) {
    if (count <= 0 || consumableId === 'MedKit') continue;
    const def = CONSUMABLES[consumableId];
    if (!def) continue;
    const effects = def.runtime.baseEffects;
    const detail = count > 1 ? `${count} available · consumable inventory` : 'consumable inventory';

    if (effects.dpsMultiplier && effects.dpsMultiplier !== 1) {
      const value = effects.dpsMultiplier - 1;
      buckets.dps.push(consumableSource(consumableId, count, detail, value, formatSignedPct(value)));
    }
    if (effects.shieldBreakMultiplier && effects.shieldBreakMultiplier !== 1) {
      const value = effects.shieldBreakMultiplier - 1;
      buckets.shieldBreak.push(consumableSource(consumableId, count, detail, value, formatSignedPct(value)));
    }
    if (effects.armorBreakMultiplier && effects.armorBreakMultiplier !== 1) {
      const value = effects.armorBreakMultiplier - 1;
      buckets.armorBreak.push(consumableSource(consumableId, count, detail, value, formatSignedPct(value)));
    }
    if (effects.bonusLootChance) {
      buckets.rareFind.push(consumableSource(consumableId, count, 'Bonus loot chance · consumable inventory', effects.bonusLootChance, formatSignedPct(effects.bonusLootChance)));
    }
    if (effects.extraLootRollChance) {
      buckets.rareFind.push(consumableSource(consumableId, count, 'Extra loot roll chance · consumable inventory', effects.extraLootRollChance, formatSignedPct(effects.extraLootRollChance)));
    }
    if (effects.rareMaterialChance) {
      buckets.rareFind.push(consumableSource(consumableId, count, 'Rare material chance · consumable inventory', effects.rareMaterialChance, formatSignedPct(effects.rareMaterialChance)));
    }
    if (effects.yieldMultiplier && effects.yieldMultiplier !== 1) {
      const value = effects.yieldMultiplier - 1;
      buckets.scrap.push(consumableSource(consumableId, count, detail, value, formatSignedPct(value)));
    }
    if (effects.enemyPressureMultiplier && effects.enemyPressureMultiplier !== 1) {
      const value = 1 - effects.enemyPressureMultiplier;
      buckets.effectiveHp.push(consumableSource(consumableId, count, 'Reduced enemy pressure · consumable inventory', value, formatSignedPct(value)));
    }
    if (effects.incomingDpsMultiplier && effects.incomingDpsMultiplier !== 1) {
      const value = 1 - effects.incomingDpsMultiplier;
      buckets.effectiveHp.push(consumableSource(consumableId, count, 'Reduced incoming DPS · consumable inventory', value, formatSignedPct(value)));
    }
  }

  for (const buff of activeBuffs.filter((entry) => entry.displayState === 'active' || entry.displayState === 'armed' || entry.displayState === 'recent')) {
    if (buff.consumableId === 'MedKit') continue;
    const def = CONSUMABLES[buff.consumableId];
    if (!def || buff.value === undefined || buff.value === 0) continue;
    const source = consumableSource(
      buff.consumableId,
      inventory[buff.consumableId] ?? 0,
      buff.displayState === 'armed' ? 'Armed consumable' : `${buff.displayState} consumable · ${buff.source}`,
      buff.value,
      formatMultiplierOrWhole(buff.value),
    );
    if (def.family === 'survival') buckets.effectiveHp.push(source);
    if (def.family === 'ammo' || def.family === 'corrupted' || def.family === 'tactical') buckets.dps.push(source);
    if (def.family === 'economy') buckets.rareFind.push(source);
  }

  return buckets;
}
