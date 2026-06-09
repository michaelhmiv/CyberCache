/**
 * resolveSceneLabel — converts a scene key (the dev string stored in
 * `activity.current.sceneKey`) into a human-readable label.
 *
 * Scene keys come in three flavors:
 *  1. Roaming area id, e.g. `dustwaste_frontier` → "Dustwaste Frontier"
 *  2. Boss prefix, e.g. `boss:salt-vault-mauler` → boss display name
 *  3. Static scene keys for workshop/market/etc., e.g. `workshop:service`
 *
 * The function is pure and exported for unit testing. It gracefully
 * degrades to the raw key (or empty string) if nothing matches, so a
 * future scene type doesn't render as a dev string in the UI.
 *
 * Plan: hud-component-plan.md PR #4 §6.1
 */
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { REGION_1_BOSSES } from '@/constants/bosses';

const STATIC_SCENE_LABELS: Record<string, string> = {
  'workshop:service': 'Workshop Service',
  'workshop:crafting': 'Crafting Bench',
  'workshop:salvage': 'Salvage Bench',
  'market:kiosk': 'Market Kiosk',
  'workshop:bench': 'Workshop Bench',
  'idle:standby': 'Idle Standby',
  'idle:none': 'Idle Standby',
};

export function resolveSceneLabel(
  sceneKey: string | null | undefined,
  payloadSceneKey?: string | null,
): string {
  const key = sceneKey ?? payloadSceneKey ?? null;
  if (!key) return 'standby';
  // Roaming area: sceneKey === area.id
  const area = ROAMING_AREAS.find((a) => a.id === key);
  if (area) return area.name;
  // Boss: sceneKey === `boss:${id}`
  if (key.startsWith('boss:')) {
    const bossId = key.slice(5);
    const boss = REGION_1_BOSSES.find((b) => b.id === bossId);
    if (boss) return boss.name;
    return `Boss: ${bossId}`;
  }
  // Static scene keys (workshop, market, idle)
  if (STATIC_SCENE_LABELS[key]) return STATIC_SCENE_LABELS[key];
  // Unknown key — surface the raw value rather than a dev string, but
  // replace underscores with spaces for human readability. Future
  // scene types should be added to STATIC_SCENE_LABELS.
  return key.replace(/_/g, ' ');
}
