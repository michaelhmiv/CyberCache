/**
 * ProfileRecordDemo — PROTOTYPE harness (design/hunter-subpages-profile,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Profile record-
 * plate design pass, served only at /profile-demo (main.tsx branches
 * before the real app mounts). This branch is never merged.
 *
 * It mounts the REAL ProfileScreen over seeded store state — the same
 * mid-game hunter as the Hunter-menu pass (Level 24 "Rook Sandoval",
 * 5 points unspent, a death record, generated weapons) — and answers
 * the screen's Chef reads from fixtures SHAPED EXACTLY like the real
 * payloads (PlayerPublicStats for /stats/me, ProfileLifetimePayload
 * for /profile/stats, ProfileSummary, progression snapshots) via a
 * fetch seam installed below. The panels under test run their real
 * code paths against those payloads; nothing is mocked at the
 * component level. No real Chef session is used.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { usePlayerStore, useSkillStore, useInventoryStore, useSurvivalStore } from '@/store';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { xpToNextLevel } from '@/content/simulation';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SKIN_PARTS, type CosmeticsStateView } from '@/content/skins';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';
import { DropSource, Rarity } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { PlayerPublicStats } from '@/lib/api/statsService';

function fillTree(tree: SkillTreeType, budget: number, into: Record<string, number>) {
  const nodes = [...getSkillTreeNodes(tree)].sort((a, b) => a.tier - b.tier || a.index - b.index);
  let remaining = budget;
  for (const node of nodes) {
    if (remaining <= 0) break;
    const add = Math.min(node.maxPoints, remaining);
    if (add > 0) {
      into[node.id] = add;
      remaining -= add;
    }
  }
}

let fixtureWeapons: Weapon[] = [];

const STATS_FIXTURE = {
  user_id: 'fixture-rook',
  username: 'rook_sandoval',
  display_name: 'Rook Sandoval',
  player_level: 24,
  player_xp: 0, // filled from the seeded store at install time
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
  kills_by_area: { dustwaste: 4213, scrapyard: 3087, sunken_relay: 2411, ashfall: 1736, helix_works: 1400 },
  kills_by_weapon_type: { pistol: 3912, smg: 3304, shotgun: 2618, rifle: 1905, sniper: 1108 },
  kills_by_element: { kinetic: 5200, incendiary: 2900, cryo: 2100, shock: 1600, void: 1047 },
  net_worth: 486200,
  total_items: 212,
  weapons_owned: 148,
  legendary_items: 9,
  highest_item_level: 31,
  total_mastery_xp: 182340,
  highest_mastery_level: 14,
  last_active_at: new Date().toISOString(),
  joined_at: '2026-06-14T00:00:00.000Z',
};


function profileRowFixture() {
  const spent: Record<string, number> = {};
  fillTree(SkillTreeType.Gunslinger, 8, spent);
  fillTree(SkillTreeType.Demolition, 5, spent);
  fillTree(SkillTreeType.Scavenger, 5, spent);
  return {
    id: 'fixture-rook',
    username: 'rook_sandoval',
    display_name: 'Rook Sandoval',
    player_level: 24,
    player_xp: Math.floor(xpToNextLevel(24) * 0.62),
    credits: 24100,
    scrap: 31600,
    cache_tokens: 15,
    legendary_cores: 3,
    materials: {},
    essences: {},
    consumables: {},
    skill_spends: spent,
    boss_state: {},
    last_idle_claim_at: new Date().toISOString(),
    last_claimed_tick: 0,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: new Date().toISOString(),
    account_type: 'verified',
    email: 'rook@example.com',
    email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null,
  };
}

function lifetimeFixture() {
  const top = fixtureWeapons.slice(0, 3).map((w) => ({
    id: w.id,
    item_level: w.level,
    rarity: w.rarity,
    is_locked: false,
    runtime_state: 'inventory',
    equipped_slot: null,
    payload: { ...w },
    kind: 'weapon',
    created_at: '2026-10-20T00:00:00.000Z',
  }));
  return {
    kills: {
      roaming: 11980,
      elites: 640,
      named_elites_downed: 9,
      by_area: STATS_FIXTURE.kills_by_area,
      by_weapon_type: STATS_FIXTURE.kills_by_weapon_type,
      by_element: STATS_FIXTURE.kills_by_element,
    },
    deaths: 312,
    credits: { earned: 894000, spent: 652000, since: '2026-06-14T00:00:00.000Z' },
    bosses: { attempts: 96, victories: 61, by_boss: { dune_tyrant: 18, rust_prophet: 12, choir_of_teeth: 9 }, downed: 7 },
    endless: { runs: 31, best_depth: 23, deaths: 19, banked: 12, abandoned: 0 },
    legendaries: {
      salvaged: 4,
      cores_minted: 3,
      cores_spent: 1,
      cores_balance: 3,
      discoveries_by_source: { boss_loot: 5, cache_forge: 2, roaming_drop: 2 },
    },
    caches: { opened: 57, rewarded_keys: 21 },
    crafting: { total_units: 342, units_by_kind: { consumable: 210, material: 96, tint: 36 } },
    consumables: { used_total: 488, top_used: [{ type: 'MedKit', count: 121 }, { type: 'ShieldCell', count: 98 }] },
    repair: { board_points_restored: 1240, board_jobs_completed: 17, board_credits_earned: 22100, self_points_restored: 860, self_jobs: 11 },
    dispatch: { completed: 44, foot: 30, courier: 14, credits_earned: 38600 },
    extraction: { passes: 26, xp_awarded: 19200 },
    market: { sales: 23, sales_volume: 96400, fees_paid: 4820, purchases: 11, purchases_volume: 41200 },
    salvage: { items: 1218, scrap_earned: 40200 },
    reforges: 7,
    resurrections: 5,
    collections: { discovered: 34, by_family: { effects: 12, bosses: 9, frames: 8, elites: 5 } },
    showcase: {
      top_weapons: top,
      pinned_item_ids: top.length ? [top[0].id] : [],
      best_endless_depth: 23,
      cache_rank_tokens: 140,
      cache_rank_total_ranks: 12,
      collections_discovered: 34,
    },
  };
}

function snapshotsFixture() {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 30; i += 1) {
    const t = i / 29;
    rows.push({
      snapshot_at: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
      level: Math.round(9 + t * 15),
      xp: Math.round(1800 + t * 12900),
      net_worth: Math.round(42000 + t * 444200),
      total_kills: Math.round(900 + t * 11947),
      credits: Math.round(3000 + t * 21100),
      scrap: Math.round(2400 + t * 29200),
      total_mastery_xp: Math.round(12000 + t * 170340),
      highest_mastery_level: Math.round(3 + t * 11),
      total_deaths: Math.round(40 + t * 272),
      highest_boss_tier: Math.round(1 + t * 6),
      total_items: Math.round(30 + t * 182),
      legendary_items: Math.round(t * 9),
      weapons_owned: Math.round(20 + t * 128),
      highest_item_level: Math.round(8 + t * 23),
    });
  }
  return rows;
}

const SUMMARY_FIXTURE = {
  username: 'rook_sandoval',
  display_name: 'Rook Sandoval',
  can_rename_at: null,
};

/** The fetch seam: answer the Profile screen's Chef reads from the
 *  fixtures above; everything else falls through to the real fetch
 *  (and fails quietly offline, as the panels are built to tolerate). */
