# Server-Authoritative Architecture Refactor Plan

## The Core Problem

CyberCache has **two simulations running the same game**:

1. **Client sim** (`idleTickerSlice.ts`): `applySurvivalTick`, `applyKillCycleTick`, `applyBossFightTick`, `rollPreviewEvents` — all write directly to the authoritative Zustand stores (survival, killCycle, boss, player, inventory).

2. **Server sim** (`chef.ts`): `processRoamingClaim` — computes the exact same kill cycle, survival damage, item drops, and rewards server-side. Returns authoritative state.

The client sim runs first (for smooth UX during the 3s tick interval), then the server response overwrites it via `applyServerRewards`. But between the local sim and the server response, the UI is showing locally-computed state. And if the server call fails, the response omits fields, or a new code path skips the reconcile — the local state becomes **phantom truth** that persists indefinitely.

The patches we've shipped (PR #159, #160) fixed the worst leaks. But the dam is still the wrong shape.

## The Right Architecture

```
┌──────────────────────────────────────────────────────┐
│                   AUTHORITATIVE STORES              │
│  (ONLY written by server responses)                  │
│                                                      │
│  playerSlice      → credits, XP, scrap, materials    │
│  inventorySlice   → items, loadout slots             │
│  survivalSlice    → currentHp, shieldHp, isDead      │
│  killCycleSlice   → target, kills, HP               │
│  bossSlice        → defeatedBossIds, pity            │
│  combatStatsSlice → kills, deaths, playtime          │
│  skillSlice       → spent points                     │
│  loadoutSlice     → equipped slots                   │
│  activeBuffsSlice → active buffs                     │
└──────────────────┬───────────────────────────────────┘
                   │ syncVerifiedResult / applyServerRewards
                   │ (ONLY entry point that writes these stores)
                   ▲
┌──────────────────┴───────────────────────────────────┐
│                  SERVER RESPONSES                    │
│  /api/claim → Chef processRoamingClaim result        │
│  cc_battle_result → boss fight result                │
│  cc_equip_item, cc_train_skill, etc. → verifiedOps   │
│  /api/settle-offline → offline settlement            │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                   PREVIEW STORES                     │
│  (ONLY written by the local ticker sim)              │
│  (ALWAYS reset when a server response arrives)       │
│                                                      │
│  previewSurvival  → currentHp bar, shield bar         │
│  previewKillCycle  → enemy HP bar, target display     │
│  previewBoss       → boss HP bar during fight          │
│  tickFeed          → cosmetic damage/loot events      │
│                                                      │
│  UI RULE: if a preview field exists, show it (smooth  │
│  visual). If it's stale (server hasn't responded in    │
│  a while), fall through to authoritative value.       │
└──────────────────┬───────────────────────────────────┘
                   │ applySurvivalTick / applyKillCycleTick
                   │ applyBossFightTick / rollPreviewEvents
                   ▲
┌──────────────────┴───────────────────────────────────┐
│                  LOCAL TICKER SIM                     │
│  (runs every 3s for visual smoothness)               │
│  Writes ONLY to preview stores. NEVER touches          │
│  authoritative stores.                                │
└──────────────────────────────────────────────────────┘
```

## What Changes

### Phase 1: Create Preview Stores

Create new Zustand stores for transient display state:

**`src/store/slices/previewSlice.ts`** — a single store with:
- `previewSurvival`: `{ currentHp, shieldHp, isDead, deathLog }` — cosmetic HP/shield bars
- `previewKillCycle`: `{ currentTargetId, currentTargetHp, currentTargetHpMax }` — enemy HP bar
- `previewBoss`: `{ activeBossHp, activeBossMaxHp, activeStatus, activeMedkitsConsumed }` — boss fight HP bar

These stores have a single method: `setScenery(patch)` and `reset()`.

### Phase 2: Reroute Local Sim to Preview Stores

Change `applySurvivalTick`, `applyKillCycleTick`, `applyBossFightTick` to write to preview stores instead of the authoritative stores:

**`applySurvivalTick`** — currently writes:
- `useSurvivalStore.getState().refillShield(-amount)` → `previewSurvival.setScenery({ shieldHp: newShieldHp })`
- `useSurvivalStore.getState().applyDamage(damage)` → `previewSurvival.setScenery({ currentHp: newHp })`
- `useSurvivalStore.getState().die(...)` → `previewSurvival.setScenery({ isDead: true })`
- `player.removeConsumable('MedKit', n)` → REMOVE this call (server handles consumable consumption)

**`applyKillCycleTick`** — currently writes:
- `useKillCycleStore.getState().spawnTarget(monster)` → `previewKillCycle.setScenery({ currentTargetId, currentTargetHp, currentTargetHpMax })`
- `useKillCycleStore.getState().applyPlayerDamage(damage)` → `previewKillCycle.setScenery({ currentTargetHp: newHp })`
- `useKillCycleStore.getState().killCurrentTarget()` → `previewKillCycle.setScenery({ currentTargetId: null })`

**`applyBossFightTick`** — currently writes:
- `bossStore.applyLiveTick(...)` → `previewBoss.setScenery({ activeBossHp, activeMedkitsConsumed, activeDamageDealt })`
- `survival.applyDamage/heal(...)` → `previewSurvival.setScenery({ currentHp: newHp })`
- `player.removeConsumable('MedKit', n)` → REMOVE this call
- `bossStore.endLiveFight(victory/defeat)` → `previewBoss.setScenery({ activeStatus })`
- `survival.die(...)` → `previewSurvival.setScenery({ isDead: true })`

**`rollPreviewEvents`** — already writes only to `tickFeedStore` (cosmetic). No change needed.

### Phase 3: Reset Preview on Server Response

In `applyServerRewards`, after `syncVerifiedResult` replaces authoritative state:

```
// After server state is applied, reset preview stores so the
// next render shows authoritative values, not stale local sim.
usePreviewStore.getState().reset();
```

The preview stores will be empty between server responses, and the UI will fall through to the authoritative values. When the next local tick runs, it will populate preview state again for smoothness.

### Phase 4: UI Component Changes

Components that show HP, shield, enemy target, boss HP, etc. need to read from preview stores first (fall through to authoritative):

```tsx
// Before:
const survival = useSurvivalStore();
const hp = survival.currentHp;

// After:
const previewHp = usePreviewStore(s => s.previewSurvival.currentHp);
const authHp = useSurvivalStore(s => s.currentHp);
const hp = previewHp ?? authHp;  // preview if available, else authoritative
```

This is a rub: every display component needs a "prefer preview, fall through to authoritative" pattern. To keep it clean, create selector hooks:

```tsx
// src/store/selectors/scenerySelectors.ts
export function useDisplayHp(): number {
  const preview = usePreviewStore(s => s.previewSurvival.currentHp);
  const auth = useSurvivalStore(s => s.currentHp);
  return preview ?? auth;
}
```

### Phase 5: Remove Direct Writes from Ticker

Audit all store method calls in `idleTickerSlice.ts` and ensure NONE of them write to authoritative stores:

```
// These calls must be REMOVED from the ticker:
useSurvivalStore.getState().refillShield()      ← write to previewSurvival
useSurvivalStore.getState().applyDamage()       ← write to previewSurvival
useSurvivalStore.getState().heal()               ← write to previewSurvival
useSurvivalStore.getState().die()                ← write to previewSurvival
useKillCycleStore.getState().spawnTarget()       ← write to previewKillCycle
useKillCycleStore.getState().applyPlayerDamage()  ← write to previewKillCycle
useKillCycleStore.getState().killCurrentTarget() ← write to previewKillCycle
useKillCycleStore.getState().clearTarget()       ← write to previewKillCycle
bossStore.applyLiveTick()                        ← write to previewBoss
bossStore.endLiveFight()                         ← write to previewBoss
bossStore.clearLiveFight()                       ← write to previewBoss
player.removeConsumable('MedKit')                ← REMOVE (server handles)
player.removeConsumable('ShieldCell')             ← REMOVE (server handles)
useCombatStatsStore.getState().recordDeath()     ← REMOVE (already fixed)
useCombatStatsStore.getState().recordKill()      ← keep (Chef-confirmed kills)
player.addCredits/addXP/addScrap()                ← REMOVE (server handles)
```

