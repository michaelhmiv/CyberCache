# Roaming Consumable Engine — Server-Authoritative Implementation Plan

## Problem

PR #141 shipped survival consumable mechanics (Med Kit buffer, Nano Swarm regen, Adrenaline burst, Shield Cell restore) but they're **entirely client-side** — `applySurvivalTick()` in `idleTickerSlice.ts` mutates `survivalSlice` and calls `player.removeConsumable()` directly, with no server verification. Meanwhile, ammo/tactical/economy consumables in the 3 loadout slots are dead weight during roaming — they never fire.

This plan moves ALL consumable processing to the Chef server and activates every consumable family during roaming.

## Design Principles

1. **Server-authoritative** — the Chef owns activation, depletion, modifier application, and inventory mutation. The client is display-only.
2. **Auto-replenish from loadout** — player assigns a ConsumableType to each of 3 slots. Engine draws from inventory stock. When one depletes, the next auto-activates if stock remains.
3. **Ordnance on interval** — fires every 20 ticks (60s), modified by mastery level. Not elite-encounter-based.
4. **Duration-based** — most consumables activate for X seconds, tick down, then are consumed.
5. **Visible depletion** — Chef returns active buff state (remaining time, buffer HP, tick counts) for client display.
6. **Market liquidity** — 15-30 consumables consumed per hour of active roaming.

---

## Current Architecture (Reference)

### Chef claim flow
```
Client (idleTickerSlice.tickNow)
  → submitClaim({ playerId, areaId, ticks, effectiveDps, killCycle, survival })
    → POST /api/claim
      → handleClaim() authenticates JWT
      → processRoamingClaim() — authoritative tick loop:
          per tick: roll loot, apply DPS to monster, apply monster damage to hunter
      → cc_apply_chef_rewards RPC — persists credits/scrap/XP/items
      → returns ClaimResult { rewards, items, feedEvents, killCycle, survival }
  ← client syncs from Chef response
```

### What's client-side now (to be removed)
- `applySurvivalTick()` in `idleTickerSlice.ts` lines 206-391:
  - Med Kit buffer depletion check → `player.removeConsumable('MedKit')`
  - Nano Swarm per-tick regen → `survivalStore.tickNanoSwarm(10)`
  - Adrenaline reactive trigger → `player.removeConsumable('AdrenalineShot')`
  - Shield Cell reactive restore → `player.removeConsumable('ShieldCell')`
- `loadoutEffectiveDps()` — no consumable DPS modifiers
- `loadoutSurvivalStats()` — no consumable survival modifiers
- `consumableModsAdapter.ts` — only extracts 4 loot fields, unused in tick loop

### What exists server-side
- `processRoamingClaim()` — owns kill cycle, survival damage, loot generation
- `consumable_batches` table — quality-aware inventory with `cc_consume_consumable_batch` RPC
- `consumable_events` table — append-only ledger
- `profiles.consumables` — legacy count map (jsonb)
- Mastery system — `mastery_definitions`, `player_masteries`, `cc_add_mastery_xp()` RPC, trigger on `verified_action_ledger`

---

## Phase 1: Server-Side Consumable Engine Module

### New file: `src/lib/consumables/roamingConsumableEngine.ts`

Pure functions imported by the Chef. No React, no Zustand, no Supabase. The Chef passes in state; the engine returns mutated state + modifier map.

