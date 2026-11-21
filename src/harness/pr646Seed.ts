/**
 * PR #646 before/after harness seed (dash/pr646-before +
 * dash/pr646-after, dev only) — ONE deterministic state shared by
 * both branches, so any visual difference between the two capture
 * runs is the PR's doing, never the seed's. Item shapes follow the
 * inspect round's factories (real generator field sets); the API
 * bodies for research / cache rank / standing are built by the
 * game's own view-derivation functions from fixed facts, so the
 * panels render exactly what a real Chef response would produce.
 */
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Shield, Weapon } from '@/types/items';
import type { Listing } from '@/types/market';
import { IDLE_ACTIVITY } from '@/types/activity';
import {
  useActivityStore,
  useBossStore,
  useEndlessRunStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { setSession } from '@/lib/api/session';
import { useInitialBundleRevealStore } from '@/store/slices/initialBundleRevealSlice';
import { researchStateView, RESEARCH_LEVER_DEFAULTS } from '@/content/research';
import { cacheRankStateView } from '@/content/cacheRank';
import { buildStandingStateView } from '@/content/manufacturerStanding';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';

// ── Gear (inspect round's deterministic set) ────────────────────
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
export const ALL_ITEMS: GearItem[] = [LEGENDARY, EQUIPPED, ...FILLER];

// ── Market pages (wire shape, as the browse endpoint serves) ────
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

const gearRow = (id: string, item: GearItem, price: number, seller: string, sellerId: string, hoursAgo: number): MarketRow => ({
  id,
  price_credits: price,
  listed_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  seller_user_id: sellerId,
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
  weapon_type: 'weaponType' in item ? (item.weaponType as string) : null,
  element: 'element' in item ? (item.element as string) : null,
  rarity: item.rarity as string,
  item_level: item.level,
  item_instances: { id: item.id, payload: item, is_locked: false },
});

const COMPARABLES: Weapon[] = [
  { ...LEGENDARY, id: 'harness-comp-1', name: 'Ricochet Gospel', level: 22, rollQuality: 71, pixelSeed: 881 },
  { ...LEGENDARY, id: 'harness-comp-2', name: 'Ricochet Gospel', level: 26, rollQuality: 79, pixelSeed: 882 },
  { ...LEGENDARY, id: 'harness-comp-3', name: 'Ricochet Gospel', level: 21, rollQuality: 66, pixelSeed: 883 },
  { ...LEGENDARY, id: 'harness-comp-4', name: 'Ricochet Gospel', level: 27, rollQuality: 92, pixelSeed: 884 },
];

/** Browse page: the 48,500 cr target listing leads (≥5,000 cr, so
 *  the PR's high-value buy confirm applies to it). */
export const MARKET_PAGE = {
  listings: [
    gearRow('lst-target', LEGENDARY, 48_500, 'Vessa Marlowe', 'seller-lst-target', 3),
    ...COMPARABLES.map((item, i) => gearRow(`lst-comp-${i + 1}`, item, [52_300, 58_900, 64_750, 79_000][i], ['Doss Ketter', 'Ines Vahl', 'Marlowe Ade', 'Tobin Reyes'][i], `seller-lst-comp-${i + 1}`, 9 + i * 7)),
    gearRow('lst-filler-1', fillerShotgun, 21_400, 'Doss Ketter', 'seller-lst-filler-1', 5),
    gearRow('lst-filler-2', fillerPistol, 6_850, 'Ines Vahl', 'seller-lst-filler-2', 14),
    gearRow('lst-filler-3', fillerShield, 17_250, 'Marlowe Ade', 'seller-lst-filler-3', 26),
  ],
  total: 8,
};

/** The caller's own listings (sellerId queries): one live listing
 *  whose Cancel button both versions render. */
export const OWN_PAGE = {
  listings: [gearRow('lst-own-1', fillerPistol, 6_850, 'Vesper-9', 'p1', 11)],
  total: 1,
};

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

// ── Activity log page ───────────────────────────────────────────
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const ACTIVITY_PAGE = {
  records: [
    {
      id: 'rec-boss-1', kind: 'boss', at: hoursAgo(2), away: false,
      label: 'Vaultkeeper Omega — victory',
      boss: {
        bossId: 'vaultkeeper_omega', bossName: 'Vaultkeeper Omega', victory: true,
        winChance: 0.42, dedicatedChance: 0.08, dedicatedDropAwarded: false,
        dropLuckBonus: 0, creditsGained: 5200, creditsLost: 0, loot: [],
      },
    },
    {
      id: 'rec-drop-1', kind: 'drop', at: hoursAgo(3), away: false,
      label: 'Dustwaste Argument dropped',
      item: { id: 'harness-filler-1', name: 'Dustwaste Argument', kind: 'weapon', rarity: 'Epic', level: 21 },
      receipt: null, areaId: null, areaName: 'Rust Flats',
    },
    {
      id: 'rec-kills-1', kind: 'kills', at: hoursAgo(5), away: false,
      label: 'Cleared a stretch of the Rust Flats',
      kills: { count: 34 }, areaId: null, areaName: 'Rust Flats',
    },
    {
      id: 'rec-boss-2', kind: 'boss', at: hoursAgo(9), away: false,
      label: 'The Hollow Saint — defeat',
      boss: {
        bossId: 'hollow_saint', bossName: 'The Hollow Saint', victory: false,
        winChance: 0.27, dedicatedChance: 0.05, dedicatedDropAwarded: false,
        dropLuckBonus: 0, creditsGained: 0, creditsLost: 1450, loot: [],
      },
    },
    {
      id: 'rec-market-1', kind: 'market', at: hoursAgo(14), away: false,
      label: 'Sold Ledger Balancer',
      market: {
        direction: 'sold', priceCredits: 6850, feeCredits: 343, proceedsCredits: 6507,
        counterpartyId: 'seller-x', counterpartyName: 'Ines Vahl', listingId: 'lst-old-1',
      },
    },
    {
      id: 'rec-craft-1', kind: 'craft', at: hoursAgo(20), away: false,
      label: 'Bench finished Ammo Pack ×25',
      craft: {
        recipeId: 'recipe_ammo_pack', recipeName: 'Ammo Pack', jobKind: 'consumable',
        bench: 1, unitsCompleted: 25, unitsTotal: 25, xpAwarded: 180,
        outputs: [{ name: 'Ammo Pack', count: 25 }],
      },
    },
  ],
  nextCursor: null,
  limit: 50,
};

// ── Chef-shaped API bodies (game's own derivations) ─────────────
export function buildApiBodies() {
  const now = Date.now();
  const research = researchStateView(
    {
      workshopBenches: 1,
      credits: 128_400,
      completed: [],
      activeEnrollment: {
        courseId: 'production_systems',
        enrolledAt: new Date(now - 2 * 3_600_000).toISOString(),
        completesAt: new Date(now + 4 * 3_600_000).toISOString(),
        costCredits: 15_000,
        durationMs: 6 * 3_600_000,
      },
      nowMs: now,
    },
    RESEARCH_LEVER_DEFAULTS,
  );
  const cacheRank = cacheRankStateView({
    level: 24,
    playerXp: 41_200,
    tokens: 3,
    grantLevel: 23,
    spends: { maxHp: 1, credits: 1 },
  });
  const standing = buildStandingStateView({
    accountType: 'verified',
    canUsePlayerEconomy: true,
    credits: 128_400,
    playerLevel: 24,
    rows: [
      { manufacturer: Manufacturer.Ironwood, standing: 640, rank: 2 },
      { manufacturer: Manufacturer.Redline, standing: 130, rank: 1 },
      { manufacturer: Manufacturer.BlastForge, standing: 0, rank: 0 },
    ] as never,
    weeklyPurchases: [],
  });
  const dispatch = {
    slots: 2,
    slotsUsed: 1,
    playerLevel: 24,
    vehicleFuel: 10,
    credits: 128_400,
    boardIndex: 0,
    boardDay: '2026-11-21',
    rerollsUsed: 0,
    rerollsRemaining: 2,
    rerollPrice: 500,
    departedOfferIds: [],
    offers: [],
    missions: [
      {
        id: 'msn-harness-1',
        contract_family: 'foot',
        offer_id: 'off-harness-1',
        destination_area_id: 'rust_flats',
        duration_hours: 6,
        status: 'active',
        loadout_item_ids: [EQUIPPED.id],
        payout_credits: 4200,
        payout_scrap: 300,
        payout_material_id: null,
        payout_material_units: 0,
        vehicle_item_id: null,
        vehicle_class_id: null,
        fuel_charged_units: 0,
        fuel_refunded_units: 0,
        wear_projected: null,
        wear_applied: null,
        breakdown_fraction: null,
        payout_fraction: null,
        departed_at: new Date(now - 3_600_000).toISOString(),
        ends_at: new Date(now + 5 * 3_600_000).toISOString(),
        settled_at: null,
      },
    ],
    candidates: [],
  };
  return { research, cacheRank, standing, dispatch };
}

// ── Store seeds ─────────────────────────────────────────────────
function seedSession() {
  void setSession({
    accessToken: 'harness-access-token',
    refreshToken: 'harness-refresh-token',
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    account: { id: 'p1', email: 'vesper@example.com', isGuest: false, emailVerified: true },
  } as never);
}

function seedCommon() {
  seedSession();
  usePlayerStore.setState({
    id: 'p1',
    name: 'Vesper-9',
    level: 24,
    xp: 41_200,
    credits: 128_400,
    scrap: 56_200,
    cacheKeys: 5,
    legendaryCores: 2,
    materials: { Scrap: 42, Gunmetal: 12 },
    essences: {},
    consumables: { AmmoPack: 82, MedKit: 6 },
    profileLoaded: true,
  } as never);
  useInventoryStore.setState({ items: ALL_ITEMS } as never);
  useLoadoutStore.setState({
    slots: {
      primary: EQUIPPED.id, secondary: null, heavy: null, ordnance: null,
      shield: fillerShield.id, classMod: null, relic: null, vehicle: null,
    },
    consumables: { PreFight: 'AmmoPack', MidFight: null, Emergency: null },
  } as never);
  useSurvivalStore.setState({
    currentHp: 940, maxHp: 2100, shieldHp: 300, isDead: false,
  } as never);
  useSkillStore.setState({ spent: {}, activeHunterId: 'vesper' } as never);
  useBossStore.setState({ currentBossId: null } as never);
}

const harnessJob = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'harness-job-1',
  bench: 1,
  kind: 'consumable',
  recipeId: 'recipe_ammo_pack',
  name: 'Ammo Pack',
  state: 'running',
  unitsTotal: 407,
  unitsCompleted: 0,
  unitDurationMs: 600_000,
  accruedMs: 240_000,
  remainingMs: 243_960_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
  ...over,
});

