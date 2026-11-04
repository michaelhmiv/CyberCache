/**
 * Migration 0076 — kill attribution reads the real weapon slots.
 *
 * The defect (root-caused by PR #377, which fixed the in-memory
 * twin): cc_record_kill_stats derived the held weapon from the
 * equipped row at equipped_slot = 'weapon' — a slot the equip path
 * has never written (weapons equip to primary / secondary / heavy) —
 * so every production kill in history sits under 'unarmed' in both
 * kill tables. 0076 restates the function from its chain head (0051;
 * created 0034, element accumulation added 0051) with ONLY the
 * weapon lookup changed: the real slots, primary-first precedence,
 * the first OCCUPIED slot deciding even when its payload lacks the
 * fields (missing or empty-string reads 'unarmed', never a fall-
 * through, never an invention).
 *
 * Two pin layers:
 *  - SQL pins (this file, CI): 0076 is the chain head; its body is
 *    the 0051 body verbatim outside the lookup block; the lookup
 *    carries the real-slot predicate and precedence.
 *  - Parity fixtures (this file + slice verification): one fixture
 *    matrix, run through the in-memory twin here and against the
 *    REAL function on real Postgres in the slice verification
 *    (cybercache-prep/killattr-verification/ — full chain through
 *    0075 reproduces the 'unarmed' defect, then 0076 lands and the
 *    same fixtures attribute correctly). Historical rows are NOT
 *    backfilled by the migration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryChefGameplayStore } from '@/server/gameplay/memory';

const FN = 'cc_record_kill_stats';

function fnBody(text: string): string {
  const start = text.indexOf(`create or replace function public.${FN}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf('\n$$;\n', start));
}

/** Replace the weapon-lookup SELECT (guard line .. limit 1) with a marker. */
function stripLookup(body: string): string {
  return body.replace(/  select [\s\S]*?   limit 1;/, '  <LOOKUP>;');
}

describe('migration 0076 — provenance and shape pins', () => {
  const dir = join(process.cwd(), 'db/migrations');
  const sql0076 = readFileSync(join(dir, '0076_kill_attribution.sql'), 'utf8');
  const sql0051 = readFileSync(join(dir, '0051_profile_lifetime_counters.sql'), 'utf8');

  it('0076 is the chain head for cc_record_kill_stats, off 0051', () => {
    const definers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes(`create or replace function public.${FN}(`))
      .sort();
    expect(definers).toEqual([
      '0034_profile_stats.sql',
      '0051_profile_lifetime_counters.sql',
      '0076_kill_attribution.sql',
    ]);
  });

  it('the lookup reads the real weapon slots, primary first', () => {
    const body = fnBody(sql0076);
    expect(body).toContain("equipped_slot in ('primary', 'secondary', 'heavy')");
    expect(body).toContain("when 'primary' then 0");
    expect(body).toContain("when 'secondary' then 1");
    expect(body).not.toContain("equipped_slot = 'weapon'");
    // The twin's non-empty-string rule: an empty payload field reads
    // 'unarmed' via the same coalesce the inserts always carried.
    expect(body).toContain("nullif(payload ->> 'weaponType', '')");
    expect(body).toContain("nullif(payload ->> 'element', '')");
  });

  it('everything outside the lookup is the 0051 body verbatim', () => {
    expect(stripLookup(fnBody(sql0076))).toBe(stripLookup(fnBody(sql0051)));
    // Signature, guard, and both accumulation inserts ride unchanged.
    const body = fnBody(sql0076);
    expect(body).toContain('if _kills is null or _kills <= 0 then return; end if;');
    expect(body).toContain('insert into public.player_kill_stats(user_id, weapon_type, kills)');
    expect(body).toContain('insert into public.player_kill_element_stats(user_id, element, kills)');
  });
});

// ─── Twin parity: the fixture matrix the real-PG probes also run ────

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

interface Fixture {
  name: string;
  items: Array<{ slot: string; kind?: string; payload: Record<string, unknown> }>;
  kills: number;
  weapon: Record<string, number>;
  element: Record<string, number>;
}

