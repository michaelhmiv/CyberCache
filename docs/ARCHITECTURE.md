# CyberCache Architecture — Source of Truth Map

The canonical guide for gameplay architecture. Every agent working in this
repo must read this document before touching game logic.

> **Related docs:** `docs/ACTIVE_ACTIVITY_STATE.md`, `docs/SINGLE_ACTIVITY_ENFORCEMENT.md`,
> `docs/dps-chain-v2.md`, and the cybercache-dev skill references
> (`single-source-of-truth-tick.md`, `persistence-architecture.md`).

---

## 1. Gameplay Source of Truth Map

Each gameplay domain has **exactly one owner** file/module. Duplicate logic
in screens or components is forbidden.

> **Phase 5 (Chef):** As of June 2026, the Chef worker (`src/server/chef.ts`)
> is the authoritative engine for all roaming tick processing, item generation,
> and boss fight verification. The client is a display layer — it NEVER generates
> items or awards resources independently. See §8 (Chef Architecture) below.

| Domain | Owner | Notes |
|---|---|---|
| **Activity lifecycle** (start, stop, heartbeat) | `src/lib/api/activityService.ts` + `src/store/useActivityStore` | Server-backed via Chef activity routes (`active_actions` table) |
| **Roaming tick processing** | `src/server/chef.ts` (Chef worker) | Authoritative engine. Processes claims, generates items, awards resources. Runs on Railway server process. |
| **Roaming tick preview** (UI-only) | `src/store/slices/idleTickerSlice.ts` → `rollPreviewEvents` | COSMETIC ONLY. Shows placeholder events until Chef response. No store mutations. |
| **Server reward claiming** | Chef `POST /api/claim` (`src/server/routes/roamingHandler.ts`) → `cc_apply_chef_rewards` | The ONLY roaming claim path. No fallback engine: a failed Chef claim pays nothing and the ticker retries next cycle (the retired `cc_claim_roaming_rewards` fallback paid stale flat rates and was removed) |
| **Offline settlement** | `src/server/routes/claim.ts` → `POST /api/settle-offline` | Server-authoritative. Computes elapsed time from DB timestamps, processes all eligible ticks (capped by hours, not 20-tick limit). Idempotent via nonce. |
| **Item generation** | `src/server/chef.ts` + `src/lib/generators/*` | Chef calls the same TS generators as the client imports. ONE source of truth. |
| **Tick feed events** | `src/store/slices/tickSlice.ts` | `TickEvent` / `TickEventTone`. Capped at 50, FIFO. |
| **Inventory mutation** | `src/store/slices/inventorySlice.ts` | `receiveServerItems` (Chef path) or `addItem`/`removeItem` (user actions) |
| **Player resources** (credits, XP, scrap, materials, essences, cache keys/fragments) | `src/store/slices/playerSlice.ts` | Mutated ONLY via `syncVerifiedResult` from server response |
| **Loadout** | `src/store/slices/loadoutSlice.ts` | 7 gear slots + the vehicle slot (0021), with consumable slots |
| **Survival HP / death / medkit** | `src/store/slices/survivalSlice.ts` (display) + Chef (authority) | Death is Chef-recorded (`profiles.death_state` / `death_log`, migration 0013); resurrection is `POST /api/resurrect` only — the slice's `resurrect()` applies the server's confirmed result and charges nothing. Runtime snapshot persists display state only |
| **Kill cycle / enemy HP** | `src/store/slices/killCycleSlice.ts` | Persisted via Chef runtime snapshot |
| **Boss prep analysis** | `src/lib/simulation/bossSimulator.ts` | Pure sim, no side effects |
| **Consumable effect values, durations & roaming scope** | `src/constants/consumables.ts` (`CONSUMABLES` defs) | The roaming engine (`src/lib/consumables/roamingConsumableEngine.ts`) derives every magnitude, duration, threshold, and its activation set from the defs — no engine-local value tables. Roaming auto-activates all owned roaming-scoped consumables; consumption is persisted by the claim route (`cc_consume_roaming_consumables`) and, for offline ticks, atomically inside `cc_settle_offline_roaming` (migration 0012) |
| **Boss attempts** | `src/server/chef.ts` + `src/server/routes/claim.ts` via `POST /api/verify-boss` | Client sends intent only (boss, nonce, prepared consumables, risk). The route derives loadout/skills/level/credits/pity from server records. Chef rolls outcome, consumables, XP, credits, pity, unlocks, and loot. |
| **Marketplace** (listings, browse, price history) | `src/lib/market/*` (fee, identity keys, browse query, price stats) + `cc_market_create` / `cc_market_create_consumable` / `cc_market_create_material` / `cc_accept_listing` / `cc_market_cancel` (migrations 0017–0019) | Listings cover gear, consumable batches (quality % escrowed at list time), and materials — one completion path (`cc_accept_listing`) and one fee for every kind. Browsing is a server query (`GET /api/market/listings`) over facts stamped on the listing row at creation; price guidance comes from completed sales folded by `src/lib/market/priceStats.ts` over the identity keys of `src/lib/market/identityKey.ts` (SQL twins in migration 0019). Screens never price, filter the whole market, or settle a sale locally. |
| **Vehicles** (classes, yield, fuel, condition) | `src/lib/vehicles/vehicles.ts` | Real gear: `item_instances` kind 'vehicle' in the loadout's 'vehicle' slot (migration 0021). YIELD MODEL, never cadence — the Chef multiplies per-tick claim yields by `1 + (baseYield − 1) × (1 + yieldAffixPct) × conditionFraction × vehicleYieldScalar`, derived server-side from the equipped instance (claim routes read it via the gameplay store; the request body never carries it). Boss attempts never read the vehicle. Fuel is `profiles.vehicle_fuel` (Generic Fuel Cells load via `cc_refuel_vehicle`); condition is `item_instances.condition_current/max`, written only by `cc_apply_vehicle_usage` (claims) and `cc_use_patch_kit` (repair). Out of fuel or zero condition = ×1.0 on foot, never a block. Generation: `src/server/lib/generators/vehicleGenerator.ts`; unlock levels have a SQL twin (`cc_vehicle_unlock_level`) enforced at equip in `cc_equip_item`. Client display state: `src/store/slices/vehicleSlice.ts` (vehicles never enter the GearItem inventory store) |
| **NPC vendor** (catalog, rotation, Item of the Day, buyback) | `src/lib/vendor/catalog.ts` | Staples (flat 100% quality, always stocked) derive from the consumable defs; rotation (2 consumables + 1 material/essence per UTC day) and the Item of the Day (25% off) are date-seeded and computed on read — never cron-driven. Prices/buyback settle only through `cc_vendor_buy` / `cc_vendor_sell` (migration 0020), whose catalog/rotation SQL is the twin of this module, pinned by tests. Buyback pays `vendorBuybackRate` (economy lever) × vendor value: gear at the row's `estimated_value`, batches scaled by quality %, materials/essences at catalog unit value. Screens never price a vendor transaction locally beyond display previews |
| **Crafting / salvaging / workshop** | `src/store/slices/workshopSlice.ts` + `src/lib/craftingEngine.ts` | Queue-based |
| **Public profile activity** | `src/types/activity.ts` → `ActiveActivity.publicPayload` | Display-only; derived from activity store |
| **Animation / diorama display** | `src/lib/animation/fightTimeline.ts` + `src/lib/activity/ActionStage.tsx` | Pure reads of gameplay state |
| **DPS computation** | `src/lib/stats/dpsChain.ts` | See `docs/dps-chain-v2.md` |
| **Skill tree bonuses** | `src/store/slices/skillSlice.ts` (`getBonuses`) | Flows into: roaming DPS (`loadoutSurvival`), Chef idle economy, boss sim, survival HP, stagger dodge |
| **Skill → Chef economy** | `src/server/chef.ts` + `src/server/gameplay/serverLoadout.ts` | Chef routes rebuild skill bonuses from `profiles.skill_spends` + equipped class mod (the client sends none). Skill tree Scavenger bonuses (offlineEarnings, scrapYield, rareDropChance) merged with weapon idle mods |
| **Shield defense** (mitigation, recharge, element) | `src/lib/combat/loadoutSurvival.ts` + `damageContract.ts` | Mitigation reduces all incoming damage (capped 80%). Recharge regens shield per tick. Element match grants +15% resist. |
| **Relic affixes** | `loadoutSlice.getRelic().affixes` sent to Chef/snapshot consumers | Idle mods go to Chef; bossDamageMod/survivalBoost go to boss sim/Chef; xpBoostMod affects Chef-owned XP. |
| **Ordnance damage** | `bossSimulator.ts` (ordnanceFlatDamage) | Ordnance raw damage reduces boss effective HP. Ordnance element modifies shield/armor break. |
| **Server persistence** | `src/store/runtimeSupabaseSync.ts` + `src/lib/api/*` | 500ms debounced snapshot + Chef route writes |
| **XP curve** | `src/content/simulation.ts` (`xpToNextLevel`) | Mirrored server-side in migration 057 |

