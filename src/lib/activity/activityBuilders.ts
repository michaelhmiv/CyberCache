import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { StartActivityInput } from '@/types/activity';
import type { Weapon } from '@/types/items';

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

export function buildBossPrepActivity(boss: { id: string; name: string; weaknesses?: string[] }, weapon?: Weapon): StartActivityInput {
  return {
    kind: 'boss_prep',
    targetType: 'boss',
    targetId: boss.id,
    targetLabel: boss.name,
    sceneKey: `boss:${boss.id}`,
    notes: `Preparing for ${boss.name}`,
    activityPayload: {
      boss_id: boss.id,
      boss_name: boss.name,
      weaknesses: boss.weaknesses ?? [],
      weapon_id: weapon?.id ?? null,
    },
    publicPayload: {
      activity_label: `Preparing for ${boss.name}`,
      target_label: boss.name,
      weakness_count: boss.weaknesses?.length ?? 0,
      scene_key: `boss:${boss.id}`,
      ...weaponPublicSummary(weapon),
    },
    publicVisible: true,
  };
}

export function buildBossFightActivity(boss: { id: string; name: string; level?: number; tier?: number }, weapon?: Weapon): StartActivityInput {
  return {
    kind: 'boss_fight',
    targetType: 'boss',
    targetId: boss.id,
    targetLabel: boss.name,
    sceneKey: `boss:${boss.id}`,
    notes: `Fighting ${boss.name}`,
    activityPayload: {
      boss_id: boss.id,
      boss_name: boss.name,
      boss_level: boss.level ?? null,
      boss_tier: boss.tier ?? null,
      weapon_id: weapon?.id ?? null,
    },
    publicPayload: {
      activity_label: `Fighting ${boss.name}`,
      target_label: boss.name,
      boss_level: boss.level ?? null,
      boss_tier: boss.tier ?? null,
      scene_key: `boss:${boss.id}`,
      ...weaponPublicSummary(weapon),
    },
    publicVisible: true,
  };
}
