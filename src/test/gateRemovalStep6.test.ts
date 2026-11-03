/**
 * Gate-removal step 6 (migration 0063) — the offline-cap re-carrier,
 * the LAST step of the no-level-gates program (audit G6):
 *
 *   - The offline earnings cap grew by PLAYER LEVEL (0015 tiers:
 *     L20/40/60/80 -> 4/6/8/12h over a 2h base; SQL twin
 *     cc_earned_offline_cap_hours in 0024). Step 6 retires the
 *     level carrier and moves the growth onto the Research Shop
 *     track (Logistics & Markets) — the faculty whose own text
 *     promises it "pays in buyback, offline hours, and thinner
 *     fees": Street Economics +2h, Supply Chains +4h, Syndicate
 *     Ledger +4h. The reachable earned range is preserved exactly
 *     (2h floor -> 12h ceiling, monotonic across the chain).
 *   - TS: src/content/offlineCap.ts derives the ladder from the
 *     Research catalog (OFFLINE_CAP_MILESTONES); every composition
 *     point (settle-offline route x3, craft/extraction internal
 *     away-caps, repair + shield-tech internal caps, Settings,
 *     StageStatsBand) reads researchCapHours, never level.
 *   - SQL (0063, drafted — the parent applies it live before
 *     merge): the research catalog restated with the grants,
 *     cc_research_offline_cap_bonus as the catalog sum, the new
 *     cc_earned_offline_cap_hours_for(uuid) = 2 + research bonus,
 *     the four internal settlers restated with ONLY the earned
 *     term swapped (diff-verified against 0038/0044), and
 *     cc_earned_offline_cap_hours(integer) dropped.
 *   - RIDER (economy audit section E, Q7): the SQL extraction
 *     start gate in cc_set_active_action still enforced
 *     roaming_areas.unlock_level against the player's level — a
 *     leftover of the pre-#316 area gates that the TS twin never
 *     carried. 0063 restates cc_set_active_action from 0053 with
 *     ONLY that check removed; the surviving gates (verified
 *     account, no standing death record, a real area, Deep Delve
 *     mastery 5) keep their byte-identical refusal text.
 *   - Behavior pins: a brand-new account's cap is 2h regardless of
 *     level; a level-100 account with NO Shop research still gets
 *     2h; a low-level account with the Shop track completed gets
 *     the full 12h (the route-level pins live in tuningBaseline
 *     item 5; the carrier + lazy-cap + rider pins live here).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_OFFLINE_CAP_HOURS,
  OFFLINE_CAP_MILESTONES,
  RESEARCH_OFFLINE_CAP_HOURS_TOTAL,
  earnedOfflineCapHours,
  effectiveOfflineCapHours,
  nextOfflineCapMilestone,
} from '@/content/offlineCap';
import { computeResearchBonuses } from '@/content/research';
import { extractionAwayCapMs } from '../server/writes/extractionEngine';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type Json } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const MIGRATION_0063 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0063_offline_cap_research_carrier.sql'),
  'utf8',
);

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** The migration with comment lines stripped — pins bind the executable SQL. */
const executable = MIGRATION_0063.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

function functionSegment(sql: string, fname: string): string {
  const start = sql.toLowerCase().indexOf(`function public.${fname}`);
  expect(start, fname).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const end = rest.search(/\$\$;|\$func\$;|\$function\$;/);
  expect(end, fname).toBeGreaterThan(0);
  return rest.slice(0, end);
}

// ─── 0063 textual pins ─────────────────────────────────────────

