/**
 * HTR-03 SUB-FIXES (the two unambiguous parts; the canonical-pool
 * question stays an open ruling and is NOT settled here).
 *
 * 1) The dead survival term. characterStats used to scale every HP
 *    source by `1 + skillTotal(spentSkills, 'survival')`. No skill
 *    node emits an effect key named 'survival' (the composite named
 *    'survival' in skillBonuses.ts is a different mechanism), so the
 *    multiplier was permanently 1 — dead code wearing a comment that
 *    claimed it "applies to all HP sources uniformly". It is removed;
 *    the numbers are unchanged (asserted below against the audit's
 *    fixture arithmetic).
 *
 * 2) The HP/EHP mislabel. The Totals health metric's value is the
 *    mitigation-inflated EFFECTIVE HP (pool ÷ (1 − mitigation)),
 *    but it was labeled 'HP' — so Hunter advertised 3,053 "HP" for a
 *    2,290 pool in the audit's fixture. The metric now labels itself
 *    'Effective HP' and its detail names the actual HP pool. The
 *    value itself is deliberately unchanged: which pool is canonical
 *    is the open HTR-03 ruling, and the breakdown's segments (chassis
 *    + shield pool + buffer + mitigation-as-HP) still sum to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { SKILL_NODES } from '@/constants/skillTrees';
import { DropSource, Element, Rarity } from '@/types/game';
import type { Shield } from '@/types/items';
import type { PlayerProfile } from '@/types/player';

const player: PlayerProfile = {
  id: 'test-player',
  name: 'Test Hunter',
  level: 20,
  xp: 0,
  credits: 0,
  scrap: 0,
  cacheKeys: 0,
  cacheRankTokens: 0,
  cacheRankSpends: {},
  vehicleFuel: 0,
  legendaryCores: 0,
  currentZoneId: 'zone-1',
  highestZoneId: 'zone-1',
  offlineCapHours: 8,
  lastClaimTime: 0,
  deathFeeInsurance: false,
  consumables: {},
  consumableBatches: [],
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: 0,
  lastClaimedTick: 0,
};

const shield: Shield = {
  id: 's1',
  name: 'Test Shield',
  rarity: Rarity.Common,
  level: 1,
  hp: 200,
  rechargeRate: 11.5,
  mitigation: 0.25,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 0,
};

describe('HTR-03 sub-fixes — dead survival term + HP/EHP label', () => {
  it('the health metric labels its mitigation-inflated value as Effective HP and names the pool', () => {
    const summary = buildCharacterStatSummary({ player, weapons: [], shield, spentSkills: {} });
    const health = summary.all.find((metric) => metric.key === 'health');
    expect(health).toBeDefined();
    // Audit fixture arithmetic: pool = 700 + 60·20 + 200 shield = 2,100;
    // mitigation 25% converts to +700 HP; effective HP = 2,800.
    expect(health!.value).toBe(2800);
    expect(health!.label).toBe('Effective HP');
    expect(health!.label).not.toBe('HP');
    expect(health!.detail).toContain('HP pool 2,100');
    const mitigation = health!.contributions.find((c) => c.detail.startsWith('Mitigation'));
    expect(mitigation?.value).toBe(700);
  });

  it('no skill node emits a survival effect key (the removed term stays dead)', () => {
    for (const node of SKILL_NODES) {
      expect(node.effects?.survival, `node ${node.id} now emits 'survival' — revisit the HTR-03 removal`).toBeUndefined();
    }
  });

  it('characterStats no longer reads the dead survival key', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/stats/characterStats.ts'), 'utf8');
    // Scan code only — the removal note in the file's own comment
    // quotes the old call shape and must not trip the wire.
    const code = src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/skillTotal\([^)]*'survival'\)/);
  });
});