### Phase 6: Remove `player_runtime_snapshots` Echo

The snapshot system (client echoes state to DB, reads it back) becomes unnecessary for stores that are server-authoritative. Keep it only for true display-only preferences (auto-salvage settings, selected area, market filters, loadout presets).

Remove from snapshot:
- `survival` (server-authoritative via Chef response)
- `killCycle` (server-authoritative via Chef response)
- `boss.currentBossId/defeatedBossIds/pityCounters` (server-authoritative via boss_state)

Keep in snapshot:
- `idle.autoSalvage*` (client preference, no server counterpart)
- `market.filters/watchlist` (client UI state)
- `loadoutPresets` (client-only convenience)
- `boss.attemptHistory` (display record)
- `boss.preparedConsumables/selectedRisk` (client staging before fight)

### Phase 7: Remove `playerSlice._pending` Ledger

The `_pending` optimistic delta system (addCredits/addXP tracking deltas that get folded into server sync) is the last remaining "local truth merged with server truth" pattern. With preview stores handling display values, we don't need it.

Player resources (credits, XP, scrap, materials, essences) will ONLY be updated by `syncRuntimeProfile` from server responses. The client never optimistically adds resources — it waits for the Chef to confirm.

For UX: the tick feed events show "+50 credits" previews (cosmetic), but the actual number shown in the stat bar comes from the server profile snapshot.

## Migration Path

This is a big refactor. Here's how to sequence it safely:

| Phase | Scope | Risk | Can ship independently? |
|---|---|---|---|
| 1 | Create preview stores | LOW | ✅ (additive, no behavior change) |
| 2 | Reroute survival sim to preview | MEDIUM | ✅ (survival HP bar uses preview; Chef response overwrites) |
| 3 | Reroute kill cycle sim to preview | MEDIUM | ✅ (enemy HP bar uses preview; Chef response overwrites) |
| 4 | Reroute boss fight sim to preview | MEDIUM | ✅ (boss HP bar uses preview; RPC response overwrites) |
| 5 | Remove _pending ledger from playerSlice | HIGH | ✅ (resource bars update from server only — slight visual lag) |
| 6 | Clean up runtime snapshot | LOW | ✅ (remove authoritative fields from client echo) |
| 7 | Remove all local item generation from ticker | HIGH | ✅ (Chef generates items server-side; client only displays) |

## End State

After this refactor:
- **Zero local state is authoritative.** Every value the user sees comes from a server response.
- **The local ticker sim is purely cosmetic.** It writes to preview stores that are always overwritten by the next server response.
- **No phantom data is possible.** Even if a server call fails, the preview stores are the only "unconfirmed" state, and they're clearly labeled as preview in the UI (or simply reset on the next tick).
- **No `_pending` deltas.** No optimistic resource increments. The numbers you see are always the server's numbers.
- **Simpler mental model.** One rule: server writes truth, client renders it. No merge logic, no reconciliation, no "what if the local sim differs from the server sim" edge cases.

## Trade-off

The trade-off is visual latency. Currently, the HP bar moves immediately when the local sim applies damage, then gets corrected 1-3s later by the Chef response. After this refactor, the HP bar will still move immediately (via preview stores), but resource numbers (credits, XP, scrap) will update on the 3s Chef cycle — no optimistic "+50 credits" popups on the stat bar itself.

This is acceptable for an idle game where the tick cycle IS the core loop. The tick feed events still show previews ("+50 credits routed") for immediate feedback — they just don't update the authoritative stat counter until the server confirms.
