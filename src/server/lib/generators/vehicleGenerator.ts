/**
 * Vehicle generator — shared by the Chef (roaming drops) exactly the
 * way the other generators are: one source of truth, deterministic
 * under the caller's RNG stream.
 *
 * A vehicle = class × rarity × rolled affixes (src/lib/vehicles/
 * vehicles.ts owns the class table and affix pool). Area flavor:
 * classes whose unlock level sits near/above the area's unlock level
 * weigh heavier, and the Relay Skimmer only drops in high areas —
 * it is weighted to the top of the ladder by construction.
 */
import { DropSource, Rarity } from '../../../types/game';
import type { Affix, Vehicle } from '../../../types/items';
import { RARITIES } from '../../../constants/rarities';
import { pickWeighted, seededInt, seededRandom } from '../../../lib/utils/rng';
import { generateItemId } from '../../../lib/utils/id';
import { VEHICLE_AFFIX_POOL, VEHICLE_CLASSES, getVehicleClass, type VehicleClassDef } from '../../../lib/vehicles/vehicles';

export interface GenerateVehicleOptions {
  /** Player level the drop is generated for (instance item_level). */
  level: number;
  /** The roaming area's unlock level — the area-flavor input. */
  areaUnlockLevel?: number;
  /** Rarity weights override (e.g. an area's drop-pool weights). */
  rarityWeights?: Record<Rarity, number>;
  forcedClassId?: string;
  forcedRarity?: Rarity;
  source?: DropSource;
}

/** Class weights for an area: near/above-band classes weigh more; the Skimmer is high-area only. */
export function vehicleClassWeights(areaUnlockLevel: number): Array<{ def: VehicleClassDef; weight: number }> {
  return VEHICLE_CLASSES.map((def) => {
    let weight = 1;
    if (def.unlockLevel <= areaUnlockLevel + 10) weight += 2;
    if (def.unlockLevel <= areaUnlockLevel) weight += 1;
    // The Relay Skimmer is weighted to high areas: it cannot drop in
    // low areas at all, and dominates nothing — it stays rare.
    if (def.id === 'relay_skimmer' && areaUnlockLevel < 20) weight = 0;
    return { def, weight };
  }).filter((entry) => entry.weight > 0);
}

/**
 * The starter Scrap Bike granted by cc_initial_bundle (migration
 * 0021): a fixed Common, no affixes — the same payload the SQL grant
 * builds, so the in-memory mirror and Postgres agree byte for byte
 * on everything except the generated id.
 */
export function buildStarterVehicle(id: string): Vehicle {
  return {
    id,
    name: 'Scrap Bike',
    vehicleClassId: 'scrap_bike',
    level: 1,
    rarity: Rarity.Common,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
  };
}

export function generateVehicle(options: GenerateVehicleOptions, externalRng?: () => number): Vehicle {
  const rng = externalRng ?? Math.random;
  const level = Math.max(1, Math.trunc(options.level) || 1);
  const areaUnlockLevel = options.areaUnlockLevel ?? 1;

  const weighted = vehicleClassWeights(areaUnlockLevel);
  const def =
    (options.forcedClassId ? getVehicleClass(options.forcedClassId) : null) ??
    pickWeighted(
      weighted.map((entry) => entry.def),
      weighted.map((entry) => entry.weight),
      rng,
    );

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => options.rarityWeights?.[r] ?? RARITIES[r].dropWeight);
  const rarity = options.forcedRarity ?? pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  // Affixes roll like gear: count from the rarity def, drawn without
  // replacement from the vehicle pool, values in the pool's range.
  const affixCount = Math.min(
    VEHICLE_AFFIX_POOL.length,
    seededInt(rarityDef.affixCount.min, rarityDef.affixCount.max, rng),
  );
  const pool = [...VEHICLE_AFFIX_POOL];
  const affixes: Affix[] = [];
  for (let i = 0; i < affixCount; i++) {
    const idx = seededInt(0, pool.length - 1, rng);
    const affixDef = pool.splice(idx, 1)[0];
    const rollPct = Math.round(seededRandom(affixDef.min * 100, affixDef.max * 100, rng));
    affixes.push({
      id: `${affixDef.stat}_${i}`,
      category: 'activity',
      stat: affixDef.stat,
      value: rollPct / 100,
      displayText: affixDef.text.replace('{v}', String(rollPct)),
    });
  }

  return {
    id: generateItemId(),
    name: `${def.displayName}`,
    vehicleClassId: def.id,
    level,
    rarity,
    affixes,
    sourceTag: options.source ?? DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: Math.floor(rng() * 1_000_000_000),
  };
}
