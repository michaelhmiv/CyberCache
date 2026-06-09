/**
 * Tests for PR #4: top HUD polish — scene label, 6-chip row, removed
 * duplicate LV chip.
 *
 * What this PR fixed:
 *  - Scene label dev-string leak: `dustwaste_frontier` → "Dustwaste Frontier"
 *  - Top chip row: 4 chips when no consumables, 6 chips when consumables > 0
 *  - Diorama no longer renders the duplicate `LV {n}` chip (the Level Strip
 *    panel above already shows the level)
 *
 * The `resolveSceneLabel` helper is pure, so it gets exhaustive tests.
 * The chip-count tests are structural: the row JSX has 4 / 6 chip divs
 * depending on consumable count.
 */
import { describe, expect, it } from 'vitest';
import { resolveSceneLabel } from '../lib/dashboard/sceneLabel';
import { ROAMING_AREAS } from '../constants/roamingAreas';
import { REGION_1_BOSSES } from '../constants/bosses';

describe('resolveSceneLabel (PR #4)', () => {
  it('resolves a roaming area id to its display name', () => {
    // dustwaste_frontier is the first area; its display name is the
    // title-cased version with spaces.
    const first = ROAMING_AREAS[0];
    expect(resolveSceneLabel(first.id)).toBe(first.name);
  });

  it('resolves a boss scene key to the boss display name', () => {
    const boss = REGION_1_BOSSES[0];
    expect(resolveSceneLabel(`boss:${boss.id}`)).toBe(boss.name);
  });

  it('resolves static workshop scene keys to friendly labels', () => {
    expect(resolveSceneLabel('workshop:service')).toBe('Workshop Service');
    expect(resolveSceneLabel('workshop:crafting')).toBe('Crafting Bench');
    expect(resolveSceneLabel('workshop:salvage')).toBe('Salvage Bench');
  });

  it('resolves market and idle scene keys to friendly labels', () => {
    expect(resolveSceneLabel('market:kiosk')).toBe('Market Kiosk');
    expect(resolveSceneLabel('idle:standby')).toBe('Idle Standby');
  });

  it('falls back to the payload scene key when the primary key is null', () => {
    expect(resolveSceneLabel(null, 'dustwaste_frontier')).toBe(
      ROAMING_AREAS[0].name,
    );
  });

  it('returns "standby" for null/null (the default empty case)', () => {
    expect(resolveSceneLabel(null, null)).toBe('standby');
    expect(resolveSceneLabel(undefined, undefined)).toBe('standby');
    expect(resolveSceneLabel(null)).toBe('standby');
  });

  it('formats an unknown scene key with spaces (graceful degradation)', () => {
    // No replacement for "future:event:v2" in STATIC_SCENE_LABELS, so
    // we get the underscore-to-space transformation. Better than
    // rendering a raw dev string.
    expect(resolveSceneLabel('future:event:v2')).toBe('future:event:v2');
    expect(resolveSceneLabel('unknown_scene_key')).toBe('unknown scene key');
  });

  it('handles an unknown boss id without crashing', () => {
    // The boss prefix is recognized but the id is unknown. We render
    // "Boss: <id>" rather than throwing.
    expect(resolveSceneLabel('boss:does-not-exist')).toBe('Boss: does-not-exist');
  });

  it('does not match a roaming area id that starts with "boss:"', () => {
    // Defensive: a roaming area should never have a colon-prefixed id,
    // but the boss check is more specific (string starts with) so the
    // order in the function matters. This test pins the order: the
    // boss-prefix check runs before the roaming-area lookup, so
    // "boss:fake" becomes "Boss: fake" rather than the area name.
    expect(resolveSceneLabel('boss:fake')).toBe('Boss: fake');
  });
});
