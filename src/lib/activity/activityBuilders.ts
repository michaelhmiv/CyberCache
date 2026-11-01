import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { BossPhase, StartActivityInput } from '@/types/activity';
import { DEFAULT_BOSS_PHASE } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';

const weaponPublicSummary = (weapon?: Weapon) => {
  if (!weapon) return {};
  return {
    weapon_id: weapon.id,
    weapon_name: weapon.name,
    weapon_rarity: weapon.rarity,
    weapon_type: weapon.weaponType,
    weapon_element: weapon.element,
    weapon_manufacturer: weapon.manufacturer,
  };
};

const gearPublicSummary = (item?: GearItem) => {
  if (!item) return {};
  return {
    item_id: item.id,
    item_name: item.name,
    item_rarity: item.rarity,
    item_level: item.level,
  };
};

export function buildRoamingLootActivity(area: RoamingAreaDef, weapon?: Weapon): StartActivityInput {
  return {
    kind: 'roaming_loot',
    targetType: 'roaming_area',
    targetId: area.id,
    targetLabel: area.name,
    sceneKey: area.id,
    notes: `Roaming ${area.name}`,
    activityPayload: {
      area_id: area.id,
      area_name: area.name,
      enemy_type: area.enemyType,
      danger_rating: area.dangerRating,
      loot_bias: area.lootBias,
      weapon_id: weapon?.id ?? null,
    },
    publicPayload: {
      activity_label: `Roaming ${area.name}`,
      target_label: area.name,
      enemy_type: area.enemyType,
      danger_rating: area.dangerRating,
      scene_key: area.id,
      ...weaponPublicSummary(weapon),
    },
    publicVisible: true,
  };
}

export function buildBossFightActivity(
  boss: { id: string; name: string; level?: number; tier?: number; weaknesses?: string[] },
  weapon?: Weapon,
  phase: BossPhase = DEFAULT_BOSS_PHASE,
  outcome?: 'victory' | 'defeat',
): StartActivityInput {
  // CONS-03 (audit fix A): the 'resolved' phase is the encounter's
  // terminal state — the attempt has settled, so the persisted label
  // must say so. Before this phase existed, a resolved attempt left
  // the activity staged at 'fight' forever and every read surface
  // (Profile CURRENT ACTIVITY, the Dashboard boss card) kept claiming
  // "Fighting <boss>" after the victory and across reloads.
  const label = phase === 'fight'
    ? `Fighting ${boss.name}`
    : phase === 'resolved'
      ? outcome === 'defeat'
        ? `Fell to ${boss.name}`
        : `Defeated ${boss.name}`
      : `Preparing for ${boss.name}`;
  return {
    kind: 'boss_fight',
    bossPhase: phase,
    targetType: 'boss',
    targetId: boss.id,
    targetLabel: boss.name,
    sceneKey: `boss:${boss.id}`,
    notes: label,
    activityPayload: {
      boss_id: boss.id,
      boss_name: boss.name,
      boss_level: boss.level ?? null,
      boss_tier: boss.tier ?? null,
      weapon_id: weapon?.id ?? null,
    },
    publicPayload: {
      activity_label: label,
      target_label: boss.name,
      boss_level: boss.level ?? null,
      boss_tier: boss.tier ?? null,
      weakness_count: boss.weaknesses?.length ?? 0,
      scene_key: `boss:${boss.id}`,
      ...weaponPublicSummary(weapon),
    },
    publicVisible: true,
  };
}

export function buildCraftingActivity(recipe: { id: string; name: string; category?: string }, benchId?: number | null): StartActivityInput {
  return {
    kind: 'crafting',
    targetType: 'workshop_job',
    targetId: recipe.id,
    targetLabel: recipe.name,
    sceneKey: 'workshop:crafting',
    notes: `Dispatching ${recipe.name}`,
    activityPayload: {
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      category: recipe.category ?? null,
      bench_id: benchId ?? null,
    },
    publicPayload: {
      activity_label: `Crafting ${recipe.name}`,
      target_label: recipe.name,
      category: recipe.category ?? null,
      bench_id: benchId ?? null,
      scene_key: 'workshop:crafting',
    },
    publicVisible: true,
  };
}

/**
 * Extraction (0033): the gathering occupation pointed at one site.
 * The target is the roaming area; the method rides the activity
 * payload — the server reads BOTH from this recorded action (the
 * extraction_state row syncs from it at the transition), and a
 * site/method change takes effect at the next pass boundary.
 */
export function buildExtractionActivity(
  area: { id: string; name: string },
  method: 'surface' | 'deep',
): StartActivityInput {
  return {
    kind: 'extraction',
    targetType: 'roaming_area',
    targetId: area.id,
    targetLabel: area.name,
    sceneKey: 'fight:extraction',
    notes: method === 'deep' ? `Deep Delve in ${area.name}` : `Extracting in ${area.name}`,
    activityPayload: {
      area_id: area.id,
      method,
    },
    publicPayload: {
      activity_label: method === 'deep' ? `Deep Delve — ${area.name}` : `Extraction — ${area.name}`,
      target_label: area.name,
      scene_key: 'fight:extraction',
    },
    publicVisible: true,
  };
}

/**
 * Workshop service work (mechanics & repair, 0025): the one activity
 * slot pointed at a repair job — a board job the player accepted as
 * mechanic, or their own timed self-repair job. Progress accrues
 * server-side only while this action targets the job (board jobs) or
 * is simply active (self-repair lane).
 */
export function buildWorkshopServiceActivity(job: { id: string; label: string }): StartActivityInput {
  return {
    kind: 'workshop_service',
    targetType: 'workshop_job',
    targetId: job.id,
    targetLabel: job.label,
    sceneKey: 'workshop:service',
    notes: `Servicing ${job.label}`,
    activityPayload: {
      job_id: job.id,
      job_label: job.label,
    },
    publicPayload: {
      activity_label: `Repair work — ${job.label}`,
      target_label: job.label,
      scene_key: 'workshop:service',
    },
    publicVisible: true,
  };
}

export function buildSalvagingActivity(item: GearItem): StartActivityInput {
  return {
    kind: 'salvaging',
    targetType: 'item',
    targetId: item.id,
    targetLabel: item.name,
    sceneKey: 'workshop:salvage',
    notes: `Salvaging ${item.name}`,
    activityPayload: {
      item_id: item.id,
      item_name: item.name,
      rarity: item.rarity,
      level: item.level,
    },
    publicPayload: {
      activity_label: `Salvaging ${item.name}`,
      target_label: item.name,
      scene_key: 'workshop:salvage',
      ...gearPublicSummary(item),
    },
    publicVisible: true,
  };
}
