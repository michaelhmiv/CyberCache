# Offline Settlement Architectural Repair Plan

> **For Hermes:** This is a phased architectural repair. Execute one phase at a time,
> verify fully, commit, then proceed to the next. Use the cybercache-dev skill for
> all conventions.

**Goal:** Make offline progression server-authoritative, reliable, idempotent,
and capped correctly, with a clear "While You Were Away" recap UI after login.

**Architecture:** A dedicated POST /api/settle-offline Chef route computes
server-authoritative rewards using DB timestamps (not client Date.now()), advances
last_claimed_tick by the full tick count, and returns a structured settlement summary.
The client calls this route after auth hydration and renders a durable recap UI.

**Tech Stack:** TypeScript · React 19 · Zustand 5 · Express (Chef) · Supabase · Vitest

---

## Root Cause Analysis

Five interacting bugs make offline progression feel broken:

1. **Client-side clock for rewards (loss of authority).** `activitySettlement.ts` computes elapsed time with `Date.now()` — the browser can be wrong by hours or manipulated.

2. **20-tick clamp for offline settlement (wrong cap).** `processRoamingClaim` in `chef.ts:229` clamps ALL claims to `Math.min(requestedTicks, 20)`. Foreground live claims should be capped, but offline settlement may need 2400+ ticks. Both paths share the same route and the same clamp.

3. **Tick counter advances by 1 not by settled count (state corruption).** `activitySettlement.ts:123` sets `settlementTick = player.lastClaimedTick + 1` regardless of how many ticks are being settled. If the DB has `last_claimed_tick = 100` and we settle 2400 ticks, the claim sends `tickCount: 101`, and the DB advances to 101 — losing 2399 ticks of progress. Future claims will overlap and potentially double-award.

4. **No idempotency for offline settlement (double-claim risk).** The offline settlement path has no idempotency key. If the AuthProvider fires settlement twice (common on React re-render cycles or Supabase auth refresh), rewards get processed twice.

5. **No durable recap UI (invisible success).** `cybercache:activity-settled` is dispatched but consumed by zero components. Even when settlement works, the player sees nothing.

---

## Phased Implementation Plan

### Phase 1: DB Schema & Snapshot Fix

**Objective:** Ensure the DB and repo agree on the snapshot contract, fix any
live DB drift, and add the canonical settlement timestamp field.

**Files:**
- Verify: `supabase/migrations/202606080011_profile_snapshot_helper.sql`
- Verify: `supabase/migrations/20260612150000_add_last_claimed_tick_to_snapshot.sql`
- Create: `supabase/migrations/202606120001_add_settlement_tracking.sql`

**Tasks:**

1. **Task 1.1: Verify migration state**
   - Check if `cc_profile_snapshot` includes `last_claimed_tick` on live Supabase
   - Run `npx supabase migration list` to see applied migrations
   - If 20260612150000 is NOT applied, apply it

2. **Task 1.2: Add canonical settlement fields**
   - Add `last_roaming_settled_at TIMESTAMPTZ` to `profiles` (or `active_actions.activity_payload`)
   - This is the server-authoritative timestamp of the last offline settlement
   - Used to compute elapsed time server-side (not client Date.now())
   - Prefer `active_actions.activity_payload.last_settled_at` for per-activity settlement tracking

3. **Task 1.3: Add offline settlement idempotency key column**
   - Add `last_settlement_nonce TEXT` to `profiles` (or `active_actions`)
   - Server generates a settlement nonce on each offline settlement call
   - Server checks nonce before processing to prevent double-claims

**Verification:**
- `npx supabase db push` succeeds
- `cc_profile_snapshot` returns `last_claimed_tick` when queried
- Migration guard script passes

---

### Phase 2: Server-Authoritative Offline Settlement Endpoint

**Objective:** Create `POST /api/settle-offline` that computes rewards
server-side, advances tick counter correctly, and is idempotent.

**Files:**
- Create: `src/server/routes/settleOffline.ts` (or extend `claim.ts`)
- Modify: `src/server/chef.ts` — add `processOfflineSettlement()` function
- Modify: `src/server/routes/claim.ts` — mount the new route

**Tasks:**

2.1. **Create `processOfflineSettlement` in chef.ts**
   - Signature: `function processOfflineSettlement(request: OfflineSettleRequest): OfflineSettleResult`
   - Does NOT clamp to 20 ticks — uses `offline_cap_hours` instead
   - Reads canonical timestamp from DB, not client
   - Advances `endTick = startTick + ticksSettled` not `+1`

2.2. **Create `POST /api/settle-offline` route**
   - Authenticate via bearer token
   - Read & lock user profile + active action
   - If active action is not roaming_loot → return no-op
   - Determine area from active_actions.target_id
   - Read last_roaming_settled_at (or fallback to active_actions.started_at)
   - Compute elapsed = NOW() - last_settled_at, capped by offline_cap_hours
   - Convert to ticks (3s cadence)
   - Process all ticks through Chef
   - Persist atomically
   - Return full settlement summary

