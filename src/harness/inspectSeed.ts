/**
 * Inspect-sheet harness seed (dash/inspect-render, dev only) —
 * one deterministic item set shared by the harness page (store
 * seeds) and inspectMain's fetch backstop (the Market browse
 * page), so the sheet, the intel tape, and the dimmed Market
 * behind it can never disagree.
 *
 * The hero item is a REAL legendary in the generator's shape
 * (the gearTradeTape test factory's field set): an Ironwood
 * Sniper carrying Ricochet Gospel — the effect is pinned to
 * Sniper by its def, and its bespoke sprite resolves from the
 * effect, exactly as a minted drop's would. The equipped Rare
 * SMG is The Trade's baseline. Four comparable listings (same
 * type / maker / element / rarity, nearby level) plus the
 * target listing at 48,500 cr make the intel tape read:
 * supply 5 · lowest 48,500 · median 58,900.
 */
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Shield, Weapon } from '@/types/items';
import type { Listing } from '@/types/market';

const weaponBase = {
  statusDamage: 0.5,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [] as Weapon['parts'],
  affixes: [] as Weapon['affixes'],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1,
  economyScore: 0,
};

export const LEGENDARY: Weapon = {
  ...weaponBase,
  id: 'harness-legendary-1',
  name: 'Ricochet Gospel Prime',
  level: 24,
  rarity: Rarity.Legendary,
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Shock,
  rollQuality: 87,
  baseDamage: 412,
  attackSpeed: 0.85,
  critChance: 0.32,
  critDamage: 2.6,
  statusChance: 0.18,
  statusDamage: 0.6,
  bossDamageMod: 0.22,
  waveDamageMod: 0.05,
  shieldDamageMod: 0.35,
  armorDamageMod: 0.15,
  offlineEarningsMod: 0.1,
  rareDropChanceMod: 0.06,
  scrapYieldMod: 0.04,
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.12, critChance: 0.04 } },
    { slot: 'Grip', modifier: { attackSpeed: 1.05, critDamage: 0.15 } },
    { slot: 'Sight', modifier: { critChance: 0.05, bossDamageMod: 0.08 } },
  ],
  affixes: [
    { id: 'aff-crit', category: 'combat', stat: 'critChance', value: 0.05, displayText: '+5% Crit Chance' },
    { id: 'aff-boss', category: 'boss', stat: 'bossDamageMod', value: 0.12, displayText: '+12% Boss Damage' },
  ],
  legendaryEffectId: 'ricochet_gospel',
  sourceTag: DropSource.BossDrop,
  pixelSeed: 4217,
  combatPower: 1480,
  bossPower: 1620,
  farmPower: 940,
};

/** The currently equipped primary — The Trade's baseline. */
export const EQUIPPED: Weapon = {
  ...weaponBase,
  id: 'harness-equipped-1',
  name: 'Worn Confessor',
  level: 22,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.HelixWorks,
  element: Element.Kinetic,
  rollQuality: 54,
  baseDamage: 150,
  attackSpeed: 0.7,
  critChance: 0.2,
  critDamage: 1.9,
  statusChance: 0.1,
  statusDamage: 0.4,
  shieldDamageMod: 0.2,
  armorDamageMod: 0.1,
  pixelSeed: 77,
  combatPower: 860,
  bossPower: 800,
  farmPower: 700,
};

const fillerShotgun: Weapon = {
  ...weaponBase,
  id: 'harness-filler-1',
  name: 'Dustwaste Argument',
  level: 21,
  rarity: Rarity.Epic,
  weaponType: WeaponType.Shotgun,
  manufacturer: Manufacturer.BlastForge,
  element: Element.Fire,
  rollQuality: 63,
  baseDamage: 288,
  attackSpeed: 1.1,
  critChance: 0.08,
  critDamage: 1.8,
  statusChance: 0.22,
  pixelSeed: 913,
  combatPower: 990,
  bossPower: 870,
  farmPower: 760,
};

const fillerPistol: Weapon = {
  ...weaponBase,
  id: 'harness-filler-2',
  name: 'Ledger Balancer',
  level: 19,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 48,
  baseDamage: 74,
  attackSpeed: 2.9,
  critChance: 0.18,
  critDamage: 1.9,
  statusChance: 0.08,
  pixelSeed: 355,
  combatPower: 640,
  bossPower: 590,
  farmPower: 520,
};

const fillerShield: Shield = {
  id: 'harness-filler-3',
  name: 'Bulwark Plate',
  level: 20,
  rarity: Rarity.Epic,
  hp: 1450,
  rechargeRate: 42,
  mitigation: 0.14,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 204,
};

