# Server-Verified Rewards — Full Remediation Plan

## Audit Summary (12 bugs found)

| # | Bug | Location | Severity |
|---|-----|----------|----------|
| 1 | Conditional probability chain — fragment/material rates lower than intended | Client `idleTickerSlice:80-131` + Server SQL `:167-187` | **High** |
| 2 | Double-counting credits/XP/scrap every tick | Client `idleTickerSlice:552-578` | **High** |
| 3 | DPS/tick math: `effectiveDps / 3` should be `effectiveDps * 3` | Client `damageContract.ts:61` | **High** |
| 4 | Server hardcodes `credits_per_tick = 1` for all areas, ignores client values | Server seeding in migration 055:231-238 | **Medium** |
| 5 | Idempotency exists but never fires — client sends fresh UUID every call | Client `verifiedOps.ts:8` vs Server SQL `:107-108` | **High** |
| 6 | Gear drops announced but never generated server-side — client mints items | Server SQL `:131-133` + all 5 generators | **Critical** |
| 7 | All 5 item generators use `Date.now() + Math.random()` as seed — non-deterministic | `weaponGenerator`, `shieldGenerator`, `classModGenerator`, `relicGenerator`, `ordnanceGenerator` | **Critical** |
| 8 | Mixed randomness — `buildAreaWeaponDropOptions` uses bare Math.random() for bias, then generator uses seeded RNG | `roamingAreas.ts:314-317` | **Medium** |
| 9 | `pickWeightedValue` and `pickArrayValue` use bare `Math.random()` | `roamingAreas.ts:284,296` | **Medium** |
| 10 | Boss simulator — all outcomes client-side, unseeded Math.random() | `bossSimulator.ts:668-704` | **Medium** |
| 11 | Activity settlement has same conditional probability bug | `activitySettlement.ts:97-101` | **Medium** |
| 12 | Server RNG uses incompatible PostgreSQL md5/bit-casting; client uses Mulberry32 | Different architectures, can't produce same results | **Medium** |

---

## Phase 1 — Immediate Bug Fixes (client-side, low risk)

These fix active runtime bugs without changing architecture. Can ship immediately.

### 1a. Fix conditional probability

**Files:** `idleTickerSlice.ts`, `activitySettlement.ts`

Replace the `if/else if/else` chain with a single cumulative roll:

```typescript
const DROP_CHANCE = 0.22;
const FRAGMENT_CHANCE = 0.03;
const MATERIAL_FIND_CHANCE = 0.08;

const roll = Math.random();
if (roll < DROP_CHANCE) {
  // gear drop
} else if (roll < DROP_CHANCE + FRAGMENT_CHANCE) {
  // fragment
} else if (roll < DROP_CHANCE + FRAGMENT_CHANCE + MATERIAL_FIND_CHANCE) {
  // material
} else {
  // kill
}
```

This makes the actual rates match the intended 22% / 3% / 8% / 67%.

**Server mirror:** Same fix in the PostgreSQL RPC `cc_claim_roaming_rewards` — derive a single roll slice from the seed and test cumulative thresholds.

### 1b. Remove double-counting

**File:** `idleTickerSlice.ts`

`applyServerRewards` currently calls `syncRuntimeProfile` (sets canonical server values) then adds the deltas again:

```typescript
// BEFORE (broken):
const applyServerRewards = (payload) => {
  syncVerifiedResult(payload);          // sets credits to server canonical
  player.addCredits(credits_awarded);   // adds same delta again = double
  player.addScrap(scrap_awarded);
  player.addXP(xp_awarded);
  // ... materials, essences, fragments
};

// AFTER (fixed):
const applyServerRewards = (payload) => {
  if (!payload) return;
  syncVerifiedResult(payload);          // canonical profile — sole mutation path
  // credits_awarded, xp_awarded, etc. are now feed-display-only.
  // No addCredits/addXP/addScrap/addMaterial/addEssence calls.
};
```

Also strip store mutations from `awardLocal` — rename to `pushPreviewEvents` and only push to tick feed:

```typescript
const pushPreviewEvents = (events: TickEvent[]) => {
  if (events.length === 0) return;
  useTickFeedStore.getState().push(events);
  // No addCredits, addItem, addXP mutations.
};
```

### 1c. Fix DPS/tick math

**File:** `damageContract.ts:61`

```typescript
// BEFORE: divides DPS by tick seconds (wrong direction)
const base = (weapon.effectiveDps / 3) * variance * defenseMitigation;

// AFTER: multiplies DPS by tick seconds (3s of damage per 3s tick)
const TICK_SECONDS = 3;
const base = weapon.effectiveDps * TICK_SECONDS * variance * defenseMitigation;
```