2.3. **Add idempotency**
   - Client generates a settlement nonce (UUID) on login
   - Server checks `last_settlement_nonce` against request
   - If match → return cached result (no re-processing)
   - If different → process and store new nonce

2.4. **Correct tick semantics**
   - `last_claimed_tick` = highest tick fully settled
   - Offline advances: `last_claimed_tick += ticksSettled` (not +1)
   - Server uses `NOW()` for elapsed time, not client clock

**Verification:**
- `curl POST /api/settle-offline` returns structured summary
- Idempotency: second call returns same result, no double rewards
- Foreground claim route unaffected (still capped at 20)

---

### Phase 3: Fix Chef's 20-tick Clamp for All Paths

**Objective:** Separate foreground live claim from offline settlement.
Foreground stays at 20-tick clamp; offline settlement has its own uncapped path.

**Files:**
- Modify: `src/server/chef.ts` — `processRoamingClaim` → add `isOfflineSettlement` param
- Modify: `src/server/routes/claim.ts` — foreground claim stays capped
- Modify: `src/lib/chef/chefClient.ts` — add `settleOffline()` client method

**Tasks:**

3.1. **Refactor processRoamingClaim to accept cap override**
   - Add `maxTicks?: number` to `ClaimRequest` (or add `isOfflineSettlement` boolean)
   - Foreground: cap stays at 20
   - Offline: cap = infinity (bounded only by offline_cap_hours * 3600 / 3)

3.2. **Create `chefClient.settleOffline()`**
   - Calls `POST /api/settle-offline`
   - Passes jwt from Supabase session
   - Returns `OfflineSettleResult`

3.3. **Update foreground claim route**
   - Explicitly pass maxTicks=20 for `/api/claim`
   - Keep existing nonce/ordering guard

**Verification:**
- Foreground claim: 50 ticks requested → 20 processed (capped)
- Offline settlement: 2400 ticks requested → 2400 processed (not capped)
- Build passes

---

### Phase 4: Replace Client-Side activitySettlement.ts

**Objective:** Replace the browser-based offline reward calculation with a thin
API caller. The module becomes a server-delegating adapter, not an authoritative engine.

**Files:**
- Rewrite: `src/lib/activity/activitySettlement.ts`
- Modify: `src/auth/AuthProvider.tsx` — update call sites

**Tasks:**

4.1. **Rewrite activitySettlement.ts as thin API caller**
   - Remove all client-side elapsed time calculation
   - Remove all client-side reward computation
   - Remove all `syncVerifiedResult` calls (server handles state sync)
   - Instead: call `chefClient.settleOffline()`, return result
   - Rename module? Keep name but update JSDoc to clarify it's a thin adapter now

4.2. **Update AuthProvider login flow**
   - After profile sync + activity hydration + runtime snapshot restore
   - Call the new settlement endpoint
   - Save display snapshot ONLY after authoritative settlement is applied
   - Do NOT call `saveCurrentRuntimeStores` before settlement
   - Order: profile sync → items sync → activity hydrate → settlement → display snapshot save

4.3. **Remove localStorage settlement lock**
   - The lock was needed for client-side settlement; server-idempotency replaces it
   - Remove `SETTLEMENT_LOCK_KEY`, `acquireLock`, `releaseLock`

**Verification:**
- Login flow: settlement runs once, returns server results
- Refresh: settlement idempotent, no duplicate awards
- No client-side Date.now() used for reward computation

---

### Phase 5: Durable "While You Were Away" Recap UI

**Objective:** Show a persistent recap after offline settlement that cannot be
missed. The `cybercache:activity-settled` event is consumed by a dedicated component.

**Files:**
- Create: `src/components/activity/OfflineRecap.tsx`
- Create: `src/store/slices/offlineRecapSlice.ts` (or extend existing store)
- Modify: `src/screens/DashboardScreen.tsx` or `App.tsx` — mount the recap
- Modify: `src/auth/AuthProvider.tsx` — dispatch settlement result to store

**Tasks:**

5.1. **Create OfflineRecapSlice (Zustand store)**
   - State: `lastSettlement: OfflineSettleResult | null`, `dismissed: boolean`
   - Actions: `setSettlement(result)`, `dismiss()`
   - Persisted? No — display-only, cleared on next settlement