### Formula / Modifier Owners

Every displayed or awarded gameplay number must point to one owner:

| Number | Owner | Display Contract |
|---|---|---|
| Standard DPS, boss-relative DPS | `src/lib/stats/dpsChain.ts` | UI reads through `buildCharacterMechanicsSnapshot()` / `buildCharacterStatSummary()` |
| Max HP, shield HP, mitigation, effective HP | `src/lib/combat/damageContract.ts` + `src/lib/mechanics/buildCharacterMechanicsSnapshot.ts` | Snapshot buckets show `base`, `gear`, and effective mitigation |
| Survival damage / death preview state | `src/server/chef.ts` for verified tick outcomes; `src/lib/combat/damageContract.ts` for pure math | Client survival slice hydrates display/runtime state only |
| Kill cycle / monster HP display | `src/server/chef.ts` for verified tick advancement; `src/store/slices/killCycleSlice.ts` for animation state | Snapshot may hydrate display state, never rewards |
| Roaming rewards, XP, credits, scrap, fragments, materials, essences | `src/server/chef.ts` + `cc_apply_chef_rewards` | Client calls intent and syncs returned profile/items |
| Boss rewards, death fee, consumable spend, pity, unlocks, loot | `src/server/chef.ts` + `cc_apply_chef_boss_attempt` | Boss UI sends intent/loadout and animates returned result |
| Salvage economy | `cc_recycle_item` RPC | UI submits item id and syncs verified profile/item state |
| Gear generation | `src/lib/generators/*` called by Chef/server | Client may preview/render, not mint authoritative inventory |
| Rarity/drop odds and area modifiers | `src/content/*`, `src/constants/roamingAreas.ts`, Chef claim code | Snapshot exposes activity/area buckets for display |
| Offline cap / offline settlement | `POST /api/settle-offline` (server-authoritative) | Runtime snapshot is not offline reward truth |
| Vehicle effective yield, fuel burn, condition decay | `src/lib/vehicles/vehicles.ts` (`effectiveVehicleYield`, `vehicleBurnPerTick`, `vehicleDecayPerTick`) executed by `src/server/chef.ts` | Garage + roaming status line display the same formulas from the synced instance; the Chef's per-claim `vehicle` block is the authority |
| Skill and gear modifiers | `skillSlice.getBonuses()`, item payload affixes, `buildCharacterMechanicsSnapshot()` | Snapshot buckets separate `skill`, `gear`, `weapon`, `activity`, `consumable`, `server`, and `runtime` |

