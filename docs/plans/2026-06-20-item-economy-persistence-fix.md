# Item Economy Persistence Fix — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Restore the entire item persistence pipeline — every weapon, shield, class mod, relic, and ordnance from Chef generation through to equippable state.

**Architecture:** Two root causes — a SQL INSERT missing a NOT NULL column (`supply_mode`), and a client store that merges instead of reconciling. The fix touches 4 layers: SQL migration, server routes, client inventory store, and client sync orchestration. Plus secondary fixes for visual confusion, test gaps, and the user's dead account state.

**Tech Stack:** Supabase (PostgreSQL RPCs), Express/TypeScript server routes, React 19 + Zustand stores, Vitest tests.

---

## Root Cause Summary

| Bug | Impact | Affected File |
|---|---|---|
| `cc_store_chef_items` omits NOT NULL `supply_mode` column | Every Chef-generated item (all 5 types) fails to persist to DB | `supabase/migrations/20260615100000_item_estimated_value.sql:114-132` |
| `receiveServerItems` merges instead of replacing | Phantom items accumulate in client inventory, never reconciled | `src/store/slices/inventorySlice.ts:101-106` |
| Claim routes swallow `cc_store_chef_items` errors | Errors logged but items returned to client anyway | `src/server/routes/claim.ts:142,207,463` |
| `settleActiveActivityRewards` re-introduces phantoms on login | Offline settlement runs after sync, re-merges phantom items | `src/lib/activity/activitySettlement.ts`, `src/store/slices/idleTickerSlice.ts:852-860` |
| `RunnerSvg` decorative arm lines look like weapons | False "armed" impression when loadout is empty | `src/components/dashboard/LiveTurfDiorama.tsx:163-165` |
| `BossSelectModal` reads inventory before equipped slots | DPS projection not labeled as preview, violates invariant | `src/components/fight/BossSelectModal.tsx:25-29` |
| `serverItemAdapter` patches missing weapon fields with defaults | Partial weapon payloads produce fake weapons downstream | `src/lib/supabase/serverItemAdapter.ts:42-78` |
| `loadoutPresetsSlice.loadPreset` swallows per-slot failures | Partial preset loads with no UI feedback | `src/store/slices/loadoutPresetsSlice.ts:116-120` |
| Runtime sync has no `beforeunload` flush | Display state lost on abrupt tab close (500ms debounce) | `src/store/runtimeSupabaseSync.ts` |

---

## Phase 1 — Critical: Fix Item Persistence

### Task 1: Fix `cc_store_chef_items` to include `supply_mode`

**Objective:** Make Chef-generated items actually persist to `item_instances`.

**Files:**
- Create: `supabase/migrations/20260621000001_fix_store_chef_items_supply_mode.sql`