5.2. **Create OfflineRecap component**
   - Full-screen overlay or prominent card at top of Dashboard
   - Shows:
     - Area/action settled
     - Time away (human-readable: "2h 34m")
     - Cap reached (Y/N + "capped after X hours")
     - Ticks settled
     - XP gained (+ level-up if applicable)
     - Credits gained
     - Scrap gained
     - Cache fragments gained
     - Materials/essences gained (with ResourceIcon)
     - Gear drops with inspectable item names + rarities
   - Dismiss button ("Got it" / "Sweet")
   - Understated cyberpunk visual: dark translucent overlay, amber accents
   - Animate in (fade + slide)

5.3. **Wire settlement flow → recap UI**
   - AuthProvider: after `settleOffline()` returns → dispatch to `OfflineRecapSlice`
   - Remove `cybercache:activity-settled` CustomEvent dispatch (replaced by store)
   - Dashboard/Action screen: render `<OfflineRecap />` when settlement exists + not dismissed
   - Recap persists until dismissed (not transient toast)

5.4. **Handle edge cases**
   - Zero-reward settlement: show "No offline progress to collect" card (non-blocking)
   - No-op (wrong activity): don't show anything
   - Error: show compact error state with retry
   - Guest users: skip entirely

**Verification:**
- Start roaming, close app, wait, reopen → see recap
- Dismiss recap → gone, doesn't reappear on next render
- Zero rewards → non-blocking card, user can dismiss and play
- Visual: amber-on-dark cyberpunk aesthetic

---

### Phase 6: Preserve Display/Runtime Snapshot Boundaries

**Objective:** Reinforce that runtime snapshots are display-only. Audit all
snapshot consumers and add guards.

**Files:**
- Audit: `src/store/runtimeSupabaseSync.ts`
- Modify: `docs/ARCHITECTURE.md`
- Create: `scripts/guard-snapshot-boundaries.sh`

**Tasks:**

6.1. **Audit snapshot apply paths**
   - Confirm `applyRuntimeDisplaySnapshot` does NOT restore economy state
   - Confirm `restoreRuntimeStoresFromSupabase` runs AFTER profile sync
   - Add explicit check: snapshot hydration only covers loadout/boss/idle/market/survival/killCycle/presets

6.2. **Add guard rule to architecture guard script**
   - Forbidden pattern: `usePlayerStore.setState` or `useInventoryStore.setState` inside `applyRuntimeDisplaySnapshot`
   - Forbidden: importing `usePlayerStore`, `useInventoryStore`, `useSkillStore` into snapshot restore functions

6.3. **Document boundaries in ARCHITECTURE.md**
   - Add §9: Runtime Snapshot Boundaries — what snapshots are and aren't
   - Add §10: Offline Settlement Contract

**Verification:**
- Guard script passes
- `applyRuntimeDisplaySnapshot` only touches loadout/boss/idle/market/survival/killCycle/presets
- Economy state restored ONLY from profiles/item_instances/RPCs, never from snapshots

---

### Phase 7: Regression Tests

**Objective:** Add tests that fail under the current broken behavior and pass
after the repair.

**Files:**
- Create: `src/server/__tests__/offlineSettlement.test.ts`
- Create: `src/lib/activity/__tests__/activitySettlement.test.ts`
- Modify: `src/__tests__/snapshotContract.test.ts` (or create)
- Modify: `src/auth/__tests__/loginFlow.test.ts` (or create)

**Tasks:**

7.1. **Server-side tests (vitest)**
   - Test 1: `cc_profile_snapshot` includes `last_claimed_tick`
   - Test 2: Offline settlement for 2h at 2h cap → exactly 2400 ticks settled
   - Test 3: `last_claimed_tick` advances by ticksSettled, not by 1
   - Test 4: Running settlement twice → idempotent, no double awards
   - Test 5: Foreground claim capped to 20 ticks
   - Test 6: Offline settlement not capped to 20 (2400+ ticks allowed)
   - Test 7: No-op when active action is not roaming_loot
   - Test 8: Rewards correctly compute credits/XP/scrap from area rates

7.2. **Client-side tests (vitest + jsdom)**
   - Test 9: Login flow calls settlement after activity hydration, before display snapshot
   - Test 10: UI shows recap when settlement returns rewards
   - Test 11: UI handles zero-reward settlement without crashing
   - Test 12: Recap dismisses and doesn't return

7.3. **Snapshot contract test**
   - Test 13: `applyRuntimeDisplaySnapshot` doesn't call `usePlayerStore.setState`
   - Test 14: `applyRuntimeDisplaySnapshot` doesn't call `useInventoryStore.setState`
   - Test 15: Snapshot restore doesn't restore credits/xp/scrap/materials/cache keys/boss progress

**Verification:**
- `npm test` passes with all new tests
- Tests fail against current master (proving they catch the bugs)

---

### Phase 8: Reward Math Audit & Consistency

**Objective:** Ensure all reward math sources agree on tick duration, area rates,
drop chances, and modifiers.