describe('migration 0063 — the offline cap is Research-carried', () => {
  it('restates the research catalog with the Logistics grants (+2/+4/+4), in both twins', () => {
    // cc_research_course + cc_research_catalog each carry the catalog.
    expect(executable.match(/"offlineCapBonus": 2/g)).toHaveLength(2);
    expect(executable.match(/"offlineCapBonus": 4/g)).toHaveLength(4);
    expect(executable).not.toContain('"offlineCapBonus": 1');
    expect(executable).toContain('function public.cc_research_course');
    expect(executable).toContain('function public.cc_research_catalog');
  });

  it('cc_research_offline_cap_bonus is the catalog sum, not the supply_chains case', () => {
    const seg = functionSegment(executable, 'cc_research_offline_cap_bonus');
    expect(seg).toContain("cc_research_bonus_number(p_player_id, 'offlineCapBonus')");
    expect(seg).not.toContain('case when exists');
    expect(seg).not.toContain('supply_chains');
  });

  it('defines the earned cap from the player, never the level — and drops the tier twin', () => {
    const seg = functionSegment(executable, 'cc_earned_offline_cap_hours_for');
    expect(seg).toContain('2::numeric + public.cc_research_offline_cap_bonus(p_player_id)');
    expect(executable).toContain('drop function if exists public.cc_earned_offline_cap_hours(integer)');
    // No executable line in the whole migration reads a level.
    expect(executable).not.toContain('player_level');
  });

  it('restates the four internal settlers on the new earned term', () => {
    for (const fname of [
      'cc_settle_craft_jobs',
      'cc_settle_repair_job',
      'cc_settle_extraction_time',
      'cc_settle_shieldtech_job',
    ]) {
      const seg = functionSegment(executable, fname);
      expect(seg, fname).toContain('cc_earned_offline_cap_hours_for(');
      expect(seg, fname).not.toContain('cc_earned_offline_cap_hours(');
    }
  });
});

describe('migration 0063 — rider: the extraction start gate loses its level check', () => {
  it('cc_set_active_action carries no area level gate', () => {
    const seg = functionSegment(executable, 'cc_set_active_action');
    expect(seg).not.toContain('unlock_level');
    expect(seg).not.toContain('Area locked');
    expect(executable).not.toContain('Area locked for this hunter level');
  });

  it('the surviving start gates keep their byte-identical refusals', () => {
    const seg = functionSegment(executable, 'cc_set_active_action');
    expect(seg).toContain("raise exception 'Verified account required'");
    expect(seg).toContain("raise exception 'Character is dead — resurrect before extracting'");
    expect(seg).toContain("raise exception 'Unknown extraction area'");
    expect(seg).toContain("raise exception 'Deep Delve requires Extraction mastery 5'");
    expect(seg).toContain("raise exception 'Unsupported extraction method'");
  });
});

// ─── TS carrier pins ───────────────────────────────────────────