```ts
interface RoamingConsumableState {
  // Per-slot active state
  activeSlots: Array<{
    slot: 'PreFight' | 'MidFight' | 'Emergency';
    consumableId: ConsumableType;
    activatedAt: number;       // tick index
    expiresAt: number;         // tick index (0 for reactive)
    remainingBuffer?: number;   // Med Kit HP buffer
    remainingTicks?: number;    // Nano Swarm tick count
    armed?: boolean;            // Adrenaline waiting for threshold
  }>;
  // Modifier map (applied to tick calculations)
  mods: RoamingConsumableMods;
  // Consumption log (for inventory mutation + feed events)
  consumedThisTick: Array<{ consumableId: ConsumableType; count: number; reason: string }>;
}

interface RoamingConsumableMods {
  dpsMultiplier: number;           // ammo, adrenaline, tactical
  survivalMultiplier: number;      // shield cell resistance
  incomingDpsMultiplier: number;   // cryo ammo, signal scrambler
  bonusLootChance: number;         // luck booster, loot beacon
  extraLootRollChance: number;     // data skimmer
  scrapYieldMultiplier: number;    // salvage contract
  rareDropChanceMod: number;       // various
  eventChanceBonus: number;        // loot beacon
  enemyPressureMultiplier: number; // loot beacon drawback
  xpMultiplier: number;            // future
  medKitBuffer: number;            // current buffer HP
  nanoSwarmHealPerTick: number;    // regen amount
  nanoSwarmTicksRemaining: number; // regen ticks left
  adrenalineActive: boolean;       // DPS burst active
  shieldCellResistance: number;    // damage reduction %
  ordnanceBonusDamage: number;     // flat bonus DPS this tick (from ordnance fire)
}
```

### Engine functions

```ts
// Called once when roaming starts (or on first tick of a claim batch)
function activateLoadout(
  loadout: LoadoutConsumables,
  inventory: Record<string, number>,  // consumable count map
  tickIndex: number,
): RoamingConsumableState

// Called every tick
function processTick(
  state: RoamingConsumableState,
  context: {
    tickIndex: number;
    currentHp: number;
    maxHp: number;
    shieldHp: number;
    inventory: Record<string, number>;
    masteryLevels: Record<string, number>;  // for ordnance interval
  },
): {
  state: RoamingConsumableState;       // updated state
  mods: RoamingConsumableMods;         // applied this tick
  consumed: Array<{ id: ConsumableType; count: number; reason: string }>;
  feedEvents: FeedEvent[];             // for display
  survivalDelta: {                     // applied to hunter state
    hpDamage: number;                  // monster damage after mods
    hpHeal: number;                    // nano swarm regen
    shieldRestore: number;             // shield cell
    medKitBufferAbsorbed: number;      // buffer damage absorbed
  };
}
```

### Activation logic per family

| Family | Activation | Duration | Depletion | Auto-replenish |
|---|---|---|---|---|
| **Med Kit** (survival) | Proactive buffer on activation | Until 150 dmg absorbed | Buffer hits 0 → consume 1 | Yes, if inventory has more |
| **Shield Cell** (survival) | Instant shield restore + resistance | 180s (60 ticks) | Timer expires | Yes |
| **Nano Swarm** (survival) | Per-tick regen | 30 ticks (90s) | Ticks exhausted | Yes |
| **Adrenaline Shot** (survival) | Reactive — armed on activation, fires at HP < 20% | 20s burst (7 ticks) | Burst expires | Yes, re-arms after consumption |
| **Ammo Pack** (ammo) | DPS multiplier on activation | 600s (200 ticks) | Timer expires | Yes |
| **Elemental Ammo** (ammo) | DPS multiplier + shield/armor break | 600s (200 ticks) | Timer expires | Yes |
| **Signal Scrambler** (tactical) | Incoming DPS reduction | 600s (200 ticks) | Timer expires | Yes |
| **Loot Beacon** (economy) | +event chance, +enemy pressure | 600s (200 ticks) | Timer expires | Yes |
| **Luck Booster** (economy) | +bonus loot chance | 600s (200 ticks) | Timer expires | Yes |
| **Ordnance** (ordnance) | Interval-based burst damage | Every 20 ticks (60s) | Per-fire consumption | Yes, if inventory has more |

### Ordnance interval + mastery

Base interval: 20 ticks (60 seconds). Mastery level reduces interval:

```
effective_interval = max(10, 20 - floor(mastery_level / 2))
```

| Mastery Level | Interval (ticks) | Interval (seconds) | Fires/hour |
|---|---|---|---|
| 1 | 20 | 60s | 60 |
| 5 | 18 | 54s | 67 |
| 10 | 15 | 45s | 80 |
| 20 | 10 | 30s | 120 |

