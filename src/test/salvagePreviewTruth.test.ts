/**
 * Salvage preview truth (economy slice 3) — the client projection
 * must equal the settlement, to the unit.
 *
 * The retired salvage formula (deleted src/constants/salvageRules.ts)
 * promised material/essence/VoidDust yields cc_recycle_item never
 * paid, and two previews quoted it. The replacement —
 * projectSalvageYield (src/lib/gear/salvageAward.ts) — composes the
 * server's own shared pieces (salvageScrap, applySalvageSkillBonuses,
 * legendaryCoreYieldFor) with the player's computeSkillBonuses
 * record. These tests drive settlement through the REAL route
 * (POST /api/ops/recycle-item, mounted exactly as production mounts
 * it, JWT identity) across rarity × kind × level × skill-state and
 * assert the settled scrap_award / cores_award equal the projection
 * exactly, that no guaranteed material is ever projected, and that
 * the King of Scrap bonus material is quoted as kind + chance and
 * settles to exactly that material when the roll lands.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { computeSkillBonuses } from '../lib/skills/skillBonuses';
import { projectSalvageYield } from '../lib/gear/salvageAward';
import type { GearItem } from '../types/items';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

const uid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  };
}

function itemRow(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Common', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol' }, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

interface CaseSpec {
  kind: 'weapon' | 'shield' | 'ordnance' | 'classMod' | 'relic';
  rarity: string;
  level: number;
  effectId?: string;
  rollQuality?: number;
}

const CASES: CaseSpec[] = [
  { kind: 'weapon', rarity: 'Common', level: 1 },
  { kind: 'weapon', rarity: 'Common', level: 7, rollQuality: 5 },
  { kind: 'shield', rarity: 'Common', level: 10 },
  { kind: 'ordnance', rarity: 'Common', level: 3 },
  { kind: 'classMod', rarity: 'Common', level: 12 },
  { kind: 'relic', rarity: 'Common', level: 20 },
  { kind: 'weapon', rarity: 'Uncommon', level: 8 },
  { kind: 'shield', rarity: 'Uncommon', level: 25 },
  { kind: 'weapon', rarity: 'Rare', level: 12, effectId: 'market_crash' },
  { kind: 'shield', rarity: 'Rare', level: 30 },
  { kind: 'relic', rarity: 'Rare', level: 3 },
  { kind: 'weapon', rarity: 'Epic', level: 20 },
  { kind: 'classMod', rarity: 'Epic', level: 49 },
  { kind: 'weapon', rarity: 'Legendary', level: 10 },
  { kind: 'weapon', rarity: 'Legendary', level: 25, effectId: 'second_opinion' },
  { kind: 'shield', rarity: 'Legendary', level: 50 },
  { kind: 'weapon', rarity: 'Legendary', level: 60, effectId: 'market_crash' },
];

/** Server-row payload mirroring a case (what cc_store_chef_items stored). */
function payloadFor(spec: CaseSpec): Record<string, unknown> {
  switch (spec.kind) {
    case 'weapon':
      return {
        weaponType: 'Pistol',
        ...(spec.effectId ? { legendaryEffectId: spec.effectId } : {}),
        ...(spec.rollQuality !== undefined ? { rollQuality: spec.rollQuality } : {}),
      };
    case 'shield':
      return { hp: 90 };
    case 'ordnance':
      return { damage: 40, effect: 'Fragmentation' };
    case 'classMod':
      return { treeBonus: 'Gunslinger', nodeBoosts: {} };
    case 'relic':
      return {};
  }
}

/** Client GearItem mirror of the same case (what the inspect sheet holds). */
function clientItemFor(spec: CaseSpec, id: string): GearItem {
  const base = { id, name: 'Preview Fixture', rarity: spec.rarity, level: spec.level };
  switch (spec.kind) {
    case 'weapon':
      return {
        ...base, weaponType: 'Pistol', manufacturer: 'Redline',
        ...(spec.effectId ? { legendaryEffectId: spec.effectId } : {}),
        ...(spec.rollQuality !== undefined ? { rollQuality: spec.rollQuality } : {}),
      } as unknown as GearItem;
    case 'shield':
      return { ...base, hp: 90 } as unknown as GearItem;
    case 'ordnance':
      return { ...base, damage: 40, effect: 'Fragmentation' } as unknown as GearItem;
    case 'classMod':
      return { ...base, treeBonus: 'Gunslinger', nodeBoosts: {} } as unknown as GearItem;
    case 'relic':
      return { ...base, affixes: [] } as unknown as GearItem;
  }
}