**Files to audit:**
- `src/server/chef.ts` — authoritative engine
- `src/store/slices/idleTickerSlice.ts` — preview only (cosmetic)
- `src/lib/activity/activitySettlement.ts` — thin adapter (post-Phase 4)
- `src/constants/roamingAreas.ts` — area definitions
- `src/lib/chef/chefClient.ts` — client types
- `src/lib/supabase/verifiedOps.ts` — RPC fallback

**Tasks:**

8.1. **Cross-reference tick duration**
   - Chef: `TICK_MS = 3000` ✓
   - Client idleTicker: `TICK_MS = 3000` ✓
   - activitySettlement: `TICK_MS = 3000` ✓
   - roamingAreas: per-minute rates / 20 ticks-per-minute ✓

8.2. **Cross-reference area rates**
   - `idleCreditsPerMinute`, `idleScrapPerMinute`, `idleXpPerTick` in client/server
   - Chef divides per-minute rates by 20 for per-tick → `Math.round(creditsPerMinute / 20)`
   - Verify all 7 areas consistent

8.3. **Cross-reference drop chances**
   - Chef: `GEAR_THRESHOLD = 0.22`, `FRAGMENT_CHANCE = 0.03`, `MATERIAL_CHANCE = 0.08`
   - Client idleTicker preview: `DROP_CHANCE = 0.22`, `FRAGMENT_CHANCE = 0.03`, `MATERIAL_FIND_CHANCE = 0.08`
   - Verify cumulative threshold calculation matches (Phase 1a fix)

8.4. **Flag any inconsistencies, fix them**

**Verification:**
- Audit report in plan ledger
- All reward math sources agree on rates
- No hardcoded values in call sites that should read area definitions

---

### Phase 9: Logging & Diagnostics

**Objective:** Add structured logs around settlement for debugging.

**Files:**
- Modify: `src/server/routes/claim.ts` — settlement handler
- Modify: `src/server/chef.ts` — processOfflineSettlement

**Tasks:**

9.1. **Add structured settlement logs**
   - Log on start: `{userId, areaId, startedAt, lastSettledAt, elapsedMs, capped, ticksRequested}`
   - Log on complete: `{ticksSettled, startTick, endTick, xp, credits, scrap, fragments, gearCount, materialCount}`
   - Log on no-op: `{reason}`
   - Log on idempotent: `{nonce, cachedResult}`

9.2. **No secrets in logs**
   - Never log JWTs, tokens, or raw profile data
   - Redact sensitive fields

**Verification:**
- Server logs appear during settlement
- No secrets leaked in log output

---

### Phase 10: Documentation Update

**Objective:** Update ARCHITECTURE.md and related docs with the new contracts.

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/OFFLINE_SETTLEMENT.md`

**Tasks:**

10.1. **Update ARCHITECTURE.md**
    - Add §10: Offline Settlement Contract
      - Foreground live tick contract (≤20 ticks, 3s cadence, nonce guard)
      - Offline settlement contract (server-authoritative, capped by hours not ticks)
      - `last_claimed_tick` semantics (highest tick fully settled, NOT a request nonce)
      - Canonical settlement timestamp (`last_roaming_settled_at`)
      - Which route owns offline progress (`POST /api/settle-offline`)
      - How UI should consume offline recap (OfflineRecap component, OfflineRecapSlice)

10.2. **Create docs/OFFLINE_SETTLEMENT.md**
    - Full contract document
    - Forbidden patterns:
      - Client-side offline reward calculation (Date.now())
      - Screen-level reward loops
      - Restoring economy state from runtime snapshots
      - Using last_claimed_tick as a request nonce (+1 pattern)
    - Idempotency mechanism
    - Testing guidance

**Verification:**
- Docs read coherently
- Cross-references working
- No stale/contradictory information

---

## Definition of Done (all phases)

- [ ] `POST /api/settle-offline` exists and is server-authoritative
- [ ] Offline settlement is NOT capped to 20 ticks
- [ ] `last_claimed_tick` advances by the full tick count, not by 1
- [ ] Settlement is idempotent (double-call = no double rewards)
- [ ] `cc_profile_snapshot` returns `last_claimed_tick` on live DB
- [ ] `activitySettlement.ts` is a thin adapter, not an authoritative engine
- [ ] Login flow: settlement runs after hydration, before snapshot save
- [ ] `<OfflineRecap />` renders on Dashboard after successful settlement
- [ ] Recap is persistent until dismissed (not a transient toast)
- [ ] Runtime snapshots never restore economy state
- [ ] All 15 regression tests pass
- [ ] Architecture guard script passes
- [ ] Reward math consistent across all sources
- [ ] Structured logs for settlement
- [ ] ARCHITECTURE.md updated with new contracts
- [ ] No new localStorage progression dependency
- [ ] Build: `npm run build` passes
- [ ] Lint: `npm run lint` passes
- [ ] Tests: `npm test` passes