---

## 2. Allowed Mutation Paths

### Tick rewards (roaming)
```
idleTickerSlice.tickNow()
  -> rollPreviewEvents()          # cosmetic feed only, no progression mutation
  -> applyKillCycleTick()         # local target animation only, no XP/resources
  -> submitClaim(/api/claim)      # Chef rolls rewards, items, XP, resources, kills
  -> applyServerRewards()         # sync canonical profile and items
  -> recordKill(killsRecorded)    # stats use Chef-confirmed kills only
```
### Survival damage (per tick)
```
idleTickerSlice.tickNow()
  → computeMonsterDamageVsHunter()  # pure function
  → survivalSlice.applyDamage()     # state mutation
  → decideAutoEat()                 # pure function
  → playerSlice.consumeConsumable() # state mutation
```

### Death / resurrection (roaming)
```
Chef claim sim kills the hunter (processRoamingClaim survival block)
  -> claim route -> store.recordDeath()   # cc_record_death: profiles.death_state + death_log, first death wins
  -> claim response `death` + survival.killedBy/diedAt
  -> idleTickerSlice applyServerRewards -> survivalSlice.syncFromServer -> die(server entry)  # log + server-anchored timer
DeathOverlay (free | pay intent + nonce)
  -> chefClient.resurrectViaChef()        # POST /api/resurrect
  -> cc_resurrect                          # requires the record; free = DB-clock timer check; paid = shared price rule over the recorded area, charged atomically with clearing the record
  -> syncVerifiedResult(profile) + survivalSlice.resurrect()   # local applier only — no local deduction
```

