/**
 * Rush Ticket repair scope (boss-sim honesty wiring, item 5).
 *
 * The Workshop Rush Ticket's definition claims TWO scopes —
 * crafting and repair — but the repair enqueue hardcoded
 * rushReduction 0 and never looked at the ticket: its repair claim
 * was dead text. These tests pin the wired behavior, mirroring the
 * crafting path exactly:
 *
 *  - enqueue with useRushTicket escrows (burns) one ticket batch
 *    unit, stamps its quality/origin on the job, and snapshots the
 *    reduction from the ONE formula (rushTicketTimeReduction);
 *  - the snapshotted unit duration is the un-rushed duration ×
 *    (1 − reduction);
 *  - asking for a rush with no ticket fails with the crafting
 *    path's own error and creates no job;
 *  - cancelling a job that never started refunds the ticket at its
 *    escrowed quality (the generic cancel path reading the stamps);
 *  - shield-tech enqueue is deliberately NOT wired (the def claims
 *    crafting + repair only) — its job still stamps rush null/0.
 */
import { describe, expect, it } from 'vitest';
import { SKILL_NODES } from '../constants/skillTrees';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type SkillNodeData,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const P = '11111111-1111-4111-8111-111111111111';
const VEH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

let nonceN = 0;
const nonce = () => `rush-repair-nonce-${++nonceN}-abcdefgh`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'rusher', display_name: null, player_level: 30, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'rusher@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 2, workshop_tools: {}, legendary_cores: 10,
    ...over,
  } as ProfileRowData;
}

function skillNodeData(): SkillNodeData[] {
  return SKILL_NODES.map((n) => ({
    id: n.id, tree: n.tree, tier: n.tier, slot_index: n.index, name: n.name,
    description: n.description, node_type: n.type, max_points: n.maxPoints,
    per_point_cost: n.cost, effects: n.effects as SkillNodeData['effects'],
    requires: n.requires ?? [],
  }));
}

function makeStore(seedFn: (s: WriteSeed) => void) {
  const s = emptyWriteSeed();
  s.skillNodes = skillNodeData();
  seedFn(s);
  return new InMemoryWriteStore(s, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
}

function vehicleData(id: string, owner: string, condition: number): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'vehicle', static_item_id: null, item_level: 10,
    rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
    condition_current: condition, condition_max: 100,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: { vehicleClassId: 'dune_buggy', name: 'Dune Buggy', rarity: 'Rare', level: 10, affixes: [] },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 2000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function batchData(id: string, owner: string, type: string, quality: number, quantity: number) {
  return {
    id, owner_user_id: owner, consumable_type: type, quality_percent: quality,
    quantity, origin: 'crafted', creator_user_id: null, source_recipe_id: null, metadata: {},
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteSeed['consumableBatches'][number];
}

function seedWith(ticketQuality: number | null) {
  return (s: WriteSeed) => {
    s.profiles = [profile({
      id: P,
      consumables: ticketQuality === null
        ? { PatchKit: 5 }
        : { PatchKit: 5, WorkshopRushTicket: 1 },
    })];
    s.items = [vehicleData(VEH, P, 40)];
    s.consumableBatches = [
      batchData('kit-q1', P, 'PatchKit', 100, 5),
      ...(ticketQuality === null ? [] : [batchData('ticket-q1', P, 'WorkshopRushTicket', ticketQuality, 1)]),
    ];
  };
}

// Untrained PatchKit self-repair baseline (fixerSkillTree.test.ts):
// 30-point kit at the base 20 points/hour rate = 5,400,000 ms.
const BASE_MS = 5_400_000;

describe('Workshop Rush Ticket — repair scope', () => {
  it('without the toggle the job is unchanged: full duration, rush stamps null/0', async () => {
    const store = makeStore(seedWith(100));
    await store.enqueueRepairJob(P, nonce(), { itemId: VEH, kitType: 'PatchKit', units: 1 });
    const job = store.seed.craftJobs[0];
    expect(job.unit_duration_ms).toBe(BASE_MS);
    expect(job.rush_ticket_quality).toBeNull();
    expect(job.rush_ticket_origin).toBeNull();
    expect(job.snapshot.rushReduction).toBe(0);
    // The ticket was not touched.
    expect(store.seed.consumableBatches.find((b) => b.id === 'ticket-q1')?.quantity).toBe(1);
  });

  it('with the toggle a Q100 ticket cuts the unit duration by 20% and is escrowed + stamped', async () => {
    const store = makeStore(seedWith(100));
    await store.enqueueRepairJob(P, nonce(), { itemId: VEH, kitType: 'PatchKit', units: 1, useRushTicket: true });
    const job = store.seed.craftJobs[0];
    expect(job.snapshot.rushReduction).toBeCloseTo(0.2, 10);
    expect(job.unit_duration_ms).toBe(Math.round(BASE_MS * 0.8));
    expect(job.rush_ticket_quality).toBe(100);
    expect(job.rush_ticket_origin).toBe('crafted');
    // Escrowed: the batch unit is gone from inventory.
    expect(store.seed.consumableBatches.find((b) => b.id === 'ticket-q1')?.quantity ?? 0).toBe(0);
  });

  it('a Q150 ticket prices the reduction at 30% through the shared formula', async () => {
    const store = makeStore(seedWith(150));
    await store.enqueueRepairJob(P, nonce(), { itemId: VEH, kitType: 'PatchKit', units: 1, useRushTicket: true });
    const job = store.seed.craftJobs[0];
    expect(job.snapshot.rushReduction).toBeCloseTo(0.3, 10);
    expect(job.unit_duration_ms).toBe(Math.round(BASE_MS * 0.7));
    expect(job.rush_ticket_quality).toBe(150);
  });

  it('asking for a rush with no ticket fails with the crafting error and creates no job', async () => {
    const store = makeStore(seedWith(null));
    await expect(
      store.enqueueRepairJob(P, nonce(), { itemId: VEH, kitType: 'PatchKit', units: 1, useRushTicket: true }),
    ).rejects.toThrow(/No Workshop Rush Ticket available/);
    expect(store.seed.craftJobs).toHaveLength(0);
    // The kits were not escrowed by the failed enqueue.
    expect(store.seed.consumableBatches.find((b) => b.id === 'kit-q1')?.quantity).toBe(5);
  });

  it('cancelling an unstarted rushed repair job refunds the ticket at its escrowed quality', async () => {
    const store = makeStore(seedWith(150));
    const enqueued = await store.enqueueRepairJob(P, nonce(), { itemId: VEH, kitType: 'PatchKit', units: 1, useRushTicket: true });
    const jobId = (enqueued as { job: { id: string } }).job.id;
    const cancelled = await store.cancelCraftJob(P, nonce(), jobId);
    expect((cancelled as { rush_ticket_refunded?: boolean }).rush_ticket_refunded).toBe(true);
    const ticketBatches = store.seed.consumableBatches.filter((b) => b.consumable_type === 'WorkshopRushTicket');
    const total = ticketBatches.reduce((sum, b) => sum + b.quantity, 0);
    expect(total).toBe(1);
    expect(ticketBatches.some((b) => b.quality_percent === 150 && b.quantity === 1)).toBe(true);
  });
});