function seedWorkshopJobs() {
  const view: WorkshopServerView = {
    benches: 1,
    tools: { owned: {}, fitted: {}, charges: {} },
    jobs: [
      harnessJob({ id: 'harness-job-1', state: 'running' }),
      harnessJob({
        id: 'harness-job-2', recipeId: 'recipe_medkit', name: 'Med Kit', state: 'queued',
        unitsTotal: 25, unitsCompleted: 0, unitDurationMs: 720_000, accruedMs: 0, remainingMs: 18_000_000,
      }),
      harnessJob({
        id: 'harness-job-3', recipeId: 'recipe_shieldcell', name: 'Shield Cell', state: 'queued',
        unitsTotal: 40, unitsCompleted: 0, unitDurationMs: 900_000, accruedMs: 0, remainingMs: 36_000_000,
      }),
    ],
    masteries: {},
    activeActionKind: 'crafting',
    recentCompletions: [],
  } as WorkshopServerView;
  useWorkshopStore.setState({
    server: view,
    error: null,
    loading: false,
    refresh: async () => undefined,
    enqueue: async () => true,
    cancel: async () => true,
  } as never);
}

function seedRoaming() {
  const areaId = useIdleStore.getState().selectedRoamingAreaId;
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area', targetId: areaId },
    hydrated: true,
    pending: false,
    error: null,
  } as never);
}