### Offline settlement
```
AuthProvider.loadUser()
  → profile sync + items sync + activity hydrate
  → settleActiveActivityRewards()     # thin adapter — delegates to Chef
  → settleOffline({ settlementNonce })  # POST /api/settle-offline
  → Chef computes elapsed from DB timestamps (not client Date.now())
  → Chef processes all ticks (capped by offline_cap_hours, NOT 20)
  → Chef persists rewards atomically (last_claimed_tick += ticksSettled)
  → Client syncs returned profile/items, saves display snapshot
  → OfflineRecap component shows durable "While You Were Away" card
```

### Cache opening
```
ActionScreenContextual.openCache()
  → verifiedOps.makeItem()           # server RPC
  → serverItemRowToDisplayGear()     # adapter
  → inventory.addItem()              # state mutation (server-authoritative item)
```

### Rewarded ad cache keys
```
ResourceBar cache-key plus button
  → AdMob rewarded video completion      # Android app only; no economy mutation
  → verifiedOps.claimRewardedCacheKey()  # cc_claim_rewarded_cache_key RPC
  → profiles.cache_tokens += 1           # server-side cap/cooldown/idempotency
  → syncVerifiedResult()                 # client syncs returned profile
```

### Boss attempt
```
BossEncounterPanel (Fight workspace prep: boss intel + prepared consumables + risk)
  -> verifyBossFight(intent: boss/nonce/prepared set/risk)  # client sends intent only — no gear/skill payloads
  -> /api/verify-boss                              # route validates prep vs owned, enforces unlock + entry fee, derives loadout/skills from server records
  -> processBossAttempt()                          # Chef rolls outcome/loot/XP/credits/pity/unlocks/dedicated drops
  -> cc_apply_chef_boss_attempt()                  # profile/consumables/boss_state RPC (entry fee via migration 0011)
  -> syncBossAttemptResult()                       # client syncs returned canonical state, animates, LootMoment on victory
```
### Activity transitions
```
screen → activityStore.start(input)   # writes via Chef routes to active_actions
screen → activityStore.clear()        # clears active action
```

---

## 3. Forbidden Patterns

Screens and visual components are **consumers, not engines**. They must NOT:

- Roll rewards independently (no `Math.random` for drops/XP/credits in screens)
- Generate drops (`inventory.generateAndAdd*` from screen-level code)
- Mint cache fragments
- Award XP, credits, scrap, materials, or essences directly
- Mutate inventory directly
- Mutate authenticated player resources directly
- Run combat math
- Run survival/death logic
- Own gameplay `setInterval` timers
- **Calculate offline rewards client-side** (no `Date.now()` for elapsed time computation)
- **Restore economy state from `player_runtime_snapshots`** (credits, XP, scrap, materials, cache keys, inventory, boss wins)

**Exception:** Client-side randomness in `rollClientEvents()` inside
`idleTickerSlice.ts` is the ONLY allowed gameplay `Math.random` outside of
pure simulation functions (`bossSimulator.ts`, `damageContract.ts`).
It is explicitly marked as "client preview" and is always overwritten by
the server response.

---

## 4. UI Consumption Rules

UI components read from canonical stores:

| UI Surface | Reads From | Must Not Do |
|---|---|---|
| `DashboardScreen` | `useTickFeedStore` (gain toasts), `usePlayerStore` (HUD stats) | Must not generate rewards |
| `ActionScreenContextual` | `useTickFeedStore` (feed events), `useActivityStore` (current action), `usePlayerStore` (resources) | Must not run its own tick loop |
| `ProfileScreen` | `usePlayerStore`, `useInventoryStore`, `useLoadoutStore` | Must not mutate |
| `InventoryScreen` | `useInventoryStore`, `useLoadoutStore` | Must not generate items |
| `LiveTurfDiorama` | `useTickFeedStore` (latest event), `usePlayerStore` (stats) | Must not generate rewards |
| `OfflineRecap` | `useOfflineRecapStore` (settlement result) | Must not compute rewards |

Display-only timers are allowed for:
- Elapsed time display (seconds since activity started)
- Animation pacing (RAF loops)
- Countdown presentation (crafting completion)

These timers must never mutate gameplay state.

### Shared Mechanics Snapshot

Any UI surface that displays HP, DPS, break pressure, loot modifiers, XP,
scrap, offline modifiers, or boss-relative values should consume
`src/lib/mechanics/buildCharacterMechanicsSnapshot.ts` directly or through
`src/lib/stats/characterStats.ts`.

The snapshot returns each scalar as:

```
{
  value: number,                 // final displayed total
  contributions: [
    { bucket, source, stat, value }
  ],
  buckets: {
    base, gear, weapon, skill, activity, consumable, server, runtime
  }
}
```

Bucket meaning:
- `base`: chassis/level/base curve before equipment.
- `weapon`: weapon DPS or weapon-owned modifier contribution.
- `gear`: shield, ordnance, class mod, relic, and affix contribution.
- `skill`: skill tree contribution.
- `activity`: area/activity/runtime-route modifier contribution.
- `consumable`: temporary/prep consumable modifier contribution.
- `server`: authoritative server/Chef override or settled value.
- `runtime`: display hydration state that is not economy truth.

Do not add new UI-local DPS, HP, survival, reward, or loot formulas. If a
display needs a number that is not in the snapshot, add it to the snapshot and
document its owner here.

---

## 5. Server Verification Rules

- **All progression-affecting rewards** must go through the Chef write
  routes wrapped in `verifiedOps` + `verifiedStateSync` (the `cc_*`
  functions run server-side; identity comes from the Chef JWT).
- **Client-side randomness** is only for instant animation feedback.
  The server re-rolls and the server response is authoritative.
- **localStorage may only be used for:** UI preferences. Settlement deduplication
  uses server-side nonce (`profiles.last_settlement_nonce`), NOT localStorage locks.
- **Authenticated game progression must not depend on localStorage.**
- **`player_runtime_snapshots` are display hydration only.** They may restore
  UI/runtime state such as selected area, boss selection/risk, loadout
  consumable intent, market filters/watchlist, survival display, kill-cycle
  display, and loadout presets. They must never restore or trust credits, XP,
  scrap, materials, essences, consumable counts, cache keys/fragments,
  inventory ownership, boss wins/unlocks/pity/attempts, market listings,
  verified rewards, skills, or workshop outputs.
- **Chef-only RPCs are service-role only.** Functions that accept a user id and
  mutate economy/progression state, such as `cc_apply_chef_rewards`,
  `cc_apply_chef_boss_attempt`, and internal mastery/stat helpers, must not be
  executable by `anon` or `authenticated`.