### 1d. Fix server-side credit/scrap per tick

**Migration:** Update the `roaming_areas` table seed data to use actual area rates from `constants/roamingAreas.ts` instead of hardcoded `1`.

**Verification gate:** After Phase 1, `npm test && npm run build && bash scripts/guard-architecture.sh` must all pass.

---

## Phase 2 — Deterministic Item Generation (client-side)

This makes every item reproducible given `(player_id, area_id, tick_count)`. The server will later use the same formula.

### 2a. Create shared deterministic RNG

**New file:** `src/lib/rng/tickRng.ts`

```typescript
import { createRNG, hashString } from '@/lib/utils/rng';

// Mulberry32 already exists in rng.ts. Add a factory keyed on tick identity.
export function createTickRng(playerId: string, areaId: string, tickCount: number) {
  const seed = hashString(`${playerId}:${areaId}:${tickCount}`);
  return createRNG(seed);
}
```

### 2b. Thread RNG through all item generators

Change every generator signature to accept an optional `rng` parameter. When provided, use it instead of `Date.now() + Math.random()` for the seed.

| Generator | Change |
|-----------|--------|
| `generateWeapon(opts, rng?)` | If rng provided, use it as seed source instead of `Date.now()+Math.random()` |
| `generateShield(level, rng?)` | Same |
| `generateClassMod(level, rng?)` | Same |
| `generateRelic(level, rng?)` | Same |
| `generateOrdnance(level, rng?)` | Same |

When `rng` is provided, the generator uses it directly. When not provided (legacy callers like cache opening), fall back to the old non-deterministic seed.

### 2c. Thread RNG through pickers

**File:** `roamingAreas.ts`

Add `rng?: () => number` parameters to:
- `pickWeightedValue(weights, rng?)` — use `rng()` instead of `Math.random()` when provided
- `pickArrayValue(values, rng?)` — same
- `rollAreaDropKind(area, rng?)` — passes rng to pickWeightedValue
- `buildAreaWeaponDropOptions(area, level, rng?)` — uses rng for manufacturer/type/element bias decisions
- `rollAreaMaterialFind(area, rng?)` — uses rng for array pick

### 2d. Unify ticker roll path

**File:** `idleTickerSlice.ts`

`rollClientEvents` now accepts an `rng` and passes it through the entire chain:
```
rollClientEvents(areaId, ticks, rng)
  → rollAreaDropKind(area, rng)
  → buildAreaWeaponDropOptions(area, level, rng)
  → inventory.generateAndAdd(opts, rng)  // or generateAndAddShield(level, rng), etc.
  → rollAreaMaterialFind(area, rng)
```

Every sub-roll consumes from the same `rng` stream. The weapon is fully deterministic.

**Verification gate:** Add a test that generates the same weapon twice from the same (player, area, tick) tuple. The weapons must be byte-identical.

---

## Phase 3 — Server Generates Items (Supabase migration)

### 3a. Port Mulberry32 to PL/pgSQL

**New migration:** `20260610_01_tick_rng.sql`

Implement `public.cc_tick_rng(player_id uuid, area_id text, tick_count bigint)` returning a set of deterministic float8 values using the same Mulberry32 algorithm as the client.

### 3b. Server-side item generation

Extend `cc_claim_roaming_rewards` to generate the actual item when `gear_roll < 0.22`:

- Call `cc_tick_rng` with the same `(actor, area_id, tick_count)` tuple
- Generate the weapon/shield/classMod/relic/ordnance server-side using the same stat formulas as the client
- Return the full item JSON in the response under `rewards.gear_drops`
- Replace the `gear_announced: [{kind: 'pending'}]` placeholder

### 3c. Client-side: trust server items

**File:** `idleTickerSlice.ts`

When the server response includes `rewards.gear_drops`, the client adds those items to inventory via `syncVerifiedResult`. The client's local preview gear is discarded (replaced by server gear). Since Phase 2 made them deterministic, they'll be identical — but the server's copy is authoritative.

---

## Phase 4 — Tick-Count Nonce & Replay Protection

### 4a. Track tick count on client

**File:** `idleTickerSlice.ts`

Add a `totalTickCount` field to the ticker state, incremented each tick. Pass `tick_count` to the server RPC instead of a random UUID:

```typescript
// BEFORE:
const result = await verifiedOps.claimRoamingRewards({ ticks, areaId });
// Internally generates: nonce = requestId('roam:areaId') — fresh UUID

// AFTER:
const result = await verifiedOps.claimRoamingRewards({ 
  ticks, 
  areaId,
  tickCount: get().totalTickCount  // monotonically increasing
});
```

### 4b. Server-side: nonce → tick_count