const MATERIAL_BY_KIND: Record<CaseSpec['kind'], string> = {
  weapon: 'BallisticParts',
  shield: 'ReactiveComponents',
  ordnance: 'ReactiveComponents',
  classMod: 'TechFragments',
  relic: 'TechFragments',
};

interface SkillState {
  id: string;
  spends: Record<string, number>;
  boosts: { treeBonus?: string; nodeBoosts: Record<string, number> };
  /** Equipped class-mod row payload for the settlement store, if any. */
  modPayload: Record<string, unknown> | null;
  keystoneLive: boolean;
}

const STATES: SkillState[] = [
  { id: 'none', spends: {}, boosts: { nodeBoosts: {} }, modPayload: null, keystoneLive: false },
  { id: 'hoarder', spends: { scav_major_1: 1 }, boosts: { nodeBoosts: {} }, modPayload: null, keystoneLive: false },
  { id: 'keystone', spends: { scav_keystone: 1 }, boosts: { nodeBoosts: {} }, modPayload: null, keystoneLive: true },
  { id: 'both', spends: { scav_major_1: 1, scav_keystone: 1 }, boosts: { nodeBoosts: {} }, modPayload: null, keystoneLive: true },
  {
    id: 'modboost', spends: { scav_major_1: 1 },
    boosts: { treeBonus: 'Fixer', nodeBoosts: { scav_keystone: 1 } },
    modPayload: { treeBonus: 'Fixer', nodeBoosts: { scav_keystone: 1 } },
    keystoneLive: true,
  },
];