- **Chef routes derive gear/skill inputs from server records (trust
  hardening, Phase 0 Slice 6).** `/api/claim` and `/api/verify-boss` must
  never consume `equippedGear`, per-slot gear objects, or `skillBonuses`
  from the request body — not even "re-derived" from the sent copies,
  which proves only internal consistency, not ownership. Both routes
  build those inputs via `src/server/gameplay/serverLoadout.ts` from
  `item_instances` rows with `runtime_state = 'equipped'` (slot
  identity from `equipped_slot`) and `profiles.skill_spends` + the
  equipped class mod, the same derivation `/api/settle-offline` uses.
  A stored weapon payload missing its required numeric fields (the
  client adapter's completeness rule) is not a sim input — the slot
  derives empty, matching what the honest client's loadout shows.

---

## 6. How to Add a New Action

1. Add the kind to `ActivityKind` in `src/types/activity.ts`.
2. Add the label to `PRODUCTIVE_ACTIVITY_LABELS` in the same file.
3. Add a `MechanicWorkspaceSpec` entry in `src/lib/activity/actionWorkspaceSpecs.ts`.
4. Add a build helper in `src/lib/activity/activityBuilders.ts`.
5. Add a UI panel in the contextual workspace (follow existing patterns in
   `ActionScreenContextual.tsx`).
6. Add animation beats in `src/lib/activity/actionAnimationDirector.ts`.
7. Add stage assets in `actionWorkspaceSpecs.ts` if visual rendering is needed.
8. If the action produces rewards, add the RPC path to `verifiedOps` and wire
   it into the ticker or a dedicated action settlement path. **Do not add a
   screen-level reward loop.**

---

## 7. How to Add a New Reward/Event Type

1. Add the tone to `TickEventTone` in `src/store/slices/tickSlice.ts`.
2. Add the rendering fallback in `DashboardScreen.tsx`'s `gainToneClass` (add
   the new tone + ensure `'unknown'` fallback still works).
3. Add handling in `rollClientEvents()` (client preview) and the corresponding
   server RPC.
4. **Do NOT** add a new `RunEventTone` or `RunEventKind` for gameplay rewards.
   Those types are for UI lifecycle events only.

---

## 8. How to Add a New Inspectable Gear Surface

1. Follow the `dps-chain-v2.md` contract — never inline DPS math.
2. Use `computeWeaponDps` / `computeLoadoutDps` / `computeStandardDps` from
   `src/lib/stats/dpsChain.ts`.
3. If you need a new modifier, add it to the chain and update the DPS doc
   in the same PR.

---

## 9. How to Add a New Screen Without Creating a New Engine

1. Import canonical stores (`usePlayerStore`, `useTickFeedStore`, etc.).
2. Subscribe via Zustand selectors. Use `useShallow` or split into scalar
   selectors to avoid the "result of getSnapshot should be cached" loop.
3. Call high-level intent methods from stores (`.start()`, `.clear()`,
   `.equipItem()`, etc.). Do not call mutation methods directly on player/
   inventory stores from the screen.
4. If you need elapsed time, derive it from `activity.current.startedAt`.
5. If you need a display timer, use a `useEffect` + `setInterval` that only
   calls `setState` — never gameplay mutations.

---

## 10. Chef Architecture (Server-Side Engine)

The Chef (`src/server/chef.ts`) runs in the same Railway process as the web app.
It is the **authoritative engine** for all gameplay outcomes.

### Why the Chef exists

