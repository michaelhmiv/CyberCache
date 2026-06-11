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
  if (row.payload && typeof row.payload === 'object' && 'id' in row.payload && 'rarity' in row.payload && 'level' in row.payload) {
    return {
      ...(row.payload as unknown as GearItem),
      id: row.id || String(row.payload.id),
      isLocked: Boolean(row.is_locked),
    };
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
