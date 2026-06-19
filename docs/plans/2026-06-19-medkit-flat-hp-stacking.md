# MedKit Flat HP Stacking — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Each MedKit in inventory contributes 150 HP to a single flat buffer upfront (5 medkits = 750 HP). When the buffer drops past a 150 HP boundary, one MedKit is consumed. No replenishment loop.

**Architecture:** Remove the sequential replenishment mechanic from `processTick`. Compute total buffer as `inventoryCount × 150` at activation. Track consumption at claim-end via `consumed = initialCount − floor(remainingBuffer / 150)`. Client-side matches: set `medKitBuffer = count × 150` on roaming start.

**Tech Stack:** TypeScript · Zustand 5 · Express Chef · Supabase

---

## Problem Summary

| | Current (broken) | Desired |
|---|---|---|
| Buffer size | Always 150 HP regardless of inventory | `inventoryCount × 150` HP |
| Replenishment | Auto-replenish one-at-a-time in `processTick` | None — all stacked upfront |
| Consumption tracking | Per-tick in `processTick` | Computed at claim-end from total absorbed |
| Client death gate | Skips Chef claim when hunter dies locally | Always sends Chef claim |

---

## Files to Modify

| File | Change |
|---|---|
| `src/lib/consumables/roamingConsumableEngine.ts` | `activateLoadout`: stack buffer; `processTick`: remove MedKit replenish |
| `src/server/chef.ts` | Compute consumed medkits at claim-end |
| `src/screens/DashboardScreen.tsx` | Stack buffer from inventory count |
| `src/store/slices/idleTickerSlice.ts` | Remove death gate |
| `src/test/roamingConsumableEngine.test.ts` | Update MedKit tests |
| `src/test/idleTickerSurvival.test.ts` | Verify new behavior |

---

### Task 1: Stack MedKit buffer in `activateLoadout`

**Objective:** Buffer = inventory count × 150, not always 150.

**File:** `src/lib/consumables/roamingConsumableEngine.ts:343-346`

**Step 1: Change buffer initialization**

Replace:
```typescript
if (id === ConsumableType.MedKit) {
  activeSlot.remainingBuffer = MEDKIT_BUFFER_AMOUNT;
} else if (id === 'MedKitRefined') {
  activeSlot.remainingBuffer = MEDKIT_REFINED_BUFFER;
}
```

With:
```typescript
if (id === ConsumableType.MedKit) {
  activeSlot.remainingBuffer = (inventory[id] ?? 0) * MEDKIT_BUFFER_AMOUNT;
} else if (id === 'MedKitRefined') {
  activeSlot.remainingBuffer = (inventory[id] ?? 0) * MEDKIT_REFINED_BUFFER;
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero new errors.

---

### Task 2: Remove MedKit replenishment from `processTick`

**Objective:** No more per-tick buffer depletion check or auto-replenish. The Chef's damage absorption code (chef.ts:531-543) is the only place buffer decreases.

**File:** `src/lib/consumables/roamingConsumableEngine.ts:454-477`

**Step 1: Remove the MedKit buffer depletion block**

Remove lines 454–477 (the entire `// ── Check Med Kit buffer depletion ──` block).

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

---

### Task 3: Compute consumed medkits at claim-end in Chef

**Objective:** After the tick loop, compute how many medkits were consumed based on total buffer absorbed.

**File:** `src/server/chef.ts`

**Step 1: Track initial medkit inventory count**

After line 307 (`const consumableInventory = ...`), add:

```typescript
const initialMedKitCount = consumableInventory['MedKit'] ?? 0;
```

**Step 2: At claim-end, compute consumed medkits**

After the tick loop (before the `return` at line 555), add:

```typescript
// Compute MedKit consumption from buffer absorption
if (roamingState && initialMedKitCount > 0) {
  const medKitSlot = roamingState.slots.find(
    (s) => s.consumableId === 'MedKit' || s.consumableId === 'MedKitRefined'
  );
  if (medKitSlot) {
    const remainingFull = Math.floor(Math.max(0, medKitSlot.remainingBuffer) / 150);
    const consumed = initialMedKitCount - remainingFull;
    if (consumed > 0) {
      consumedConsumables['MedKit'] = (consumedConsumables['MedKit'] ?? 0) + consumed;
    }
  }
}
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

---

### Task 4: Stack client-side buffer from inventory count

**Objective:** Client sets `medKitBuffer = count × 150` instead of always 150.

**File:** `src/screens/DashboardScreen.tsx:297-300`

**Step 1: Change buffer computation**

Replace:
```typescript
if ((playerState.consumables['MedKit'] ?? 0) > 0) {
  const bufferAmount = computeMedKitBuffer('MedKit');
  survivalStore.setMedKitBuffer(bufferAmount);
}
```

With:
```typescript
const medKitCount = playerState.consumables['MedKit'] ?? 0;
if (medKitCount > 0) {
  survivalStore.setMedKitBuffer(medKitCount * computeMedKitBuffer('MedKit'));
}
```

**Step 2: Remove unused import**

If `computeMedKitBuffer` is now only used as a constant (150), verify the import is still needed. It's imported at line 34.

The `computeMedKitBuffer` returns 150 for MedKit, so `medKitCount * 150` is correct. Keep the import.

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Verify NanoSwarm is unchanged**

Lines 303-305 start NanoSwarm — confirm that's a separate consumable type and unaffected.

---

### Task 5: Remove death gate in idle ticker

**Objective:** Always send the Chef claim, even if the hunter died during local simulation. The Chef authoritatively determines death and processes medkit consumption.

**File:** `src/store/slices/idleTickerSlice.ts:746-751`

**Step 1: Remove the death gate**

Remove lines 746-751:
```typescript
// If the hunter died this tick, skip reward claims and the
// server reconciliation — the death is local-only for now
// (server-side HP persistence is a future PR).
if (useSurvivalStore.getState().isDead) {
  return;
}
```

**Step 2: Handle the survival state sent to Chef**

The Chef receives `currentHp` from the client. If HP is 0, the Chef sets `survDead = true` at line 304 and skips survival simulation. This is correct — the Chef still processes resources, kill cycle, and consumables.

At line 303: `const survHp = request.survival?.currentHp ?? 0;` — a dead hunter sends `currentHp: 0`, which works fine.

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

---

### Task 6: Update `getSurvivalState` and `buildActiveBuffs`

**Objective:** These helpers already read `slot.remainingBuffer` which will now reflect the stacked total. Verify they need no changes.

**File:** `src/lib/consumables/roamingConsumableEngine.ts`

**Step 1: Verify `getSurvivalState` (lines 633-662)**

```typescript
if (slot.consumableId === ConsumableType.MedKit || slot.consumableId === 'MedKitRefined') {
  medKitBuffer = slot.remainingBuffer;
}
```

This reads `remainingBuffer` which is now `count × 150`. No change needed.

**Step 2: Verify `buildActiveBuffs` (lines 701-702)**

```typescript
if (slot.consumableId === ConsumableType.MedKit || slot.consumableId === 'MedKitRefined') {
  buff.remainingBuffer = slot.remainingBuffer;
}
```

Same — reads the stacked value. No change needed.

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

---

### Task 7: Update tests

**File:** `src/test/roamingConsumableEngine.test.ts`

**Step 1: Update `activateLoadout` test — buffer now scales with inventory**

Test at line 87 currently asserts `remainingBuffer === MEDKIT_BUFFER_AMOUNT` (150) with inventory count 1. That test should still pass since 1 × 150 = 150.

ADD a new test:

```typescript
it('stacks Med Kit buffer from inventory count', () => {
  const loadout = {
    PreFight: ConsumableType.MedKit,
    MidFight: null,
    Emergency: null,
  };
  const inventory = { [ConsumableType.MedKit]: 5 };
  const state = activateLoadout(loadout, inventory, 0);
  const slot = state.slots[0];
  expect(slot.remainingBuffer).toBe(5 * MEDKIT_BUFFER_AMOUNT); // 750
});
```

**Step 2: Remove old replenishment tests**

The `processTick — Med Kit buffer` describe block (lines 163-198) tests the replenishment mechanic. Remove both tests:
- `'consumes the Med Kit when its buffer hits 0 and removes the slot if out of stock'`
- `'auto-replenishes the buffer when more stock remains'`

Replace with a test verifying buffer persists through processTick:

```typescript
describe('processTick — Med Kit buffer', () => {
  it('preserves remaining buffer through ticks (no replenishment)', () => {
    const inventory = { [ConsumableType.MedKit]: 5 };
    const state = activateLoadout(
      { ...EMPTY_LOADOUT, PreFight: ConsumableType.MedKit },
      inventory,
      0,
    );
    // Simulate 200 damage absorbed by Chef
    state.slots[0].remainingBuffer = 550; // 750 - 200

    const result = processTick(state, ctx({ tickIndex: 5, inventory }));

    // Buffer unchanged by processTick — Chef handles absorption
    expect(result.state.slots[0].remainingBuffer).toBe(550);
    // No consumption from processTick
    expect(result.consumed.filter((c) => c.id === ConsumableType.MedKit)).toHaveLength(0);
    // Slot survives
    expect(result.state.slots).toHaveLength(1);
  });
});
```

**Step 3: Run tests**

```bash
npx vitest run src/test/roamingConsumableEngine.test.ts
```

Expected: all tests pass (old replenishment tests removed, new stacking test added).

---

### Task 8: Add Chef-level consumption test

**File:** Create or update a test for the Chef's medkit consumption computation.

**Step 1: Create test**

Add to `src/test/roamingConsumableEngine.test.ts` or a new `src/test/chefMedKitConsumption.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('MedKit consumption tracking', () => {
  it('computes consumed medkits from buffer absorption', () => {
    // Simulate: initialCount=5, buffer=750, 200 absorbed → remaining=550
    const initialCount = 5;
    const remainingBuffer = 550;
    const remainingFull = Math.floor(Math.max(0, remainingBuffer) / 150);
    const consumed = initialCount - remainingFull;
    expect(remainingFull).toBe(3); // 3 full medkits left
    expect(consumed).toBe(2);      // 2 consumed
  });

  it('handles full depletion', () => {
    const initialCount = 5;
    const remainingBuffer = 0;
    const remainingFull = Math.floor(Math.max(0, remainingBuffer) / 150);
    expect(remainingFull).toBe(0);
    expect(initialCount - remainingFull).toBe(5);
  });

  it('handles partial depletion (less than one medkit)', () => {
    const initialCount = 5;
    const remainingBuffer = 700; // 50 damage absorbed
    const remainingFull = Math.floor(Math.max(0, remainingBuffer) / 150);
    expect(remainingFull).toBe(4);
    expect(initialCount - remainingFull).toBe(1); // 1 consumed for crossing the 150 boundary
  });
});
```

**Step 2: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

---

### Task 9: Verify survival ticker integration

**File:** `src/test/idleTickerSurvival.test.ts`

**Step 1: Check existing medkit consumption test**

The test at line 178 checks medkit consumption during survival:
```typescript
usePlayerStore.setState({ consumables: { MedKit: 10 } });
// ... tick ...
const medkitsBefore = usePlayerStore.getState().consumables.MedKit ?? 0;
// ... tick ...
const medkitsAfter = usePlayerStore.getState().consumables.MedKit ?? 0;
```

This test exercises the **client-side** consumption path (through Chef response syncing). With the death gate removed, the Chef claim now fires even when hunter dies, so medkits ARE consumed. This test should still pass if the Chef correctly computes consumption. If the test environment doesn't have a Chef running, it may fall back to the RPC path — verify.

**Step 2: Run survival tests**

```bash
npx vitest run src/test/idleTickerSurvival.test.ts
```

---

### Task 10: Full suite verification

**Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 2: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

---

## Consumption Tracking Formula

```
initialCount = consumableInventory['MedKit']
initialBuffer = initialCount × 150

After damage absorption:
  remainingBuffer = initialBuffer − totalDamageAbsorbed
  fullMedkitsLeft = floor(remainingBuffer / 150)
  consumed = initialCount − fullMedkitsLeft
```

| Damage absorbed | Buffer remaining | Full medkits left | Consumed |
|---|---|---|---|
| 0 | 750 | 5 | 0 |
| 149 | 601 | 4 | 1 |
| 150 | 600 | 4 | 1 |
| 200 | 550 | 3 | 2 |
| 450 | 300 | 2 | 3 |
| 600 | 150 | 1 | 4 |
| 749 | 1 | 0 | 5 |
| 750 | 0 | 0 | 5 |

---

## Commit

```bash
git add -A
git commit -m "fix: MedKit flat HP stacking — buffer scales with inventory count

- activateLoadout: remainingBuffer = inventoryCount × 150 (not fixed 150)
- processTick: remove MedKit replenishment loop
- Chef: compute consumed medkits from floor(remainingBuffer / 150)
- Dashboard: client buffer stacks from inventory count
- idleTickerSlice: remove death gate — always send Chef claim
- Tests: update for stacking behavior, remove replenishment tests"
```