**Implementation:**
Rewrite `cc_store_chef_items` to include `supply_mode = 'verified_action'` in the INSERT statement. Also include `kind` detection and `estimated_value` computation (matching the `20260615100000` version's improvements). Keep `service_role`-only permissions.

**Verification:**
- Call `cc_store_chef_items` with a test weapon payload on the live DB
- Verify the row exists in `item_instances` with `runtime_state='available'`
- Verify `supply_mode='verified_action'`

### Task 2: Fix `receiveServerItems` to reconcile instead of merge

**Objective:** Stop phantom items from accumulating in client inventory.

**Files:**
- Modify: `src/store/slices/inventorySlice.ts:101-106`
- Create: `src/test/inventoryReconcile.test.ts`

**Implementation:**
Change `receiveServerItems` from merge to replace: `set({ items })` instead of deduplicating and concatenating.

**Test:**
- `receiveServerItems([A, B])` then `receiveServerItems([C])` → items has only C
- `receiveServerItems([A, B])` then `receiveServerItems([])` → items is empty

**Verification:**
- `npx vitest run src/test/inventoryReconcile.test.ts` → PASS

---

## Phase 2 — High: Fix Error Swallowing & Re-introduction

### Task 3: Stop swallowing `cc_store_chef_items` errors in claim routes

**Objective:** When item persistence fails, the error should propagate to the client, not be silently logged.

**Files:**
- Modify: `src/server/routes/claim.ts` — 3 call sites (lines ~142, ~207, ~463)

**Implementation:**
At each `cc_store_chef_items` call site, if `storeError` is truthy, return a 500 response with the error detail. Do not continue to return items that weren't persisted.

**Verification:**
- `npm run build`
- `npx tsc --noEmit`

### Task 4: Fix Chef item re-introduction via `upsertItem`

**Objective:** After `receiveServerItems` is now a full replace, Chef item additions (roaming ticks, offline settlement) must use per-item `upsertItem` instead.

**Files:**
- Modify: `src/store/slices/idleTickerSlice.ts:852-860`
- Modify: `src/lib/activity/activitySettlement.ts` (the `receiveServerItems` call for offline settlement)

**Implementation:**
Replace `inv.receiveServerItems(chefResult.items)` with per-item `inv.upsertItem(item)`.

**Verification:**
- `npx vitest run src/test/loadoutConsistencySmoke.test.ts`
- `npm run build`

---

## Phase 3 — High: Fix Visual Confusion & Dead Account

### Task 5: Grant the user a new Starter Pistol

**Objective:** Restore the user's dead account to a playable state.

**Files:**
- Create: `supabase/migrations/20260621000002_regrant_starter_weapon.sql`

**Implementation:**
INSERT a new weapon for user `3cbc2896-63ec-4680-9036-14a462dc4539` using `cc_generate_weapon_payload(1, 'Common')`.

### Task 6: Add safety net for accounts with zero items

**Objective:** Auto-grant a starter weapon on login if the user has no items at all.

**Files:**
- Create: `supabase/migrations/20260621000003_starter_weapon_safety_net.sql` — `cc_ensure_starter_weapon` RPC
- Modify: `src/auth/AuthProvider.tsx` — call after `syncRuntimeItemsForUser`

**Implementation:**
RPC checks `item_instances` count for the user; if 0 available/equipped items, inserts a starter weapon. AuthProvider calls it after initial sync.

### Task 7: Replace `RunnerSvg` decorative arm lines

**Objective:** Stop the false "armed" impression when loadout is empty.

**Files:**
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx:163-165`

**Implementation:**
Replace the two horizontal "laser gun" arm paths with neutral hands-at-sides positions.

---

## Phase 4 — Medium: Hardening

### Task 8: Fix `BossSelectModal` inventory-first fallback

**Files:**
- Modify: `src/components/fight/BossSelectModal.tsx:25-29`
- Modify: `src/test/serverAuthoritativeLoadoutInvariant.test.ts` — add BossSelectModal coverage

**Implementation:**
Change weapon selection to equipped-first: `loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy')`. Use inventory best weapon only in a clearly-labeled preview context.

### Task 9: Fix `serverItemAdapter` to reject partial weapon payloads

**Files:**
- Modify: `src/lib/supabase/serverItemAdapter.ts:42-78`

**Implementation:**
If `weaponType` is present but required numeric fields (`baseDamage`, `attackSpeed`, `critChance`, `combatPower`) are missing, return `null` instead of patching with defaults.

### Task 10: Surface loadout preset failures

**Files:**
- Modify: `src/store/slices/loadoutPresetsSlice.ts:116-120`

**Implementation:**
Track failed slots in `Promise.allSettled`, store error message, expose via store. Don't set `activePresetId` if all slots failed.

### Task 11: Add `beforeunload` flush to runtime sync

**Files:**
- Modify: `src/store/runtimeSupabaseSync.ts`

**Implementation:**
Add `beforeunload` event listener that clears the debounce timer and calls `saveCurrentRuntimeStores()` synchronously.

---

## Phase 5 — Low: Test Coverage

### Task 12: Add BossSelectModal to invariant test

**Files:**
- Modify: `src/test/serverAuthoritativeLoadoutInvariant.test.ts`

**Implementation:**
Add a regex guard test that BossSelectModal does not use `inventory.getWeapons()` before `loadout.getWeapon()` in activity truth paths.

### Task 13: Add client/server slot compatibility parity test

**Files:**
- Create: `src/test/slotCompatParity.test.ts`

**Implementation:**
Test that `loadoutSlotCompat.ts` rules match `cc_item_accepts_slot` for all item type/slot combinations.

---

## Verification Checklist (After All Phases)

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

**Live verification:**
1. Open a cache → verify item appears in `item_instances`
2. Equip the item → verify it persists across refresh
3. Roam → verify drops appear in `item_instances`
4. Refresh page → verify inventory matches server (no phantom items)
5. Check `cc_store_chef_items` works on live DB

---

## Living Plan Ledger

### Phase 1 — Critical: Fix Item Persistence
- [x] Task 1: Fix `cc_store_chef_items` supply_mode — commit 9bd46cd
- [x] Task 2: Fix `receiveServerItems` reconciliation — commit 2ed92b0

### Phase 2 — High: Fix Error Swallowing & Re-introduction
- [x] Task 3: Propagate cc_store_chef_items errors — commit 10075b7
- [x] Task 4: Fix Chef item re-introduction via upsertItem — commit e45c73c

### Phase 3 — High: Fix Visual Confusion & Dead Account
- [x] Task 5: Grant starter weapon for dead account — commit 195e499
- [x] Task 6: Add safety net for zero-item accounts — commit 195e499
- [x] Task 7: Replace RunnerSvg decorative arm lines — commit 195e499

### Phase 4 — Medium: Hardening
- [x] Task 8: Fix BossSelectModal inventory-first fallback — commit 5688ddf
- [x] Task 9: Fix serverItemAdapter partial weapon rejection — commit 5688ddf
- [x] Task 10: Surface loadout preset failures — commit 5688ddf
- [x] Task 11: Add beforeunload flush to runtime sync — commit 5688ddf

### Phase 5 — Low: Test Coverage
- [x] Task 12: Add BossSelectModal to invariant test — commit 5eced42
- [x] Task 13: Add slot compatibility parity test — commit 5eced42

### Final Verification
- [x] `npm test` — 865 tests pass, 0 failures
- [x] `npx tsc --noEmit` — clean
- [x] `npm run lint` — clean (pre-existing warnings only)
- [x] `npm run build` — success (901ms)
- [ ] Live DB verification (pending migration deployment + PR merge)