export const FILLER: GearItem[] = [fillerShotgun, fillerPistol, fillerShield];

/** Comparable legendary snipers (intel supply), other sellers. */
export const COMPARABLES: Weapon[] = [
  { ...LEGENDARY, id: 'harness-comp-1', name: 'Ricochet Gospel', level: 22, rollQuality: 71, pixelSeed: 881 },
  { ...LEGENDARY, id: 'harness-comp-2', name: 'Ricochet Gospel', level: 26, rollQuality: 79, pixelSeed: 882 },
  { ...LEGENDARY, id: 'harness-comp-3', name: 'Ricochet Gospel', level: 21, rollQuality: 66, pixelSeed: 883 },
  { ...LEGENDARY, id: 'harness-comp-4', name: 'Ricochet Gospel', level: 27, rollQuality: 92, pixelSeed: 884 },
];

export const TARGET_PRICE = 48_500;
export const COMPARABLE_PRICES = [52_300, 58_900, 64_750, 79_000];
export const TARGET_SELLER = 'Vessa Marlowe';

const SELLERS = ['Doss Ketter', 'Ines Vahl', 'Marlowe Ade', 'Tobin Reyes'];

interface MarketRow {
  id: string;
  price_credits: number;
  listed_at: string;
  seller_user_id: string;
  seller_name: string;
  seller_type: string;
  listing_kind: string;
  quantity: number;
  quality_percent: null;
  consumable_type: null;
  material_id: null;
  essence_id: null;
  part_id: null;
  tint_palette_id: null;
  identity_key: null;
  category: string;
  display_name: string;
  weapon_type: string | null;
  element: string | null;
  rarity: string | null;
  item_level: number | null;
  item_instances: { id: string; payload: GearItem; is_locked: boolean };
}

const gearRow = (id: string, item: GearItem, price: number, seller: string, hoursAgo: number): MarketRow => ({
  id,
  price_credits: price,
  listed_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  seller_user_id: `seller-${id}`,
  seller_name: seller,
  seller_type: 'player',
  listing_kind: 'gear',
  quantity: 1,
  quality_percent: null,
  consumable_type: null,
  material_id: null,
  essence_id: null,
  part_id: null,
  tint_palette_id: null,
  identity_key: null,
  category: 'weaponType' in item ? 'weapon' : 'shield',
  display_name: item.name,
  weapon_type: 'weaponType' in item ? item.weaponType : null,
  element: 'element' in item ? item.element : null,
  rarity: item.rarity,
  item_level: item.level,
  item_instances: { id: item.id, payload: item, is_locked: false },
});

/** The browse page the backstop serves: the target listing leads. */
export const MARKET_PAGE: { listings: MarketRow[]; total: number } = {
  listings: [
    gearRow('lst-target', LEGENDARY, TARGET_PRICE, TARGET_SELLER, 3),
    ...COMPARABLES.map((item, i) => gearRow(`lst-comp-${i + 1}`, item, COMPARABLE_PRICES[i], SELLERS[i], 9 + i * 7)),
    gearRow('lst-filler-1', fillerShotgun, 21_400, 'Doss Ketter', 5),
    gearRow('lst-filler-2', fillerPistol, 6_850, 'Ines Vahl', 14),
    gearRow('lst-filler-3', fillerShield, 17_250, 'Marlowe Ade', 26),
  ],
  total: 8,
};

/**
 * The same listings in the market store's shape — what the
 * sheet's intel tape reads. In Market context MarketScreen's own
 * sync replaces this with the backstop page's conversion (the
 * same data); in Gear context this seed stands, as it would after
 * the player had browsed the market.
 */
export const STORE_LISTINGS: Listing[] = MARKET_PAGE.listings.map((row) => ({
  id: row.id,
  sellerId: row.seller_user_id,
  sellerName: row.seller_name,
  sellerType: 'player',
  kind: 'gear',
  itemId: row.item_instances.id,
  itemSnapshot: row.item_instances.payload,
  vehicleSnapshot: null,
  category: row.category as Listing['category'],
  displayName: row.display_name,
  quantity: 1,
  qualityPercent: null,
  consumableType: null,
  materialId: null,
  essenceId: null,
  partId: null,
  tintPaletteId: null,
  skinId: null,
  identityKey: null,
  weaponType: row.weapon_type,
  element: row.element,
  rarity: row.rarity,
  itemLevel: row.item_level,
  price: row.price_credits,
  unitPrice: row.price_credits,
  listedAt: Date.parse(row.listed_at),
  feePaid: 0,
}));
