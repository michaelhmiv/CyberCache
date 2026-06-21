# Server-Authoritative State Fix Plan

## Goal
Eliminate ALL phantom/stale client state so every value shown on the frontend directly reflects database truth. No client-computed values may persist to DB without server confirmation.

## Issues to Fix

### 1. Boss Progression — Client-Side Mutations with No RPC (HIGH)
**Problem:** `applyBossFightTick` mutates `defeatedBossIds`, `pityCounters`, `attemptHistory` locally with no server call. On refresh, these vanish if the server never learned of them.
**Fix:** On boss victory/defeat, call `cc_battle_result` RPC (already exists in `verifiedOps`). Remove local `defeatBoss`/`incrementPity`/`resetPity` calls — let the RPC response drive boss_state via `syncVerifiedResult`.

### 2. CombatStats — Client-Truthorized Deaths Written to DB (MEDIUM)
**Problem:** `recordDeath` fires from the local survival simulation, then `saveCombatStats` writes the inflated count to DB. `setAll` is MERGE not REPLACE.
**Fix:** 
- Remove `recordDeath` call from the local survival sim (line 272 of idleTickerSlice.ts)
- Only record deaths from Chef-confirmed response (add `deathsRecorded` field to Chef response handling)
- Change `setAll` from merge to full replace (`{...emptyState(), ...snapshot}`)

### 3. ActiveBuffs — Not Reset on Account Switch (MEDIUM-HIGH)
**Problem:** `resetRuntimeStoresToInitialState` omits `useActiveBuffsStore`. On account switch, buffs from user A can show for user B for up to 60s.
**Fix:** Add `useActiveBuffsStore` to `resetRuntimeStoresToInitialState`.

### 4. Server-Side DPS Re-Derivation (HIGH)
**Problem:** The Chef trusts client-supplied `effectiveDps`, `skillBonuses`, `idleMods`, `activityMods`. These feed into `killsRecorded`, credits, scrap, XP — all persisted to DB.
**Fix:** The server claim route already receives `equippedGear` (array of GearItem). Create a pure `computeEffectiveDpsFromGear` function that both client and server use. The server re-derives DPS from equippedGear and ignores the client's `effectiveDps` value. Similarly re-derive `idleMods` and `activityMods` from the gear array.

### 5. CombatStats setAll — Merge → Full Replace (MEDIUM)
**Problem:** `setAll` uses `{...state, ...snapshot}` which is a merge. Omitted fields retain stale local values.
**Fix:** Change to `{...emptyState(), ...snapshot}` — full replace, clearing all fields not in the snapshot.

### 6. Attempts History — Client-Only (LOW)
**Problem:** `attemptHistory` is pure client memory, lost on refresh.
**Fix:** Accept as display-only. Add it to the runtime snapshot so it survives refreshes (it's already display data, same as deathLog).

## Files to Modify
1. `src/store/slices/idleTickerSlice.ts` — boss fight RPC call, remove local recordDeath
2. `src/store/slices/combatStatsSlice.ts` — fix setAll to full replace
3. `src/store/runtimeSupabaseSync.ts` — add activeBuffs to reset, add attemptHistory to snapshot
4. `src/server/chef.ts` — re-derive effectiveDps from equippedGear, re-derive idleMods
5. `src/server/routes/claim.ts` — ignore client effectiveDps, use server-derived value
6. `src/lib/combat/loadoutSurvival.ts` — extract pure `computeEffectiveDpsFromGear` function
7. Tests for all changes
