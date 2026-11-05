/**
 * FREEZE RULE pin (equip-comparison memo §4): picker and market
 * rows render in the hundreds on deep inventories, so a row may
 * only do O(item) field reads. The build-layer summary/snapshot
 * builders — the math "The Trade" runs once per opened sheet —
 * must NEVER fire while rows render. Spies wrap the real builders
 * so any call from a row is caught; source pins keep the row
 * components from importing them at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/stats/characterStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stats/characterStats')>();
  return { ...actual, buildCharacterStatSummary: vi.fn(actual.buildCharacterStatSummary) };
});
vi.mock('@/lib/mechanics/buildCharacterMechanicsSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mechanics/buildCharacterMechanicsSnapshot')>();
  return { ...actual, buildCharacterMechanicsSnapshot: vi.fn(actual.buildCharacterMechanicsSnapshot) };
});

import { GearCompare } from '@/components/gear/GearCompare';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

function weapon(id: string, overrides: Partial<Weapon> = {}): Weapon {
  return {
    id, name: id, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 50, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0.1, statusDamage: 0.5,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0.5, armorDamageMod: 0.5,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 1, combatPower: 100, bossPower: 100, farmPower: 100, economyScore: 0,
    ...overrides,
  };
}

describe('GearCompare row cost (freeze rule)', () => {
  it('rendering a deep list of compare rows runs ZERO summary/snapshot builds', () => {
    const current = weapon('worn-gun');
    const rows = Array.from({ length: 60 }, (_, i) =>
      weapon(`candidate-${i}`, { baseDamage: 40 + i, offlineEarningsMod: i / 100 }),
    );
    const { container } = render(
      <div>
        {rows.map((candidate) => (
          <GearCompare key={candidate.id} current={current} candidate={candidate} />
        ))}
      </div>,
    );
    // The rows really rendered their strips (the pin is not vacuous).
    expect(container.textContent).toContain('DPS');
    expect(vi.mocked(buildCharacterStatSummary)).not.toHaveBeenCalled();
    expect(vi.mocked(buildCharacterMechanicsSnapshot)).not.toHaveBeenCalled();
  });

  it('source pin: row components never import the summary layer', () => {
    for (const path of ['src/components/gear/GearCompare.tsx', 'src/components/action/SlotGearPicker.tsx']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).not.toMatch(/buildCharacterStatSummary|buildCharacterMechanicsSnapshot|buildSwapComparison/);
    }
  });
});
