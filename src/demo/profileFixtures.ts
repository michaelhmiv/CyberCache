/**
 * Fixtures + store seeding for the Profile variant C prototype
 * ("The Retrospective" — the career as a gallery exhibition).
 *
 * PROTOTYPE ONLY — never merged. The facts are IDENTICAL to the
 * Profile variant A pass (branch design/hunter-subpages-profile):
 * same hunter, same numbers, shaped exactly like the real payloads
 * (PlayerPublicStats for /stats/me, ProfileLifetimePayload for
 * /profile/stats) so the five options compare on identical facts.
 *
 * The stores are seeded with the same fixture so the page's real
 * store-driven pieces — the hunter portrait (cosmetics store) and
 * the shipped Totals & Sources sheet (useCharacterStatSummary) —
 * render their genuine output for this hunter.
 */
import type { PlayerPublicStats } from '@/lib/api/statsService';
import type { ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import { xpToNextLevel } from '@/content/simulation';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';
import { DropSource, Rarity } from '@/types/game';
import type { Weapon } from '@/types/items';
import { SKIN_PARTS, skinSetById, type CosmeticsStateView } from '@/content/skins';
import { SKILL_NODES } from '@/constants/skillTrees';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

export const FIXTURE_USER_ID = 'fixture-rook';
export const FIXTURE_LEVEL = 24;
/** 62% into the level — the same anchor point variant A used. */
export const FIXTURE_XP = Math.floor(xpToNextLevel(FIXTURE_LEVEL) * 0.62);
export const FIXTURE_JOINED_AT = '2026-06-14T15:04:00.000Z';
export const FIXTURE_EMAIL = 'rook@example.com';
export const FIXTURE_UNSPENT_POINTS = 5;

export const STATS_FIXTURE: PlayerPublicStats = {
  user_id: FIXTURE_USER_ID,
  username: 'rook_sandoval',
  display_name: 'Rook Sandoval',
  player_level: FIXTURE_LEVEL,
  player_xp: FIXTURE_XP,
  credits: 24100,
  scrap: 31600,
  cache_tokens: 15,
  total_kills: 12847,
  total_deaths: 312,
  kill_death_ratio: 41.18,
  highest_boss_tier: 7,
  longest_kill_streak: 46,
  active_play_seconds: 219600,
  idle_play_seconds: 1296000,
  kills_by_area: {
    dustwaste: 4213,
    scrapyard: 3087,
    sunken_relay: 2411,
    ashfall: 1736,
    helix_works: 1400,
  },
  kills_by_weapon_type: {
    pistol: 3912,
    smg: 3304,
    shotgun: 2618,
    rifle: 1905,
    sniper: 1108,
  },
  kills_by_element: {
    kinetic: 5200,
    incendiary: 2900,
    cryo: 2100,
    shock: 1600,
    void: 1047,
  },
  net_worth: 486200,
  total_items: 212,
  weapons_owned: 148,
  legendary_items: 9,
  highest_item_level: 31,
  total_mastery_xp: 182340,
  highest_mastery_level: 14,
  last_active_at: new Date().toISOString(),
  joined_at: FIXTURE_JOINED_AT,
};

/** The same six weapons variant A generated, with the same seeds. */
export function generateFixtureWeapons(): Weapon[] {
  try {
    return [
      generateWeapon({ source: DropSource.BossDrop, level: 24, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-a', 1)),
      generateWeapon({ source: DropSource.BossDrop, level: 22, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-b', 2)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 26, forcedRarity: Rarity.Epic }, createTickRng('profile-demo', 'roam-a', 3)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 21, forcedRarity: Rarity.Rare }, createTickRng('profile-demo', 'roam-b', 4)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 19, forcedRarity: Rarity.Rare }, createTickRng('profile-demo', 'roam-c', 5)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 18, forcedRarity: Rarity.Uncommon }, createTickRng('profile-demo', 'roam-d', 6)),
    ];
  } catch {
    return [];
  }
}

function toShowcasePayload(weapon: Weapon) {
  return {
    id: weapon.id,
    item_level: weapon.level,
    rarity: weapon.rarity,
    is_locked: false,
    runtime_state: 'inventory',
    equipped_slot: null,
    payload: weapon as unknown as Record<string, unknown>,
    created_at: FIXTURE_JOINED_AT,
  };
}

export function buildLifetimeFixture(weapons: Weapon[]): ProfileLifetimePayload {
  const top = weapons.slice(0, 3).map(toShowcasePayload);
  return {
    kills: {
      roaming: 11980,
      by_area: STATS_FIXTURE.kills_by_area,
      by_weapon_type: STATS_FIXTURE.kills_by_weapon_type,
      by_element: STATS_FIXTURE.kills_by_element,
      elites: 640,
      named_elites_downed: 9,
    },
    deaths: 312,
    credits: { earned: 894000, spent: 652000, since: FIXTURE_JOINED_AT },
    bosses: {
      attempts: 96,
      victories: 61,
      by_boss: { dune_tyrant: 18, rust_prophet: 12, choir_of_teeth: 9 },
      downed: 7,
    },
    endless: { runs: 31, best_depth: 23, deaths: 19, banked: 12, abandoned: 0 },
    legendaries: {
      salvaged: 4,
      cores_minted: 3,
      cores_spent: 1,
      cores_balance: 3,
      discoveries_by_source: { boss_loot: 5, cache_forge: 2, roaming_drop: 2 },
    },
    caches: { opened: 57, rewarded_keys: 21 },
    crafting: {
      total_units: 342,
      units_by_kind: { consumable: 210, material: 96, tint: 36 },
    },
    consumables: {
      used_total: 488,
      top_used: [
        { type: 'MedKit', count: 121 },
        { type: 'ShieldCell', count: 98 },
      ],
    },
    repair: {
      board_points_restored: 1240,
      board_jobs_completed: 17,
      board_credits_earned: 22100,
      self_points_restored: 860,
      self_jobs: 11,
    },
    dispatch: { completed: 44, foot: 30, courier: 14, credits_earned: 38600 },
    extraction: { passes: 26, xp_awarded: 19200 },
    market: { sales: 23, sales_volume: 96400, fees_paid: 4820, purchases: 11, purchases_volume: 41200 },
    salvage: { items: 1218, scrap_earned: 40200 },
    reforges: 7,
    resurrections: 5,
    collections: { discovered: 34, by_family: { effects: 12, bosses: 9, frames: 8, elites: 5 } },
    showcase: {
      top_weapons: top,
      pinned_item_ids: top.length > 0 ? [top[0].id] : [],
      best_endless_depth: 23,
      cache_rank_tokens: 140,
      cache_rank_total_ranks: 12,
      collections_discovered: 34,
    },
  };
}

export interface ProgressionSnapshotFixture {
  snapshot_date: string;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  net_worth: number;
  total_kills: number;
  total_deaths: number;
  total_items: number;
  mastery_xp: number;
}

/** Thirty daily snapshots rising to today's record — variant A's series. */
export function buildSnapshotsFixture(): ProgressionSnapshotFixture[] {
  const rows: ProgressionSnapshotFixture[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 30; i += 1) {
    const t = i / 29;
    const day = new Date(today.getTime() - (29 - i) * 86_400_000);
    rows.push({
      snapshot_date: day.toISOString().slice(0, 10),
      player_level: Math.round(9 + t * 15),
      player_xp: Math.round(900 + t * 4500),
      credits: Math.round(3000 + t * 21100),
      scrap: Math.round(2400 + t * 29200),
      net_worth: Math.round(42000 + t * 444200),
      total_kills: Math.round(900 + t * 11947),
      total_deaths: Math.round(40 + t * 272),
      total_items: Math.round(30 + t * 182),
      mastery_xp: Math.round(12000 + t * 170340),
    });
  }
  return rows;
}

export interface DeathLogFixture {
  monsterId: string;
  monsterName: string;
  areaId: string;
  at: string;
}

/** The most recent deaths — variant A's log. */
export function buildDeathLogFixture(): DeathLogFixture[] {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  return [
    { monsterId: 'dune_tyrant', monsterName: 'Dune Tyrant', areaId: 'dustwaste', at: daysAgo(2) },
    { monsterId: 'rust_prophet', monsterName: 'Rust Prophet', areaId: 'scrapyard', at: daysAgo(5) },
    { monsterId: 'choir_of_teeth', monsterName: 'Choir of Teeth', areaId: 'sunken_relay', at: daysAgo(9) },
  ];
}

/**
 * Spends mirroring variant A: 18 points spent (Gunslinger 8,
 * Demolition 5, Scavenger 5, Fixer 0) on REAL skill nodes in the
 * store's flat node-id → points shape — leaving exactly 5 unspent
 * at Level 24, and giving the stat summary real skill sources.
 */
function buildSkillSpends(): Record<string, number> {
  const budgets: Record<string, number> = { Gunslinger: 8, Demolition: 5, Scavenger: 5, Fixer: 0 };
  const spent: Record<string, number> = {};
  for (const [tree, budget] of Object.entries(budgets)) {
    let left = budget;
    for (const node of SKILL_NODES) {
      if (left <= 0) break;
      if (node.tree !== tree) continue;
      const take = Math.min(node.maxPoints, left);
      if (take > 0) spent[node.id] = take;
      left -= take;
    }
  }
  return spent;
}

/** The cosmetics view variant A seeded: Bulwark worn, visor variant. */
export function buildCosmeticsView(): CosmeticsStateView {
  const picks = ['bulwark-head', 'bulwark-torso', 'bulwark-back', 'dread-head', 'dread-torso'];
  const parts = picks.map((partId, i) => {
    const def = SKIN_PARTS.find((p) => p.id === partId)!;
    return {
      id: `fx-part-${i + 1}`,
      partId: def.id,
      slot: def.slot,
      setId: def.setId,
      qualityPercent: 82 - i * 7,
      equipped: false,
      createdAt: FIXTURE_JOINED_AT,
    };
  });
  parts[0].equipped = true;
  parts[1].equipped = true;
  parts[2].equipped = true;
  return {
    parts,
    selection: {
      equipped: { head: parts[0].id, torso: parts[1].id, back: parts[2].id },
      headVariant: 'visor',
      wearableVariantIds: ['visor'],
    },
  };
}

/** The set name of the worn head piece ("Bulwark") — caption truth. */
export function fixtureWornSetName(): string | undefined {
  const view = buildCosmeticsView();
  const part = view.parts.find((p) => p.id === view.selection.equipped.head);
  const def = part ? SKIN_PARTS.find((p) => p.id === part.partId) : undefined;
  return def ? skinSetById(def.setId)?.name : undefined;
}

let seeded = false;

/**
 * Seed every store the page's real pieces read, once. The pinned
 * trophy (weapons[0]) is also the equipped primary, so the shipped
 * Totals & Sources sheet assembles real sources for this hunter.
 */
export function seedFixtureStores(weapons: Weapon[]): void {
  if (seeded) return;
  seeded = true;
  usePlayerStore.setState({
    name: STATS_FIXTURE.display_name ?? 'Rook Sandoval',
    profileLoaded: true,
    level: FIXTURE_LEVEL,
    xp: FIXTURE_XP,
    credits: STATS_FIXTURE.credits,
    scrap: STATS_FIXTURE.scrap,
    cacheKeys: STATS_FIXTURE.cache_tokens,
    legendaryCores: 3,
    cacheRankTokens: 140,
  });
  useSkillStore.setState({ spent: buildSkillSpends() });
  useInventoryStore.setState({ items: weapons });
  if (weapons.length > 0) {
    useLoadoutStore.getState().setSlot('primary', weapons[0].id);
  }
  useSurvivalStore.setState({
    deathLog: buildDeathLogFixture().map((d) => ({
      monsterId: d.monsterId,
      monsterName: d.monsterName,
      areaId: d.areaId,
      at: Date.parse(d.at),
    })),
  });
  useCosmeticsStore.setState({ view: buildCosmeticsView(), loadState: 'ready' });
}
