/**
 * Flow-fix regression pins (F5 / F10 / F14):
 *
 * - F5: Action-tab salvage used to stage a `salvaging` activity no
 *   server system executes (item never recycled, slot occupied). The
 *   fix executes through verifiedOps.recycleItem immediately, and its
 *   forecast is the shared server-truth base award — salvageScrap is
 *   the single TS owner, mirroring SQL cc_salvage_scrap exactly.
 * - F10: the Action panel showed a stale 3%/tick fragment rate while
 *   the Chef ships 0.8%. Rates now derive from ONE owner module
 *   (src/content/roamingRates.ts) consumed by the Chef, the economy
 *   lever defaults, and the client panel.
 * - F14: the consumable "belt" was display-only local state. It now
 *   seeds real boss prep (seedPrepFromBelt) when prep is empty.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { CACHE_FRAGMENT_CHANCE, GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from '@/content/roamingRates';
import { FRAGMENT_CHANCE } from '@/server/chef';
import { useBossStore } from '@/store';

describe('salvageScrap — parity with SQL cc_salvage_scrap', () => {
  it('matches the base-award table (round((10 + level*5) * rarity mult), min 1)', () => {
    expect(salvageScrap('Common', 1)).toBe(15);
    expect(salvageScrap('Uncommon', 1)).toBe(23); // 15 * 1.5 = 22.5 → 23
    expect(salvageScrap('Rare', 10)).toBe(150); // 60 * 2.5
    expect(salvageScrap('Epic', 10)).toBe(240); // 60 * 4
    expect(salvageScrap('Legendary', 50)).toBe(2080); // 260 * 8
    expect(salvageScrap('Common', 100)).toBe(510);
    expect(salvageScrap('Common', 0)).toBe(15); // level floor of 1
  });
});

describe('roaming rates — one owner (F10)', () => {
  it('pins the shipped rates', () => {
    expect(GEAR_DROP_CHANCE).toBe(0.22);
    expect(CACHE_FRAGMENT_CHANCE).toBe(0.008);
    expect(MATERIAL_FIND_CHANCE).toBe(0.08);
  });

  it('the Chef fragment chance IS the shared constant (no second copy)', () => {
    expect(FRAGMENT_CHANCE).toBe(CACHE_FRAGMENT_CHANCE);
  });

  it('the Action screen derives from the owner and keeps no stale literals', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/screens/ActionScreenContextual.tsx'), 'utf8');
    expect(source).toContain("from '@/content/roamingRates'");
    expect(source).not.toContain('CACHE_FRAGMENT_CHANCE_PER_TICK');
    expect(source).not.toContain('0.03');
  });
});

describe('Action-tab salvage executes (F5)', () => {
  it('the screen runs the verified recycle op and never stages a salvaging activity', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/screens/ActionScreenContextual.tsx'), 'utf8');
    expect(source).toContain('verifiedOps.recycleItem');
    expect(source).not.toContain('buildSalvagingActivity');
    expect(source).not.toContain('calculateSalvageYield');
  });

  it('the loot feed inspect sheet carries Equip/Salvage actions (F11)', () => {
    const workspace = readFileSync(resolve(process.cwd(), 'src/components/action/ActionWorkspace.tsx'), 'utf8');
    expect(workspace).toContain('onGearEquip');
    expect(workspace).toContain('onGearSalvage');
    const screen = readFileSync(resolve(process.cwd(), 'src/screens/ActionScreenContextual.tsx'), 'utf8');
    expect(screen).toContain('handleFeedEquip');
    expect(screen).toContain('handleFeedSalvage');
    expect(screen).not.toContain('showMarketPicker');
  });
});

describe('seedPrepFromBelt — the belt is real (F14)', () => {
  const reset = () => useBossStore.setState({ preparedConsumables: {} });

  it('seeds exactly 1 of each owned belted type into empty prep', () => {
    reset();
    useBossStore.getState().seedPrepFromBelt(
      { PreFight: 'MedKit', MidFight: null, Emergency: 'ShieldCell' },
      { MedKit: 3, ShieldCell: 2 },
    );
    expect(useBossStore.getState().preparedConsumables).toEqual({ MedKit: 1, ShieldCell: 1 });
  });

  it('skips belted types the player does not own', () => {
    reset();
    useBossStore.getState().seedPrepFromBelt(
      { PreFight: 'MedKit', MidFight: 'Stim', Emergency: null },
      { MedKit: 0 },
    );
    expect(useBossStore.getState().preparedConsumables).toEqual({});
  });

  it('never overwrites prep the player already set', () => {
    useBossStore.setState({ preparedConsumables: { Stim: 2 } });
    useBossStore.getState().seedPrepFromBelt(
      { PreFight: 'MedKit', MidFight: null, Emergency: null },
      { MedKit: 5 },
    );
    expect(useBossStore.getState().preparedConsumables).toEqual({ Stim: 2 });
  });

  it('a type in two belt slots still seeds once', () => {
    reset();
    useBossStore.getState().seedPrepFromBelt(
      { PreFight: 'MedKit', MidFight: 'MedKit', Emergency: null },
      { MedKit: 4 },
    );
    expect(useBossStore.getState().preparedConsumables).toEqual({ MedKit: 1 });
  });
});