**Migration:** Update `cc_claim_roaming_rewards` to accept `tick_count bigint` instead of (or in addition to) `nonce text`. Use `(actor, tick_count)` as the idempotency key.

- If `tick_count <= last_claimed_tick` for this player → return cached result
- Otherwise → process, store, return

Also add `last_claimed_tick` column to `profiles` table.

### 4c. Remove UUID nonce entirely

Once tick_count is the idempotency key, the `requestId()` wrapper is unnecessary. The client just sends `tick_count`.

---

## Phase 5 — Single Mutation Path

### 5a. Tick becomes pure server polling

The 3-second interval:
1. Increments `totalTickCount`
2. Computes deterministic preview events → pushes to feed (cosmetic animation only)
3. Calls server RPC with `tick_count`
4. Server returns canonical profile state + feed events + items
5. `syncRuntimeProfile` replaces ALL local state with server state
6. Feed events are replaced with server's feed events

No client-side store mutations happen in steps 2-3. All state flows from `syncRuntimeProfile`.

### 5b. Remove redundant local stores

After Phase 5a, `awardLocal`/`pushPreviewEvents` no longer mutates anything but the feed. The only mutation paths are:
- `syncRuntimeProfile` — player stats, inventory
- `syncVerifiedResult` — items, equipment
- Supabase snapshot debounced save — persistence

---

## Phase 6 — Boss & Settlement Fixes

### 6a. Boss sim verification

Move boss outcome determination to a Supabase RPC. The client sends the fight parameters; the server rolls the outcome, generates loot, and returns the result. Client preview is cosmetic.

### 6b. Fix activity settlement

Apply the same cumulative-probability fix from Phase 1a to `activitySettlement.ts`. Also add `rng?` threading for deterministic offline catch-up.

### 6c. Fix server area economy rates

Update the `roaming_areas` table seed data with actual per-area `credits_per_tick`, `scrap_per_tick`, and `xp_per_tick` values matching `constants/roamingAreas.ts`.

---

## Implementation Order

| Phase | What | Risk | Client Work | Server Work | Prerequisite |
|-------|------|------|-------------|-------------|--------------|
| **1a** | Fix conditional probability | Low | 2 files | 1 SQL function | None |
| **1b** | Remove double-counting | Low | 1 file | None | None |
| **1c** | Fix DPS/tick math | Low | 1 file | None | None |
| **1d** | Fix server area rates | Low | None | 1 migration | None |
| **2a-c** | Thread RNG through generators | Medium | 7 files | None | None |
| **2d** | Unify ticker roll path | Medium | 1 file | None | 2a-c |
| **3a** | Port Mulberry32 to SQL | Medium | None | 1 migration | 2a |
| **3b** | Server-side item generation | High | None | 1 migration | 3a |
| **3c** | Client trusts server items | Medium | 1 file | None | 3b |
| **4a-b** | Tick-count nonce | Medium | 2 files | 1 migration | None |
| **4c** | Remove UUID nonce | Low | 1 file | None | 4a-b |
| **5a** | Single mutation path | Medium | 1 file | None | 3c, 4a |
| **5b** | Remove redundant stores | Low | 1 file | None | 5a |
| **6a** | Boss sim verification | High | 2 files | 1 migration | 3a |
| **6b** | Fix activity settlement | Low | 1 file | None | 1a |
| **6c** | Fix server area rates | Low | None | 1 migration | None |

**Recommended batches:**

- **Batch 1 (now):** 1a + 1b + 1c + 1d — fixes all active runtime bugs
- **Batch 2:** 2a-d + 3a — deterministic client generation, server RNG port
- **Batch 3:** 3b-c + 4a-c — server generates items, tick-count nonce, replay protection
- **Batch 4:** 5a-b — single mutation path, clean architecture
- **Batch 5:** 6a-c — boss/settlement parity

---

## What Does NOT Change

- 3-second tick interval (atomic batch unit for idle genre)
- DPS abstraction (fire rate folded into DPS multiplier, no per-shot simulation)
- Zustand stores (remain as state containers, just stop being mutation sources)
- Tick feed UI (event-driven animation, still sourced from server response)
- Cache opening / chest system (separate from roaming — not in scope for this pass)

---

## Migration & Rollback Notes

- Phase 1b will cause a one-time visible "drop" in player totals as the double-counting inflation is removed. The Supabase canonical values are correct; the UI was showing 2× inflated numbers.
- Phase 4 adds `last_claimed_tick` column — backfill to 0 for existing players.
- Phase 3 server-side item generation requires the Mulberry32 port to produce identical results to the TypeScript version. Add integration tests comparing SQL output to TS output for 100+ seed values.
- All server migrations are additive (new functions, new columns) — no destructive changes. Rollback = deploy previous client build.
