import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Weapon } from '@/types/items';

export type ServerItemRow = {
  id: string;
  item_level?: number | string | null;
  rarity?: string | null;
  is_locked?: boolean | null;
  runtime_state?: string | null;
  equipped_slot?: string | null;
  payload?: Record<string, unknown> | null;
};

const rarityValues = new Set<string>(Object.values(Rarity));

function toNumber(value: number | string | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRarity(value: string | null | undefined): Rarity {
  return value && rarityValues.has(value) ? (value as Rarity) : Rarity.Rare;
}

function scoreFor(rarity: Rarity, level: number): number {
  const rarityMultiplier = {
    [Rarity.Common]: 1,
    [Rarity.Uncommon]: 1.2,
    [Rarity.Rare]: 1.6,
    [Rarity.Epic]: 2.2,
    [Rarity.Legendary]: 3,
  }[rarity];
  return Math.round(level * 10 * rarityMultiplier);
}

export function serverItemRowToDisplayGear(row: ServerItemRow): GearItem {
  // Payload-based reconstruction: when the server stores the full item JSON
  // in the payload column, return it directly. Validate that the payload
  // has at least one gear-type discriminator field (weaponType, hp, damage,
  // treeBonus, or affixes) so we don't spread a stray object as a GearItem.
  if (
    row.payload &&
    typeof row.payload === 'object' &&
    'id' in row.payload &&
    'rarity' in row.payload &&
    'level' in row.payload &&
    ('weaponType' in row.payload ||
     'hp' in row.payload ||
     'damage' in row.payload ||
     'treeBonus' in row.payload ||
     'affixes' in row.payload)
  ) {
    const raw = row.payload as Record<string, unknown>;
    const gear = {
      ...(raw as unknown as GearItem),
      id: row.id || String(raw.id),
      isLocked: Boolean(row.is_locked),
    };

    // Defensive: payload-reconstructed weapons must carry all required
    // numeric fields. Missing values (from old Chef runs, partial
    // migrations, or DB corruption) will crash rendering code that calls
    // .toFixed() on them. Patch missing fields with safe defaults and
    // log a warning so we can trace the source.
    if ('weaponType' in gear) {
      const defaults: Partial<Record<keyof Weapon, number>> = {
        attackSpeed: 1.0,
        baseDamage: 10,
        critChance: 0.05,
        critDamage: 1.5,
        statusChance: 0,
        statusDamage: 0,
        bossDamageMod: 1,
        waveDamageMod: 1,
        shieldDamageMod: 1,
        armorDamageMod: 1,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        combatPower: 10,
        bossPower: 10,
        farmPower: 10,
        economyScore: 0,
      };
      let patched = false;
      for (const [key, fallback] of Object.entries(defaults)) {
        if (typeof gear[key as keyof typeof gear] !== 'number') {
          (gear as Record<string, unknown>)[key] = fallback;
          patched = true;
        }
      }
      if (!Array.isArray(gear.parts)) (gear as Record<string, unknown>).parts = [];
      if (!Array.isArray(gear.affixes)) (gear as Record<string, unknown>).affixes = [];
      if (typeof gear.pixelSeed !== 'number') {
        (gear as Record<string, unknown>).pixelSeed = Math.abs(String(gear.id ?? '').split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0));
        patched = true;
      }
      if (patched) {
        console.warn('[serverItemAdapter] Patched incomplete weapon payload for', gear.id, '— check Chef generator version or DB migration state.');
      }
    }

    return gear;
  }

  const rarity = toRarity(row.rarity);
  const level = toNumber(row.item_level, 1);
  const base = scoreFor(rarity, level);

  const weapon: Weapon = {
    id: row.id,
    name: `${rarity} Server-Rolled Cache Weapon`,
    level,
    rarity,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.HelixWorks,
    element: Element.Kinetic,
    rollQuality: 75,
    baseDamage: base,
    attackSpeed: 1.2,
    critChance: 0.08,
    critDamage: 1.5,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 1,
    waveDamageMod: 1,
    shieldDamageMod: 1,
    armorDamageMod: 1,
    offlineEarningsMod: 1,
    rareDropChanceMod: 0,
    scrapYieldMod: 1,
    parts: [],
    affixes: [],
    sourceTag: DropSource.CacheForged,
    isLocked: Boolean(row.is_locked),
    pixelSeed: Math.abs(row.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)),
    combatPower: base,
    bossPower: base,
    farmPower: base,
    economyScore: base,
  };

  return weapon;
}