New mastery definition: `combat.ordnance` — gains XP per ordnance fire during roaming.

---

## Phase 2: Chef Integration

### Extend `ClaimRequest`

```ts
interface ClaimRequest {
  // ... existing fields ...
  /** Loadout consumable slots (which type is in each slot) */
  loadoutConsumables?: LoadoutConsumables;
  /** Current roaming consumable state (carried from previous claim) */
  roamingConsumableState?: RoamingConsumableState;
}
```

### Extend `ClaimResult`

```ts
interface ClaimResult {
  // ... existing fields ...
  /** Consumables consumed during this claim batch */
  consumedConsumables: Record<string, number>;
  /** Updated roaming consumable state (for next claim) */
  roamingConsumableState: RoamingConsumableState;
  /** Active buff display data (for client UI) */
  activeBuffs: Array<{
    consumableId: ConsumableType;
    slot: string;
    remainingMs: number;
    remainingBuffer?: number;
    remainingTicks?: number;
    armed?: boolean;
  }>;
  /** Extended survival state (includes buffer, regen, resistance) */
  survival: {
    currentHp: number;
    shieldHp: number;
    maxHp: number;
    isDead: boolean;
    medKitBuffer: number;
    nanoSwarmTicksRemaining: number;
    adrenalineActive: boolean;
    adrenalineExpiresAt: number;
    shieldCellResistance: number;
  };
}
```

### Modify `processRoamingClaim()`

The per-tick loop in `processRoamingClaim()` (chef.ts lines 271-431) gets modified:

**Before each tick:**
1. Call `processTick()` on the roaming consumable engine
2. Apply `mods.dpsMultiplier` to `effectiveDps`
3. Apply `mods.incomingDpsMultiplier` to monster attack power
4. Apply `mods.survivalMultiplier` / `shieldCellResistance` to hunter mitigation
5. Apply `mods.bonusLootChance` to gear drop threshold
6. Apply `mods.scrapYieldMultiplier` to scrap per tick
7. Apply `mods.xpMultiplier` to XP per tick
8. Apply `mods.ordnanceBonusDamage` as flat damage to kill cycle target
9. Apply `survivalDelta` (heal, shield restore, buffer absorption) to hunter state