describe('the TS offline-cap carrier after step 6', () => {
  it('the milestone ladder derives from the Logistics chain: 2 -> 4 -> 8 -> 12', () => {
    expect(BASE_OFFLINE_CAP_HOURS).toBe(2);
    expect(OFFLINE_CAP_MILESTONES).toEqual([
      { courseId: 'street_economics', courseName: 'Street Economics', grantHours: 2, capHours: 4 },
      { courseId: 'supply_chains', courseName: 'Supply Chains', grantHours: 4, capHours: 8 },
      { courseId: 'syndicate_ledger', courseName: 'Syndicate Ledger', grantHours: 4, capHours: 12 },
    ]);
    expect(RESEARCH_OFFLINE_CAP_HOURS_TOTAL).toBe(10);
    // Monotonic: every milestone raises the cap.
    for (let i = 1; i < OFFLINE_CAP_MILESTONES.length; i++) {
      expect(OFFLINE_CAP_MILESTONES[i].capHours).toBeGreaterThan(OFFLINE_CAP_MILESTONES[i - 1].capHours);
    }
  });

  it('research completions price the earned cap: none 2h, chain 12h, nothing else contributes', () => {
    expect(computeResearchBonuses([]).offlineCapBonus).toBe(0);
    expect(earnedOfflineCapHours(computeResearchBonuses([]).offlineCapBonus)).toBe(2);
    expect(computeResearchBonuses(['street_economics']).offlineCapBonus).toBe(2);
    expect(earnedOfflineCapHours(computeResearchBonuses(['street_economics']).offlineCapBonus)).toBe(4);
    expect(
      earnedOfflineCapHours(computeResearchBonuses(['street_economics', 'supply_chains']).offlineCapBonus),
    ).toBe(8);
    const chain = ['street_economics', 'supply_chains', 'syndicate_ledger'];
    expect(earnedOfflineCapHours(computeResearchBonuses(chain).offlineCapBonus)).toBe(12);
    // The other faculties grant no offline hours, even complete.
    const others = ['shop_fundamentals', 'production_systems', 'master_fabricator',
      'wrench_basics', 'powertrain_systems', 'master_mechanic',
      'ballistics_theory', 'shield_dynamics', 'void_theory'];
    expect(computeResearchBonuses(others).offlineCapBonus).toBe(0);
  });

  it('nextOfflineCapMilestone names the remedy course at each step', () => {
    expect(nextOfflineCapMilestone(0)?.courseId).toBe('street_economics');
    expect(nextOfflineCapMilestone(2)?.courseId).toBe('supply_chains');
    expect(nextOfflineCapMilestone(6)?.courseId).toBe('syndicate_ledger');
    expect(nextOfflineCapMilestone(10)).toBeNull();
  });

  it('the AFK law is untouched: min(earned + keystone, limiter, 24h)', () => {
    expect(effectiveOfflineCapHours({ researchCapHours: 10, bonusHours: 4 })).toBe(16);
    expect(effectiveOfflineCapHours({ researchCapHours: 10, bonusHours: 4, userCapHours: 6 })).toBe(6);
    expect(effectiveOfflineCapHours({ researchCapHours: 0, bonusHours: 0, userCapHours: 24 })).toBe(2);
    expect(effectiveOfflineCapHours({ researchCapHours: 10, bonusHours: 99 })).toBe(24);
  });

  it('the lazy extraction away-cap reads the same carrier', () => {
    expect(extractionAwayCapMs(0, null)).toBe(2 * 3_600_000);
    expect(extractionAwayCapMs(10, null)).toBe(12 * 3_600_000);
    expect(extractionAwayCapMs(10, 4)).toBe(4 * 3_600_000);
    // A limiter above the earned cap never raises it.
    expect(extractionAwayCapMs(0, 24)).toBe(2 * 3_600_000);
  });

  it('no composition point passes a level into the cap formula', () => {
    for (const rel of [
      'src/server/routes/settleOffline.ts',
      'src/server/writes/memory.ts',
      'src/server/writes/craftEngine.ts',
      'src/components/dashboard/StageStatsBand.tsx',
      'src/screens/SettingsScreen.tsx',
    ]) {
      const src = readSrc(rel);
      const windows = src.split('effectiveOfflineCapHours({').slice(1).map((tail) => tail.slice(0, 220));
      expect(windows.length, rel).toBeGreaterThan(0);
      for (const w of windows) {
        expect(w, rel).not.toContain('level:');
      }
    }
  });
});

// ─── Rider behavior pin (TS twin) ──────────────────────────────

const A = '11111111-1111-4111-8111-111111111111';
let nonceN = 0;
const nextNonce = () => `step6-nonce-${String(++nonceN).padStart(4, '0')}-x`;

function writeProfile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'digger', display_name: null, player_level: 1, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'digger@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

describe('rider: extraction starts in any area at any level (TS twin)', () => {
  it('a level-1 hunter starts extraction in HelixWorks Labyrinth (area ladder 25)', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [writeProfile({ id: A, player_level: 1 })];
    const store = new InMemoryWriteStore(seed, {
      now: () => new Date('2026-11-03T00:00:00.000Z'),
      rng: () => 0.5,
      uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    });
    const start = (area: string, payload: Json = { method: 'surface' }) =>
      store.setActiveAction(A, nextNonce(), {
        activity_kind: 'extraction', target_type: 'roaming_area', target_id: area,
        activity_payload: payload,
      });
    await expect(start('helixworks_labyrinth')).resolves.toBeDefined();
    expect(store.seed.extractionStates.find((s) => s.user_id === A)?.area_id).toBe('helixworks_labyrinth');
    // The surviving gates still refuse, with their own messages.
    await expect(start('not_a_real_area')).rejects.toThrow('Unknown extraction area');
    await expect(start('dustwaste_frontier', { method: 'deep' })).rejects.toThrow(
      'Deep Delve requires Extraction mastery 5',
    );
  });
});