export function seedFor(screen: string) {
  switch (screen) {
    case 'auth':
      break;
    case 'app': {
      seedSession();
      usePlayerStore.setState({
        id: 'p1', name: '', level: 1, xp: 0, credits: 500, scrap: 250,
        cacheKeys: 2, materials: {}, essences: {}, consumables: {},
        profileLoaded: true,
      } as never);
      useInitialBundleRevealStore.getState().show({
        credits: 500, scrap: 250, cacheKeys: 2, vehicleName: 'Rustbucket Trike',
      });
      break;
    }
    case 'home-roam':
      seedCommon();
      seedRoaming();
      break;
    case 'home-bench':
      seedCommon();
      seedRoaming();
      seedWorkshopJobs();
      break;
    case 'home-endless': {
      seedCommon();
      useActivityStore.setState({
        current: { ...IDLE_ACTIVITY, kind: 'endless_run', targetId: 'run-harness' },
        hydrated: true, pending: false, error: null,
      } as never);
      useEndlessRunStore.setState({
        view: {
          runId: 'run-harness', depthReached: 6, startLevel: 24,
          escrowCredits: 18_400, escrowXp: 9_200, escrowScrap: 3_100,
          deathPayoutPercent: 40, bestDepth: 9, busy: false,
        },
      } as never);
      break;
    }
    case 'market':
      seedCommon();
      useMarketStore.setState({ listings: STORE_LISTINGS, history: [] } as never);
      break;
    default:
      seedCommon();
      break;
  }
}