**After the tick loop:**
1. Return `consumedConsumables` (aggregated counts)
2. Return `roamingConsumableState` (for next claim's input)
3. Return `activeBuffs` (for client display)

### Claim route changes (`src/server/routes/claim.ts`)

`handleClaim()` gets modified:

1. **Read consumable inventory from DB** before calling `processRoamingClaim()`:
   ```ts
   const { data: profile } = await supabase
     .from('profiles')
     .select('consumables')
     .eq('id', playerId)
     .single();
   const inventory = profile?.consumables ?? {};
   ```

2. **Pass inventory + loadout to Chef**:
   ```ts
   const claim: ClaimRequest = {
     ...body,
     playerId,
     loadoutConsumables: body.loadoutConsumables,
     roamingConsumableState: body.roamingConsumableState,
   };
   ```

3. **After `processRoamingClaim()` returns, persist consumption**:
   ```ts
   // Decrement consumed consumables atomically
   if (result.consumedConsumables && Object.keys(result.consumedConsumables).length > 0) {
     await supabase.rpc('cc_consume_roaming_consumables', {
       _player_id: playerId,
       _consumed: result.consumedConsumables,
       _area_id: body.areaId,
       _tick_count: body.tickCount,
     });
   }
   ```

4. **Return updated consumable state + inventory** in response.

### New RPC: `cc_consume_roaming_consumables`

```sql
create or replace function public.cc_consume_roaming_consumables(
  _player_id uuid,
  _consumed jsonb,  -- { "MedKit": 3, "AmmoPack": 1, ... }
  _area_id text,
  _tick_count bigint
)
returns jsonb
language plpgsql
security definer
as $$
declare
  key text;
  count_val integer;
  current_count integer;
  new_consumables jsonb;
begin
  select consumables into new_consumables from profiles where id = _player_id for update;

  for key, count_val in select * from jsonb_each_text(_consumed)
  loop
    current_count := coalesce((new_consumables ->> key)::integer, 0);
    if count_val > current_count then
      -- Server says we consumed more than we have — clamp (shouldn't happen if engine is correct)
      count_val := current_count;
    end if;
    new_consumables := jsonb_set(new_consumables, array[key], to_jsonb(current_count - count_val));

    -- Log to consumable_events
    insert into consumable_events (user_id, consumable_type, quantity_delta, event_type, activity_type, reason)
    values (_player_id, key, -count_val, 'used', 'roaming_loot',
      'Consumed during roaming tick ' || _tick_count || ' in ' || _area_id);
  end loop;

  update profiles set consumables = new_consumables where id = _player_id;

  return jsonb_build_object('consumables', new_consumables);
end;
$$;
```

---

## Phase 3: Client Cleanup

### Remove from `idleTickerSlice.ts`

All inline consumable logic in `applySurvivalTick()` (lines 258-349):
- Nano Swarm regen block
- Adrenaline trigger block
- Shield Cell restore block
- Med Kit buffer depletion block

The survival tick becomes purely:
1. Compute monster damage (using mods from Chef response)
2. Apply damage to shield/HP
3. Shield recharge

All consumable effects are already applied server-side and returned in the `survival` sync.

### Remove from `survivalSlice.ts`

The following become **display-only fields** synced from Chef:
- `medKitBuffer` — set from `survival.medKitBuffer` in Chef response
- `nanoSwarmTicksRemaining` — set from `survival.nanoSwarmTicksRemaining`
- `adrenalineActive` / `adrenalineExpiresAt` — set from `survival.adrenalineActive` / `adrenalineExpiresAt`

The actions (`setMedKitBuffer`, `tickNanoSwarm`, `startNanoSwarm`, `triggerAdrenaline`) are removed or become no-ops. The state is set via `syncFromServer()`.

### Modify `submitClaim()` in `chefClient.ts`

Add to `ChefClaimRequest`:
```ts
loadoutConsumables?: LoadoutConsumables;
roamingConsumableState?: RoamingConsumableState;
```

Add to `ChefClaimResult`:
```ts
consumedConsumables?: Record<string, number>;
roamingConsumableState?: RoamingConsumableState;
activeBuffs?: Array<{ ... }>;
```

### Modify `applyServerRewards()` in `idleTickerSlice.ts`

After applying Chef results, sync consumable state:
```ts
if (result.roamingConsumableState) {
  // Store for next claim's input
  useIdleTickerStore.setState({ roamingConsumableState: result.roamingConsumableState });
}
if (result.activeBuffs) {
  // Update active buffs store for display
  useActiveBuffsStore.getState().syncFromServer(result.activeBuffs);
}
if (result.survival) {
  // Extended survival sync includes medKitBuffer, nanoSwarm, adrenaline
  useSurvivalStore.getState().syncFromServer(result.survival);
}
```

### Modify `loadoutEffectiveDps()` and `loadoutSurvivalStats()`

These functions NO LONGER apply consumable mods — the Chef does that server-side. They return base values only. The Chef receives `effectiveDps` from the client and applies its own modifier map on top.

**No signature changes needed** — the client just stops trying to apply consumable mods locally. The `consumableModsAdapter.ts` file becomes a server-only utility (imported by the Chef, not the client).

---

## Phase 4: Consumable Mods Adapter Expansion

### `src/lib/buffs/consumableModsAdapter.ts`

Expand from 4 fields to full effect extraction. This file is now imported by the Chef (server-side), not the client.

```ts
export function extractConsumableMods(
  activeConsumables: ActiveRoamingConsumable[],
): RoamingConsumableMods {
  const mods: RoamingConsumableMods = {
    dpsMultiplier: 1,
    survivalMultiplier: 1,
    incomingDpsMultiplier: 1,
    bonusLootChance: 0,
    extraLootRollChance: 0,
    scrapYieldMultiplier: 1,
    rareDropChanceMod: 0,
    eventChanceBonus: 0,
    enemyPressureMultiplier: 1,
    xpMultiplier: 1,
    medKitBuffer: 0,
    nanoSwarmHealPerTick: 0,
    nanoSwarmTicksRemaining: 0,
    adrenalineActive: false,
    shieldCellResistance: 0,
    ordnanceBonusDamage: 0,
  };

  for (const active of activeConsumables) {
    const def = CONSUMABLES[active.consumableId];
    if (!def) continue;
    const effects = def.runtime.baseEffects;

    // DPS multipliers (ammo, adrenaline, tactical)
    if (effects.dpsMultiplier) mods.dpsMultiplier *= effects.dpsMultiplier;
    if (active.consumableId === ConsumableType.AdrenalineShot && active.armed === false) {
      mods.dpsMultiplier *= 1.1; // +10% DPS during burst
    }

    // Survival
    if (effects.survivalMultiplier) mods.survivalMultiplier *= effects.survivalMultiplier;
    if (active.consumableId === ConsumableType.ShieldCell) {
      mods.shieldCellResistance = 0.15; // 15% damage reduction
    }
    if (active.consumableId === ConsumableType.MedKit) {
      mods.medKitBuffer = active.remainingBuffer ?? 0;
    }
    if (active.consumableId === ConsumableType.NanoSwarm) {
      mods.nanoSwarmHealPerTick = 10;
      mods.nanoSwarmTicksRemaining = active.remainingTicks ?? 0;
    }

    // Incoming damage mods (cryo, signal scrambler)
    if (effects.incomingDpsMultiplier) mods.incomingDpsMultiplier *= effects.incomingDpsMultiplier;

    // Loot mods
    if (effects.bonusLootChance) mods.bonusLootChance += effects.bonusLootChance;
    if (effects.extraLootRollChance) mods.extraLootRollChance += effects.extraLootRollChance;
    if (effects.rareMaterialChance) mods.rareDropChanceMod += effects.rareMaterialChance;

    // Economy
    if (effects.yieldMultiplier) mods.scrapYieldMultiplier *= effects.yieldMultiplier;

    // Event mods (loot beacon)
    if (effects.eventChanceBonus) mods.eventChanceBonus += effects.eventChanceBonus;
    if (effects.enemyPressureMultiplier) mods.enemyPressureMultiplier *= effects.enemyPressureMultiplier;
  }

  return mods;
}
```

---

## Phase 5: ActiveBuffPills Enhancement

### `src/components/stats/ActiveBuffPills.tsx`

The component already renders countdown timers. Enhancements:

1. **Read from Chef-synced activeBuffs** instead of client-side store
2. **Med Kit buffer** — show remaining HP instead of timer: `150 HP` with a shield-style progress bar
3. **Adrenaline** — show `ARMED` while waiting (gray), `ACTIVE 18s` when triggered (red pulse)
4. **Nano Swarm** — show remaining ticks: `12 ticks` with regen icon
5. **Ordnance** — show charge counter: `Next fire: 14s` with ordnance icon
6. **Pulse animation** — when < 30s remaining on any duration buff, add CSS pulse

Data source: `useActiveBuffsStore` synced from Chef response's `activeBuffs` array.

---

## Phase 6: DB Migration & Mastery

### New migration: `20260617180000_roaming_consumable_engine.sql`

```sql
-- 1. New mastery definition for ordnance usage
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active)
values ('combat.ordnance', 'combat', 'Ordnance Mastery', 'Mastery over ordnance deployment during roaming. Reduces ordnance fire interval.', 'fires', 10, true, true)
on conflict (id) do nothing;

-- 2. New mastery for consumable efficiency
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active)
values ('consumable.efficiency', 'economy', 'Consumable Efficiency', 'Mastery over consumable usage during roaming. Reduces consumption rate.', 'uses', 15, true, true)
on conflict (id) do nothing;

-- 3. RPC for atomic consumable consumption during roaming
create or replace function public.cc_consume_roaming_consumables(
  _player_id uuid,
  _consumed jsonb,
  _area_id text,
  _tick_count bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  count_val integer;
  current_count integer;
  new_consumables jsonb;
begin
  select consumables into new_consumables from profiles where id = _player_id for update;

  for key, count_val in select key, value::integer from jsonb_each_text(_consumed)
  loop
    current_count := coalesce((new_consumables ->> key)::integer, 0);
    count_val := least(count_val, current_count);
    new_consumables := jsonb_set(new_consumables, array[key], to_jsonb(current_count - count_val));

    insert into consumable_events (user_id, consumable_type, quantity_delta, event_type, activity_type, reason)
    values (_player_id, key, -count_val, 'used', 'roaming_loot',
      'Consumed during roaming tick ' || _tick_count || ' in ' || _area_id);
  end loop;

  update profiles set consumables = new_consumables, updated_at = now() where id = _player_id;

  return jsonb_build_object('consumables', new_consumables);
end;
$$;

revoke execute on function public.cc_consume_roaming_consumables(uuid, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.cc_consume_roaming_consumables(uuid, jsonb, text, bigint) to authenticated;

-- 4. Add mastery XP trigger for roaming consumable usage
-- The verified_action_ledger already fires cc_apply_mastery_for_verified_action.
-- We extend it to handle consumable consumption events.
create or replace function public.cc_apply_mastery_for_verified_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
-- ... existing logic ...
-- NEW: consumable usage mastery
declare
  consumed_map jsonb;
  consumable_type text;
  consumable_count integer;
begin
  -- ... existing logic ...

  -- NEW: Consumable usage mastery
  if action = 'cc_claim_roaming_rewards' then
    consumed_map := coalesce(new.result_payload -> 'consumedConsumables', '{}'::jsonb);
    for consumable_type, consumable_count in select key, value::integer from jsonb_each_text(consumed_map)
    loop
      perform public.cc_add_mastery_xp(new.user_id, 'consumable.efficiency', consumable_count * 10);
      if consumable_type like 'Ordnance%' or consumable_type like 'EMP%' or consumable_type like 'Corrosive%' then
        perform public.cc_add_mastery_xp(new.user_id, 'combat.ordnance', consumable_count * 10);
      end if;
    end loop;
  end if;

  -- ... rest of existing logic ...
end;
$$;
```

### Roaming consumable state persistence

The `roamingConsumableState` is carried in the claim request/response cycle. For persistence across page reloads, store it in the runtime snapshot (already synced to Supabase via `runtimeSupabaseSync.ts`):

```ts
// In runtimeSupabaseSync.ts snapshot:
roamingConsumableState: useIdleTickerStore.getState().roamingConsumableState,
```

---

## Phase 7: Offline Settlement Integration

### Modify `handleSettleOffline()` in `claim.ts`

The offline settlement already calls `processRoamingClaim()`. Extend it to:

1. Read loadout consumables from runtime snapshot (stored in Supabase)
2. Read consumable inventory from `profiles.consumables`
3. Pass `loadoutConsumables` and `roamingConsumableState` to `processRoamingClaim()`
4. Persist consumed consumables via `cc_consume_roaming_consumables` RPC
5. Return updated consumable state in settlement response

This ensures consumables deplete during offline roaming at the same rate as active roaming.

---

## File Change Summary

| File | Action | Changes |
|---|---|---|
| `src/lib/consumables/roamingConsumableEngine.ts` | **Create** | Activation, per-tick processing, depletion, modifier map, ordnance interval |
| `src/server/chef.ts` | **Modify** | Extend `ClaimRequest`/`ClaimResult`; wire engine into `processRoamingClaim()` per-tick loop |
| `src/server/routes/claim.ts` | **Modify** | Read consumable inventory from DB; pass to Chef; persist consumption via RPC; return updated state |
| `src/lib/chef/chefClient.ts` | **Modify** | Add `loadoutConsumables`, `roamingConsumableState`, `consumedConsumables`, `activeBuffs` to request/response types |
| `src/store/slices/idleTickerSlice.ts` | **Modify** | Remove all inline consumable logic from `applySurvivalTick()`; send loadout consumables in claim; sync from Chef response |
| `src/store/slices/survivalSlice.ts` | **Modify** | `medKitBuffer`, `nanoSwarmTicksRemaining`, `adrenalineActive` become display-only (synced from server); remove client-side mutation actions |
| `src/lib/buffs/consumableModsAdapter.ts` | **Modify** | Expand to full effect extraction; becomes server-only utility |
| `src/lib/combat/loadoutSurvival.ts` | **Modify** | Remove any consumable mod application (Chef handles it) |
| `src/lib/combat/damageContract.ts` | **Modify** | `decideAutoEat` and `computeHealAmount` become unused (Chef handles it); keep for boss sim backward compat |
| `src/store/runtimeSupabaseSync.ts` | **Modify** | Add `roamingConsumableState` to runtime snapshot |
| `src/components/stats/ActiveBuffPills.tsx` | **Modify** | Read from Chef-synced activeBuffs; add buffer HP, armed/active, ordnance countdown displays |
| `src/store/slices/activeBuffsSlice.ts` | **Modify** | Add `syncFromServer()` to accept Chef-authoritative buff state |
| `src/lib/buffs/activeBuffs.ts` | **Modify** | Add server-synced buff shape (remainingMs, remainingBuffer, armed state) |
| `supabase/migrations/20260617180000_roaming_consumable_engine.sql` | **Create** | Mastery defs, `cc_consume_roaming_consumables` RPC, mastery trigger extension |
| `src/test/roamingConsumableEngine.test.ts` | **Create** | Test activation, tick-down, depletion, auto-replenish, ordnance interval, mastery scaling |
| `src/test/chefConsumableIntegration.test.ts` | **Create** | Test Chef claim with consumables: inventory read, consumption, modifier application, state return |

---

## Implementation Order

1. **DB migration** — mastery defs + RPC (unblocks everything)
2. **Engine module** — pure functions, fully unit-testable
3. **Chef integration** — wire engine into `processRoamingClaim()` per-tick loop
4. **Claim route** — read inventory, pass to Chef, persist consumption
5. **Client types** — extend `ChefClaimRequest`/`ChefClaimResult`
6. **Client cleanup** — remove inline consumable logic from `idleTickerSlice.ts`
7. **Survival slice** — make fields display-only
8. **Runtime sync** — persist `roamingConsumableState`
9. **ActiveBuffPills** — UI enhancement
10. **Offline settlement** — extend to include consumables
11. **Tests** — engine unit tests + Chef integration tests

---

## Security Model

| Concern | Mitigation |
|---|---|
| Client fabricates consumable inventory | Chef reads from `profiles.consumables` in DB, not from client request |
| Client fabricates loadout | Chef reads from runtime snapshot in DB (or client sends it, Chef verifies against DB) |
| Client skips consumption | Chef decrements server-side via `cc_consume_roaming_consumables` RPC with `FOR UPDATE` lock |
| Client replays old state | `tickCount` ordering guard already prevents replay (line 102 in claim.ts) |
| Double-consumption on retry | RPC is idempotent — `FOR UPDATE` lock + tick ordering guard |
| Offline settlement | Same Chef code path — `processRoamingClaim()` handles consumables identically |

---

## Expected Outcome

- **Server-authoritative:** All consumable activation, depletion, and modifier application happens in the Chef. Client is display-only.
- **Market liquidity:** 15-30 consumables consumed per hour of roaming (Med Kit ~3-5/hr, Shield Cell ~20/hr, Nano Swarm ~12/hr, Ammo ~6/hr, Ordnance ~60/hr at base interval).
- **Clear depletion:** Chef returns active buff state with remaining time/buffer/ticks for every active consumable.
- **Ordnance on interval:** Fires every 60s (base), modified by `combat.ordnance` mastery level.
- **Auto-replenish:** Engine draws from inventory stock; when one depletes, next auto-activates if available.
- **No client-side manipulation:** Client never decrements consumables or applies modifiers. All state comes from Chef response.
- **Mastery integration:** `combat.ordnance` (reduces fire interval) and `consumable.efficiency` (future: reduces consumption rate) masteries gain XP from roaming usage.