The client (player's browser) cannot be trusted. A player can open DevTools and
override `Math.random` to force legendary drops. The Chef runs on your server.

### What the Chef owns

- Tick claim processing (probabilities, rewards)
- Item generation (weapons, shields, classMods, relics, ordnance)
- Resource awards (credits, XP, scrap, materials, essences)
- Boss fight verification (plausibility checks)
- **Offline settlement** (`POST /api/settle-offline`) — computes elapsed time from DB timestamps, processes all eligible ticks, persists atomically

### What the Chef does NOT own

- UI rendering (React app)
- Animation display
- Cosmetic previews (display-only placeholders in the tick feed)

### One source of truth for generators

The Chef imports the **same TypeScript generator functions** as the client.
Both use the same Mulberry32 RNG. Same seed = same item.

### Adding a new weapon type

1. Add entry to `src/constants/weaponTypes.ts`
2. Add name to `src/lib/utils/naming.ts`
3. `git push` — both client and Chef pick up the change.

---

## 11. Offline Settlement Contract

### Foreground Live Tick Contract

- **Route:** `POST /api/claim`
- **Cap:** ≤20 ticks per claim (`maxTicks` defaults to 20)
- **Cadence:** 3 seconds per tick (TICK_MS = 3000)
- **Nonce guard:** `tick_count` must be > `last_claimed_tick`
- **Owner:** `processRoamingClaim()` in `src/server/chef.ts`
- **UI:** `idleTickerSlice` runs the foreground loop, reads from Chef responses

### Offline Settlement Contract

- **Route:** `POST /api/settle-offline`
- **Cap:** `offline_cap_hours` (default 2h, max 168h), NOT the 20-tick foreground limit
- **Clock:** Server DB timestamps (`last_roaming_settled_at` or `active_actions.started_at`), NOT client `Date.now()`
- **Tick semantics:** `last_claimed_tick` advances by `ticksSettled`, NOT by +1
- **Idempotency:** Client-generated `settlementNonce` (UUID); server stores in `profiles.last_settlement_nonce`; duplicate nonce = cached result, no re-processing
- **Owner:** `handleSettleOffline()` in `src/server/routes/claim.ts`
- **Client adapter:** `settleActiveActivityRewards()` in `src/lib/activity/activitySettlement.ts` — delegates to Chef, applies returned state
- **UI:** `OfflineRecap` component (in `src/components/activity/OfflineRecap.tsx`) reads from `useOfflineRecapStore`, shows persistent "While You Were Away" card until dismissed

### Canonical Fields

| Field | Location | Semantics |
|---|---|---|
| `last_claimed_tick` | `profiles` | Highest tick fully settled (monotonic, advances by ticksSettled) |
| `last_roaming_settled_at` | `profiles` | Server-authoritative timestamp of most recent offline settlement |
| `last_settlement_nonce` | `profiles` | Client-generated idempotency key for settlement |
| `last_idle_claim_at` | `profiles` | Legacy idle claim timestamp (NOT authoritative for roaming) |

### Forbidden Patterns

- Client-side offline reward calculation (`Date.now()` for elapsed time)
- Screen-level reward loops (any `setInterval` that mints rewards)
- Restoring economy state from `player_runtime_snapshots` (credits, XP, scrap, materials, cache keys, inventory, boss wins)
- Using `last_claimed_tick` as a request nonce with `+1` pattern
- 20-tick clamp for offline settlement
- `localStorage` locks for settlement deduplication (use server nonce)

---

## 12. Agent Checklist Before Opening a PR

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npx tsc --noEmit` is clean
- [ ] No `Math.random` for gameplay in `src/screens/*` or `src/components/*`
- [ ] No `setInterval` for gameplay rewards in screens (display timers OK)
- [ ] No direct `player.addCredits/XP/Scrap/Material/Essence/CacheKeyFragments`
      from screens or components (domain stores / RPC paths only)
- [ ] Tick feed events use the canonical `TickEventTone` from `tickSlice.ts`
- [ ] No duplicated `TickEventTone` or `ActivityKind` unions
- [ ] New event tones have test coverage including `'unknown'` fallback
- [ ] No `generateAndAdd*` calls in `idleTickerSlice.ts` — tick previews are cosmetic only
- [ ] Items are generated by the Chef, not the client
- [ ] New generators have determinism tests in `src/test/chefDeterminism.test.ts`
- [ ] Boss fight results are verified through `POST /api/verify-boss`
- [ ] Offline settlement uses `POST /api/settle-offline` — never client-side Date.now()
- [ ] Offline settlement advances `last_claimed_tick` by ticksSettled, not by +1
- [ ] No `localStorage` locks for settlement deduplication
- [ ] Authenticated progression does not depend on localStorage
- [ ] Architecture doc is updated if a new source of truth is introduced
- [ ] `AGENTS.md` rules are followed
- [ ] Static architecture guard (`scripts/guard-architecture.sh`) passes

---

*Last updated: 2026-10-30 — Phase 0 Slice 2 (consumable contract repair): roaming consumable values/durations/scopes derive solely from `src/constants/consumables.ts`; Data Skimmer's extra loot roll is wired into the claim's loot roll; offline settlement applies the engine's consumed set atomically (migration 0012); a foreground consumption-persistence failure now fails the claim instead of silently paying out.*