let seamInstalled = false;
// Install at module scope: main.tsx imports this module statically,
// so the seam exists before the AuthProvider's first boot fetch —
// the signed-in boot (profile row, stats, items) must hit fixtures,
// not the real Chef, or the screen hydrates as a signed-out guest.
installFixtureSeam();
function installFixtureSeam() {
  if (seamInstalled) return;
  seamInstalled = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/profile/me')) return json(profileRowFixture());
    if (url.includes('/profile/stats')) return json(lifetimeFixture());
    if (url.includes('/runtime/items')) return json([]);
    if (url.includes('/stats/combat')) return json(null);
    if (url.includes('/settle')) return json({});
    if (url.includes('/stats/me')) {
      return json({ ...STATS_FIXTURE, player_xp: usePlayerStore.getState().xp });
    }
    if (url.includes('/profile/summary')) return json(SUMMARY_FIXTURE);
    if (url.includes('/progression/snapshots')) return json(snapshotsFixture());
    if (url.includes('/profile/showcase-pins')) return json({ ok: true, pinned_item_ids: [] });
    return realFetch(input, init);
  }) as typeof window.fetch;
}

function seedFixture() {
  installFixtureSeam();
  const level = 24;
  usePlayerStore.setState({
    name: 'Rook Sandoval',
    profileLoaded: true,
    level,
    xp: Math.floor(xpToNextLevel(level) * 0.62),
    credits: 24100,
    scrap: 31600,
    cacheKeys: 15,
    legendaryCores: 3,
    cacheRankTokens: 140,
  });

  const spent: Record<string, number> = {};
  fillTree(SkillTreeType.Gunslinger, 8, spent);
  fillTree(SkillTreeType.Demolition, 5, spent);
  fillTree(SkillTreeType.Scavenger, 5, spent);
  useSkillStore.setState({ spent });

  try {
    fixtureWeapons = [
      generateWeapon({ source: DropSource.BossDrop, level: 24, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-a', 1)),
      generateWeapon({ source: DropSource.BossDrop, level: 22, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-b', 2)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 26, forcedRarity: Rarity.Epic }, createTickRng('profile-demo', 'roam-a', 3)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 21, forcedRarity: Rarity.Rare }, createTickRng('profile-demo', 'roam-b', 4)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 19, forcedRarity: Rarity.Rare }, createTickRng('profile-demo', 'roam-c', 5)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 18, forcedRarity: Rarity.Uncommon }, createTickRng('profile-demo', 'roam-d', 6)),
    ];
    useInventoryStore.setState({ items: fixtureWeapons });
  } catch (error) {
    console.warn('[profile-demo] weapon fixture failed, continuing without inventory', error);
  }

  const picks = ['bulwark-head', 'bulwark-torso', 'bulwark-back', 'dread-head', 'dread-torso']
    .map((id) => SKIN_PARTS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const parts = picks.map((def, i) => ({
    id: `fx-part-${i + 1}`,
    partId: def.id,
    slot: def.slot,
    setId: def.setId,
    tier: def.tier,
    name: def.name,
    quality: 82 - i * 7,
    tintPaletteId: null,
    runtimeState: 'owned',
  }));
  const view: CosmeticsStateView = {
    selection: {
      equipped: { head: 'fx-part-1', torso: 'fx-part-2', back: 'fx-part-3' },
      headVariant: 'visor',
    },
    selectionExists: true,
    parts,
    wearableVariantIds: ['visor'],
  };
  useCosmeticsStore.setState({ view, loadState: 'ready' });

  const now = Date.now();
  useSurvivalStore.setState({
    deathLog: [
      { monsterId: 'dune_tyrant', monsterName: 'Dune Tyrant', areaId: 'dustwaste', at: now - 2 * 86400000 },
      { monsterId: 'rust_prophet', monsterName: 'Rust Prophet', areaId: 'scrapyard', at: now - 5 * 86400000 },
      { monsterId: 'choir_of_teeth', monsterName: 'Choir of Teeth', areaId: 'sunken_relay', at: now - 9 * 86400000 },
    ],
  });
}

export const ProfileRecordDemo: React.FC = () => {
  const { loading } = useAuth();
  const [seeded, setSeeded] = useState(false);

  // Seed only after the AuthProvider boot reset settles (the same
  // discipline the Hunter-menu harness used), then mount the screen.
  useEffect(() => {
    if (loading || seeded) return;
    const t = setTimeout(() => {
      seedFixture();
      setSeeded(true);
    }, 350);
    return () => clearTimeout(t);
  }, [loading, seeded]);

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="profile-demo">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {seeded && <ProfileScreen onNavigate={() => {}} fixtureStats={{ ...STATS_FIXTURE, player_xp: Math.floor(xpToNextLevel(24) * 0.62) } as PlayerPublicStats} />}
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