const SPARSE_STARTER = {
  id: '99999999-8888-7777-6666-555555555555',
  name: 'Starter Pistol',
  weaponType: 'Pistol',
  element: 'Kinetic',
  manufacturer: 'Redline',
  rarity: 'Common',
  level: 1,
  combatPower: 5,
  bossPower: 3,
  dps: 5,
  sourceTag: 'Starter Kit',
};

const FIXTURES: Fixture[] = [
  {
    name: 'primary only attributes to the primary',
    items: [{ slot: 'primary', payload: { weaponType: 'SMG', element: 'Shock' } }],
    kills: 3, weapon: { SMG: 3 }, element: { Shock: 3 },
  },
  {
    name: 'secondary only attributes to the secondary',
    items: [{ slot: 'secondary', payload: { weaponType: 'Pistol', element: 'Kinetic' } }],
    kills: 2, weapon: { Pistol: 2 }, element: { Kinetic: 2 },
  },
  {
    name: 'heavy only attributes to the heavy',
    items: [{ slot: 'heavy', payload: { weaponType: 'Launcher', element: 'Fire' } }],
    kills: 4, weapon: { Launcher: 4 }, element: { Fire: 4 },
  },
  {
    name: 'primary outranks heavy',
    items: [
      { slot: 'heavy', payload: { weaponType: 'Launcher', element: 'Fire' } },
      { slot: 'primary', payload: { weaponType: 'AssaultRifle', element: 'Corrosive' } },
    ],
    kills: 5, weapon: { AssaultRifle: 5 }, element: { Corrosive: 5 },
  },
  {
    name: 'secondary outranks heavy',
    items: [
      { slot: 'heavy', payload: { weaponType: 'Launcher', element: 'Fire' } },
      { slot: 'secondary', payload: { weaponType: 'SMG', element: 'Shock' } },
    ],
    kills: 6, weapon: { SMG: 6 }, element: { Shock: 6 },
  },
  {
    name: 'no weapon equipped records unarmed (shield is not a weapon)',
    items: [{ slot: 'shield', kind: 'shield', payload: { name: 'Aegis Plate' } }],
    kills: 7, weapon: { unarmed: 7 }, element: { unarmed: 7 },
  },
  {
    name: 'the sparse starter seed in primary attributes as the Pistol it declares',
    items: [{ slot: 'primary', payload: { ...SPARSE_STARTER } }],
    kills: 5, weapon: { Pistol: 5 }, element: { Kinetic: 5 },
  },
  {
    name: 'a weapon whose payload lacks an element records the type, element unarmed',
    items: [{ slot: 'primary', payload: { weaponType: 'Sniper' } }],
    kills: 2, weapon: { Sniper: 2 }, element: { unarmed: 2 },
  },
  {
    name: 'an occupied primary with an empty payload decides — no fall-through to secondary',
    items: [
      { slot: 'secondary', payload: { weaponType: 'SMG', element: 'Shock' } },
      { slot: 'primary', payload: {} },
    ],
    kills: 3, weapon: { unarmed: 3 }, element: { unarmed: 3 },
  },
  {
    name: 'zero kills record nothing',
    items: [{ slot: 'primary', payload: { weaponType: 'SMG', element: 'Shock' } }],
    kills: 0, weapon: {}, element: {},
  },
];

describe('kill attribution — twin parity over the probe fixture matrix', () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const store = new InMemoryChefGameplayStore();
      store.seedProfile({ id: A, player_level: 5, credits: 0, scrap: 0 });
      fixture.items.forEach((item, i) => {
        store.seedItem({
          id: `fixture-item-${i}`,
          owner_user_id: A,
          kind: item.kind ?? 'weapon',
          runtime_state: 'equipped',
          equipped_slot: item.slot,
          payload: item.payload,
        });
      });
      await store.applyChefRewards(
        A,
        { credits: 0, scrap: 0, xp: 0, fragments: 0, materials: {}, essences: {}, kills: fixture.kills },
        1,
        'dustwaste_frontier',
      );
      expect(store.killStatsFor(A)).toEqual(fixture.weapon);
      expect(store.killElementStatsFor(A)).toEqual(fixture.element);
    });
  }
});