async function startRoute(seed: WriteSeed, rng: () => number) {
  const store = new InMemoryWriteStore(seed, {
    now: () => new Date('2026-11-02T12:00:00.000Z'),
    rng,
    uuid: () => uid(999999),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const srv = app.listen(0);
  await new Promise<void>((resolve) => srv.on('listening', resolve));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const token = issueAccessToken(SECRET, A, false);
  const post = async (itemId: string, nonce: string) => {
    const res = await fetch(`${base}/api/ops/recycle-item`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ nonce, item_id: itemId }),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const close = () => new Promise<void>((resolve) => srv.close(() => resolve()));
  return { store, post, close };
}

function profileOf(store: InMemoryWriteStore): ProfileRowData {
  const seed = (store as unknown as { seed: WriteSeed }).seed;
  return seed.profiles.find((p) => p.id === A) as ProfileRowData;
}

describe('salvage preview truth — projection equals route settlement', () => {
  for (const [stateIdx, state] of STATES.entries()) {
    const full = state.id === 'none' || state.id === 'both';
    const caseIdxs = full ? CASES.map((_, i) => i) : [0, 7, 8, 14];
    it(`state=${state.id}: every projected salvage settles to the unit`, async () => {
      const seed = emptyWriteSeed();
      seed.profiles = [profile({ id: A, skill_spends: state.spends })];
      if (state.modPayload) {
        seed.items.push(itemRow({
          id: uid(stateIdx * 1000 + 900), owner_user_id: A, kind: 'classMod',
          rarity: 'Rare', item_level: 15, payload: state.modPayload,
          runtime_state: 'equipped', equipped_slot: 'classMod',
        }));
      }
      for (const ci of caseIdxs) {
        const spec = CASES[ci];
        seed.items.push(itemRow({
          id: uid(stateIdx * 1000 + ci + 1), owner_user_id: A, kind: spec.kind,
          rarity: spec.rarity, item_level: spec.level, payload: payloadFor(spec),
        }));
      }
      // rng pinned high: the King of Scrap roll (chance ≤ 0.25) never
      // grants in the matrix, so bonus_material settles null and the
      // scrap/cores equality is exact. The grant itself is pinned by
      // the dedicated roll cases below.
      const { store, post, close } = await startRoute(seed, () => 0.99);
      try {
        const bonuses = computeSkillBonuses(state.spends, state.boosts);
        let scrapTotal = 0;
        let coresTotal = 0;
        for (const ci of caseIdxs) {
          const spec = CASES[ci];
          const itemId = uid(stateIdx * 1000 + ci + 1);
          const projected = projectSalvageYield(clientItemFor(spec, itemId), bonuses);
          // The projection never promises what the server doesn't pay:
          // no guaranteed materials, no essences, no Void Dust.
          expect(projected.scrapAlloy).toBe(0);
          expect(projected.ballisticParts).toBe(0);
          expect(projected.reactiveComponents).toBe(0);
          expect(projected.techFragments).toBe(0);
          expect(projected.voidDust).toBe(0);
          expect(projected.essences).toEqual({});
          // The King of Scrap note exists exactly when the keystone
          // chance is live on a Common, naming the kind's material.
          if (spec.rarity === 'Common' && state.keystoneLive) {
            expect(projected.bonusMaterialId).toBe(MATERIAL_BY_KIND[spec.kind]);
            expect(projected.bonusMaterialChance).toBe(0.25);
          } else {
            expect(projected.bonusMaterialId).toBeUndefined();
          }
          const res = await post(itemId, `nonce-${state.id}-${ci}-preview-truth`);
          expect(res.status).toBe(200);
          expect(res.json.scrap_award).toBe(projected.scrapValue);
          expect(res.json.cores_award ?? 0).toBe(projected.legendaryCores ?? 0);
          expect(res.json.bonus_material ?? null).toBeNull();
          scrapTotal += projected.scrapValue;
          coresTotal += projected.legendaryCores ?? 0;
        }
        const p = profileOf(store);
        expect(p.scrap).toBe(scrapTotal);
        expect(p.legendary_cores ?? 0).toBe(coresTotal);
      } finally {
        await close();
      }
    }, 60_000);
  }

  it('the King of Scrap roll, when it lands, pays exactly the projected kind', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: A, skill_spends: { scav_keystone: 1 } })];
    seed.items = [
      itemRow({ id: uid(1), owner_user_id: A, kind: 'weapon', rarity: 'Common', item_level: 5, payload: { weaponType: 'Pistol' } }),
      itemRow({ id: uid(2), owner_user_id: A, kind: 'relic', rarity: 'Common', item_level: 5, payload: {} }),
    ];
    // rng = 0: every material roll lands (0 < 0.25 chance).
    const { store, post, close } = await startRoute(seed, () => 0);
    try {
      const bonuses = computeSkillBonuses({ scav_keystone: 1 }, { nodeBoosts: {} });
      const weapon = projectSalvageYield(clientItemFor({ kind: 'weapon', rarity: 'Common', level: 5 }, uid(1)), bonuses);
      const res1 = await post(uid(1), 'nonce-grant-weapon-0001');
      expect(res1.status).toBe(200);
      expect(res1.json.bonus_material).toBe(weapon.bonusMaterialId);
      expect(res1.json.bonus_material).toBe('BallisticParts');
      const relic = projectSalvageYield(clientItemFor({ kind: 'relic', rarity: 'Common', level: 5 }, uid(2)), bonuses);
      const res2 = await post(uid(2), 'nonce-grant-relic-0002');
      expect(res2.json.bonus_material).toBe(relic.bonusMaterialId);
      expect(res2.json.bonus_material).toBe('TechFragments');
      const p = profileOf(store);
      expect((p.materials as Record<string, number>).BallisticParts).toBe(1);
      expect((p.materials as Record<string, number>).TechFragments).toBe(1);
    } finally {
      await close();
    }
  }, 60_000);

  it('hand-computed pins: the projection composes the shipped numbers', () => {
    // No bonuses: base table straight from salvageScrap.
    expect(projectSalvageYield(clientItemFor({ kind: 'weapon', rarity: 'Common', level: 1 }, 'x'), {}).scrapValue).toBe(15);
    expect(projectSalvageYield(clientItemFor({ kind: 'shield', rarity: 'Legendary', level: 50 }, 'x'), {}).legendaryCores).toBe(3);
    // Hoarder (+25%) × King of Scrap (×2 on low rarity) stack
    // multiplicatively on the base: L10 Common base 60 → 150.
    const both = computeSkillBonuses({ scav_major_1: 1, scav_keystone: 1 }, { nodeBoosts: {} });
    expect(projectSalvageYield(clientItemFor({ kind: 'weapon', rarity: 'Common', level: 10 }, 'x'), both).scrapValue).toBe(150);
    // Uncommon takes the King of Scrap multiplier too (base 90 ×
    // 1.25 × 2 = 225) but is NOT Common: no material note, ever.
    const uncommon = projectSalvageYield(clientItemFor({ kind: 'shield', rarity: 'Uncommon', level: 10 }, 'x'), both);
    expect(uncommon.scrapValue).toBe(225);
    expect(uncommon.bonusMaterialId).toBeUndefined();
    // Market Crash ×4 lands before skill bonuses: L12 Rare base 175
    // → 700 raw, ×1.25 Hoarder → 875.
    const hoarder = computeSkillBonuses({ scav_major_1: 1 }, { nodeBoosts: {} });
    expect(
      projectSalvageYield(clientItemFor({ kind: 'weapon', rarity: 'Rare', level: 12, effectId: 'market_crash' }, 'x'), hoarder).scrapValue,
    ).toBe(875);
  });
});
