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
| **Endless mode** (Chaos Chamber) | Rules (rotation, escalation, escrow curves, fee schedule, milestone shaping, prep intel): `src/content/endless.ts`. Engine: `processEndlessEncounter` in `src/server/chef.ts` (the shared boss simulator against content-built defs). Server state: `endless_runs` + `cc_start_endless_run` / `cc_apply_endless_encounter` / `cc_end_endless_run` (migration 0028) via `POST /api/endless/start|encounter|bank` + `GET /api/endless/me` (`src/server/routes/endless.ts`). Client: `src/components/fight/EndlessPanel.tsx` in the Fight workspace | The run is server-owned end to end: the client sends intent only (nonce; at entry, the prepared belt choice + risk). A run OCCUPIES the personal action slot (`active_actions` kind `endless_run`, target = run id) from start to end — encounters resolve only while the run holds the slot; switching away pauses the Chamber, banking always works. Depth is derived from the run row (never the body); each encounter prices the loadout the player CURRENTLY holds (server-derived, the #207 pattern). Currency rewards accrue into the run's ESCROW and pay only at run end: bank (or the depth cap) pays 100%, death pays `endlessDeathPayoutFraction` (lever, default 50%). DEATH IS CONTAINED: an endless death writes NO `death_state`/`death_log` and triggers no resurrection (0013 prices paid resurrection from a roaming area; the Chamber has none, and death is the mode's expected ending) — the escrow tax is the whole price. Starting a run over an active one settles it as `abandoned` at the same fraction. The prepared belt burns ONCE at entry (boss-applier batch semantics) and prices into every encounter's sim. Entry fee: `endlessEntryFeePerLevel` × level, ×2 per run started today (UTC), capped — recomputed and charged by the applier, destroyed, metered. Milestone depths (every 5, the boss-tier depths) drop ONE gear item through the shared generators with depth-shaped rarity weights; milestone items are stored immediately (boss-loot pattern) — escrow rules bind currencies only. Records: ended run rows (depth + UTC timestamps) are the leaderboards slice's input; best depth derives from them (no profile column). Prep is INTEL ONLY (Boss Intel Law): `endlessIntel` carries the run's scaling facts and never a readiness figure. Meters + levers: see `docs/ECONOMY.md`. |
| **Action skills** (one signature charged ability per skill tree) | Defs, levers (defaults + hard clamps), qualification/selection derivation, fire plans, surge weights, charge math: `src/content/actionSkills.ts`. Sim seam: the optional `actionSkill` effect on `BossSimulationInput` (`src/lib/simulation/bossSimulator.ts`) — flat damage joins netBossHp + the burst-exposure fold on bossTotalDamage, break bonuses join the break totals, stagger folds into `staggerDamageMult`; the client prep sim never passes it (bit-identical). Server state: `profiles.action_skill_charge` / `profiles.action_skill_selection` (migration 0030); appliers `cc_apply_chef_boss_attempt` / `cc_apply_endless_encounter` (trailing `_action_skill_tree`), `cc_set_action_skill_selection`, `cc_fire_overclock_workshop`; qualification helper `cc_action_skill_qualified` over `cc_skill_effective_points`. Routes: `src/server/routes/actionSkill.ts` (`GET /api/action-skill/me`, `POST /api/action-skill/select`, `POST /api/action-skill/fire-workshop`) + the `fireActionSkill` boolean intent on the boss-attempt and endless-advance bodies. Client: `src/components/fight/ActionSkillCard.tsx` (prep card), the picker on `SkillTreeScreen`, the Overclock bar on `WorkshopScreen`, the signature beam on `BossFightStage` | ONE charge pool (0–100) per player. Unlock is SERVER-DERIVED: keystone ownership at effective points ≥ 1 (spends + equipped class-mod boosts, the #222/#225 derivation); the recorded selection is the only fireable signature and the appliers re-validate selection + qualification + charge under the row lock — the client body carries only a boolean fire intent, never a tree or a charge. Firing zeroes the pool inside the SAME attempt/encounter resolution (nonce-idempotent via the verified-action ledger; a replay never double-fires). Accrual: boss attempts and endless encounters at levered rates (a fired resolution grants none); endless charge carries across encounters in a run and resets at ANY run end (bank, death, cap, abandon-settle). Fixer-selected players also accrue from craft units completed and repair points restored (via `cc_complete_craft_unit` / `cc_repair_finalize_job`). Scavenger's Cache Surge rolls extra weapons through the shipped generators/loot pipeline only (never the dedicated roll; legendary weight bounded by a hard-clamped lever). Fixer's Overclock has two fires on the one pool: combat fire reads the attempt's prepared consumables at quality ×`overclockQualityMultiplier` (1.25); workshop fire (`cc_fire_overclock_workshop`) instantly completes the in-progress unit on every active bench THROUGH `cc_complete_craft_unit` — same outputs/quality/XP (buys time, never output), refusing without spending when nothing is in progress. Roaming claims never fire. Prep surfaces show the player's OWN signature state only (Boss Intel Law). Meters: `action_skill_fires_*` per tree per day in `cc_compute_economy_metrics` + the in-memory twin; firing moves no currency. |
| **Cache Rank** (level-tied tokens for tiny permanent bonuses) | Defs (7 tracks: ids, caps, glyphs, colors), levers (defaults + hard clamps), entitlement/cost/bonus math, cache-quality weight shaping: `src/content/cacheRank.ts`. Server state: `profiles.cache_rank_tokens` / `profiles.cache_rank_grant_level` (watermark) / `profiles.cache_rank_spends` + seeded `cache_rank_bonus_definitions` (migration 0031, parity-tested against the TS defs). Grants: BEFORE UPDATE trigger on `profiles.player_level` + idempotent `cc_grant_cache_rank_tokens` + an inline grant inside `cc_spend_cache_rank` — all pay entitlement(level) − entitlement(watermark) under the row lock with a `cc_cache_rank_grant` ledger row keyed `cache-rank-grant:{uid}:{from}:{to}`; the watermark only moves forward, so no XP path (claim, boss, endless, craft, repair, offline settle — every level write funnels through the profiles row) can double-grant, and pre-existing profiles are granted retroactively exactly once. Spends: `cc_spend_cache_rank` (nonce-idempotent ledger). Routes: `src/server/routes/cacheRank.ts` (`GET /api/cache-rank/me` — observe-and-grant, `POST /api/cache-rank/spend`) mounted from `src/server/gameplay/routes.ts`; identity from the JWT only — forged level/token/spend fields in any body are never read. Consumers (registry: `CACHE_RANK_BONUS_CONSUMERS` in `src/lib/skills/skillConsumers.ts`, needle-pinned incl. SQL twins): Chef earn rates (credits/XP/scrap multiplied LAST; damage joins derived DPS), boss sim seam (`cacheRankDamageBonus` / `cacheRankMaxHpBonus` on the merged skill-bonus input), mechanics snapshot HP/DPS, craft + repair completion XP (craftEngine + `cc_complete_craft_unit` / `cc_repair_finalize_job`), cache quality in `cc_make_item` + the TS draw twin (this wires the #216 `cacheQuality` skill effect into the same spends-only lane), and the Silver Tongue market uplift in `cc_accept_listing` + `src/lib/market/marketFee.ts` (fee first — levered rate × skill reductions, destroyed — then uplift = floor(post-fee proceeds × fraction), MINTED; NPC listings exempt). Client: `src/components/profile/CacheRankPanel.tsx` on the Profile screen (self-fetching; renders only Chef-confirmed state) | A SEPARATE currency from skill points (level − 1 budget untouched) and from every economy currency: tokens are minted only by the grant paths and destroyed only by spends. NO RESPEC (deliberate: level-bound tokens, tiny broad bonuses). Full menu costs 210 tokens > 174 earnable at L100, so the menu can never be completed. Guests earn and spend identically. Meters: `cache_rank_tokens_granted` / `cache_rank_tokens_spent` in `cc_compute_economy_metrics` + the in-memory twin; the Silver Tongue uplift folds into `credits_minted_other` via `market_fee.cache_rank_proceeds_bonus`. |
| **Dispatch + Courier** (timed contracts for spare loadouts and spare vehicles; the Leviathan Rig) | Terms (offer board, strength, foot/courier payout lines, projections, settlement fractions) + levers (defaults + hard clamps): `src/content/dispatch.ts`. Server state: `public.dispatch_missions` (migration 0032 — one row per contract, terms snapshotted at departure incl. the courier brief §2.7 reserved fields). Appliers: `cc_dispatch_depart` (validates slots from the `dispatchQueueSlots` lever, item/vehicle availability, the courier class-band gate via `cc_vehicle_unlock_level`, fuel; locks committed instances `in_service` + `is_locked`), `cc_dispatch_settle_due` / `cc_dispatch_recall` over the shared `cc_dispatch_settle_mission` (pro-rata floors, breakdown fraction cap, fuel refund, wear application; settle ledger `cc_dispatch_settle` keyed `dispatch-settle:{mission_id}`). Routes: `src/server/routes/dispatch.ts` (`GET /api/dispatch/me` — settles due first, `POST /api/dispatch/preview|start|recall`) mounted from `src/server/gameplay/routes.ts`; the route prices from server records only, and a consumed start nonce returns its stored departure before pricing (`getDispatchDeparture`). Identity from the JWT only. PARALLEL to the personal action slot by law — dispatch never reads or writes `active_actions`. Escrow: recycle (0026), reforge (0027), repair post/enqueue (0025) already refused `in_service`; 0032 restates `cc_equip_item` / `cc_market_create` / `cc_item_lock` verbatim + `in_service` (writes-twin guards match). Meters: `credits_minted_dispatch` / `credits_minted_courier` in `cc_compute_economy_metrics` + the in-memory twin, both folded into the minted total. The Leviathan Rig is a `VEHICLE_CLASSES` row (unlock 75, yield 1.50 — R11) + the `cc_vehicle_unlock_level` twin + a generator gate below areaUnlockLevel 20. Client: `src/components/dispatch/DispatchPanel.tsx` on the Dispatch sub-screen (Dashboard entry); Garage shows an ON CONTRACT badge for `in_service` vehicles |
| **Marketplace** (listings, browse, price history) | `src/lib/market/*` (fee, identity keys, browse query, price stats) + `cc_market_create` / `cc_market_create_consumable` / `cc_market_create_material` / `cc_accept_listing` / `cc_market_cancel` (migrations 0017–0019) | Listings cover gear, consumable batches (quality % escrowed at list time), and materials — one completion path (`cc_accept_listing`) and one fee for every kind. Browsing is a server query (`GET /api/market/listings`) over facts stamped on the listing row at creation; price guidance comes from completed sales folded by `src/lib/market/priceStats.ts` over the identity keys of `src/lib/market/identityKey.ts` (SQL twins in migration 0019). Screens never price, filter the whole market, or settle a sale locally. |
| **Vehicles** (classes, yield, fuel, condition) | `src/lib/vehicles/vehicles.ts` | Real gear: `item_instances` kind 'vehicle' in the loadout's 'vehicle' slot (migration 0021). YIELD MODEL, never cadence — the Chef multiplies per-tick claim yields by `1 + (baseYield − 1) × (1 + yieldAffixPct) × conditionFraction × vehicleYieldScalar`, derived server-side from the equipped instance (claim routes read it via the gameplay store; the request body never carries it). Boss attempts never read the vehicle. Fuel is `profiles.vehicle_fuel` (Generic Fuel Cells load via `cc_refuel_vehicle`); condition is `item_instances.condition_current/max`, written only by `cc_apply_vehicle_usage` (claims) and the repair paths of migration 0025 (timed self-repair jobs + the repair-services board — the instant `cc_use_patch_kit` is retired). Out of fuel or zero condition = ×1.0 on foot, never a block. Generation: `src/server/lib/generators/vehicleGenerator.ts`; unlock levels have a SQL twin (`cc_vehicle_unlock_level`) enforced at equip in `cc_equip_item`. Client display state: `src/store/slices/vehicleSlice.ts` (vehicles never enter the GearItem inventory store). The roaming status line and the Garage both read the CURRENT tank from the player store's profile mirror (`vehicleFuel`, synced from `profiles.vehicle_fuel` by claims + verified ops); the vehicle store's `lastClaimStatus` is claim HISTORY only and never shadows the tank (audit CONS-01) |
| **NPC vendor** (catalog, rotation, Item of the Day, buyback) | `src/lib/vendor/catalog.ts` | Staples (flat 100% quality, always stocked) derive from the consumable defs; rotation (2 consumables + 1 material/essence per UTC day) and the Item of the Day (25% off) are date-seeded and computed on read — never cron-driven. Prices/buyback settle only through `cc_vendor_buy` / `cc_vendor_sell` (migration 0020), whose catalog/rotation SQL is the twin of this module, pinned by tests. Buyback pays `vendorBuybackRate` (economy lever) × vendor value: gear at the row's `estimated_value`, batches scaled by quality %, materials/essences at catalog unit value. Screens never price a vendor transaction locally beyond display previews |
| **Crafting / salvaging / workshop** | Catalog + formulas: `src/content/crafting.ts`. Server jobs: `craft_jobs` + `cc_enqueue_craft_job` / `cc_settle_craft_jobs` / `cc_cancel_craft_job` (migration 0024), TS twin `src/server/writes/craftEngine.ts`. Client: `src/store/slices/workshopSlice.ts` (server-state mirror only) | Jobs progress ONLY while `crafting` is the active action (occupations law; see `docs/WORKSHOP_ACTIVITY_ENFORCEMENT.md`). Escrow at enqueue, per-unit completion at settlement (outputs + XP + mastery), cancel refund table. Benches are modifier objects snapshotted per job (`profiles.workshop_benches`, `cc_unlock_bench`); tools are crafted workshop assets (`profiles.workshop_tools`). The client holds NO craft timer math (guard-pinned). |
| **Extraction** (timed gathering occupation) | Rules + formulas + levers (defaults + hard clamps): `src/content/extraction.ts`. Server state: `public.extraction_state` (migration 0033 — standing selection + in-progress pass terms + `pending_passes`). Accrual: `cc_settle_extraction_time` (crafting's window math; hooked into the restated `cc_set_active_action` / `cc_clear_active_action`, which also carry the start gates + selection sync). Finalization: the Chef rolls pending passes against the shipped find pool (`rollAreaMaterialFind`, tick-RNG streams `extract` / `extract:signature` / `extract:loot`) and persists through `cc_apply_extraction` (validates indexes/whitelist/bounds, prices XP itself via `cc_extract_pass_xp` → `cc_craft_unit_xp`). TS twin: `src/server/writes/extractionEngine.ts`. Route: `GET /api/extraction/state` (`src/server/routes/extraction.ts`, settles first) + the extraction branch of offline settlement. Client: `src/components/fight/ExtractionPanel.tsx` (server-state mirror only) | Passes (10 min) complete ONLY while `extraction` holds the personal action slot; a pass settles on the terms it started on. Finds are materials/essences ONLY — no gear/credits/scrap/fragments/cores; vehicles, roaming activity mods, and roaming consumable find mods never apply (v1). XP pegged 0.75× the roaming benchmark through the crafting peg machinery (lever hard-clamped [0.70, 0.85] in TS + SQL). Deep Delve: mastery `gathering.extraction` ≥ 5 to select, server-computed gear factor ≥ 0.80 per settling pass or it pays as Surface. The client holds NO pass timing/find/XP math (guard-pinned). Meters: `extraction_passes` / `extraction_xp_awarded` / `materials_minted_extraction`. |
| **Repair services** (board, escrow, self-repair) | Rules + formulas: `src/content/repair.ts`. Server: `service_jobs`/`escrow_records` + `cc_post_repair_job` / `cc_accept_repair_job` / `cc_settle_repair_jobs_for` / `cc_repair_job_finish|cancel|reclaim` and the `repair` craft-job kind in `cc_enqueue_repair_job` / `cc_settle_craft_jobs` (migration 0025), TS twins `src/server/writes/repairBoard.ts` + `craftEngine.ts`. Client: Market → Repair Services tab (`src/components/market/RepairBoard.tsx`) + the Garage repair lane | OPEN MARKET ONLY — no NPC mechanic, no private hires. Owners escrow the FULL price at posting (terms fixed); the accepting mechanic supplies the patch kits (price = kits + labor) and work accrues only while their `workshop_service` action targets the job. Settlement is one rule: completion pays in full, every other terminal state pays pro-rata `floor(price × restored/target)`, the shared market fee is destroyed from the paid part, the remainder refunds. Self-repair is the same work without a counterparty: a timed `repair` job on the craft machinery burning your own kits at your repair-mastery rate (the mechanic's edge is time + efficiency, never permission). Constants are economy levers (`repairWorkRateBase`, `serviceXpPerPoint`, …); repair volume lands in the daily economy metrics. The dormant 0004 service flow is deleted, not revived. |
| **Collections + legendary cores** | Catalog + derivation + core-yield formula: `src/content/collections.ts`. Server records: `collection_discoveries` + `cc_record_discoveries` and `profiles.legendary_cores` (migration 0026). Read: `GET /api/collections/me` (reads store). Client: `src/screens/CollectionsScreen.tsx` (Profile → Collections) | The collection log is a TROPHY RECORD, never a claim surface: entries (25 legendary effects / 13 bosses / 36 legendary weapon frames / 7 named elites = 81) are written ONLY by Chef/write routes at the moment the underlying server-side fact settles (item stored after a claim, boss loot, or offline settlement; cache forged; market purchase delivered; boss victory applied; elite kill recorded; item salvaged — salvage proves the hold), derived from the settled records via the content module — a request body can never name a discovery. Backfill (in the migration) seeds only what surviving records prove (owned items, ledger-carried items, `boss_state.defeatedBossIds`, `roaming.elite_kill` rows); unprovable history starts undiscovered, by design. Legendary cores are a profile-level currency like fragments: minted ONLY inside `cc_recycle_item` when a Legendary is salvaged (1 + level≥25 + level≥50 + effect-weapon, range 1–4; scrap multipliers never scale cores), held in `profiles.legendary_cores`, and spent by the Legendary Core Catalyst (gear craft jobs escrow 1 core/unit at enqueue for +2 generation draws per unit; `craft_jobs.escrow_cores`, cancel refunds on the material catalyst's schedule). Cores minted/spent and legendaries salvaged are daily economy meters (see `docs/ECONOMY.md`). The discovery row shape is the projection source for the later public profile showcase — reads must stay player FACTS only (family, entry, source, timestamp), never catalog data. |
| **Weekly leaderboards + rewards** | Slate + rotation + reward table: `src/content/leaderboards.ts` (one content owner). Fold: `src/server/leaderboards/fold.ts` (one pure fold shared by both read stores and settlement). Settlement: `src/server/leaderboards/store.ts` (`PgLeaderboardStore` / `InMemoryLeaderboardStore`), run inside the daily heartbeat (`src/server/jobs/routes.ts`). Tables: `leaderboard_settlements` / `leaderboard_rewards` / `leaderboard_drop_buffs` (migration 0035). Read: `GET /api/leaderboard/weekly` (reads store, JWT caller only). Buff stamping: claim / verify-boss / settle-offline routes → `economy.dropLuckBonus` on the Chef request. Client: weekly panel in `src/screens/LeaderboardsScreen.tsx` | ISO weeks (UTC, Monday open → Monday close; week key = its Monday). Eight races fold from the same server records as the lifetime fold (roaming kills, boss victories, elites, caches opened, salvage count, endless depth of runs ENDED in-window, market sales attributed to the SELLER, extraction passes); 4 run per week by a deterministic seeded rotation of the week key — no stored state, no coordination. Ties: value → earliest-to-reach → account `created_at` → player id; no shared ranks; the NPC market account never ranks. Settlement is exactly-once: the `leaderboard_settlements` claim row and all payments commit in ONE transaction (conflict = no-op; crash = the week retries whole), and every closed week from the earliest record settles, zero-activity weeks included — no new cron. Rewards pay only at/above each race's qualifying minimum: keys 3/2/1 for ranks 1–3, drop-luck buffs +25%/48h, +20%/36h, +15%/24h, and +10%/12h for ranks 4–10. A buff is a server row with an expiry; the active bonus is the MAX unexpired grant (never a stack), stamped by the routes from `leaderboard_drop_buffs` — never the client body — and consumed by the real drop paths: roaming Epic/Legendary rarity weights × (1 + bonus) and the boss dedicated-drop chance × (1 + bonus); offline settlement stamps it too (engine parity). Endless drops are out of scope in v1. Keys minted are metered as `cache_keys_from_leaderboards` (see `docs/ECONOMY.md`), distinct from the ad lane. |
| **Daily login streak** | Ladder + tier math + lever surface + state-view derivation: `src/content/loginStreak.ts` (one content owner). Server state: `login_streak_state` + `login_streak_claims` + seeded `login_streak_reward_definitions` (migration 0036, parity-tested against the TS table). Grant: `cc_record_login_streak_day` via `GET /api/login-streak/me` (`src/server/routes/loginStreak.ts`, mounted from `src/server/gameplay/routes.ts`; gameplay store + in-memory twin) — observe-and-record, the Cache Rank pattern. Client: `src/components/dashboard/LoginStreakPanel.tsx` on the Dashboard (mounting it IS the check-in) | A streak day is the player's first authenticated check-in of a UTC day, recorded from the SERVER's clock (the DB clock in SQL) — no body/query field can name a day, a streak length, or an amount. Exactly-once is the claims table's (player, day) primary key: a replay returns the stored claim and grants nothing. Consecutive UTC days increment; a missed day restarts the streak at 1 while `longest_streak` is kept (also derivable as max(streak_length) over the claims — the profile fold's record, in its style). The 7-day ladder escalates credits → fragments and pays ONE cache key on day 7; the cycle repeats at tier ×1.5 per step, capped at tier 5 (×3), and the key never scales (≤1/week/player by construction). Credit/fragment amounts scale by the `streakCreditScalar` / `streakFragmentScalar` levers (SQL reads them via `cc_economy_config_number`, clamped [0, 3] at the call site). Guests earn identically — grants key on the profile row. Meters: `credits_minted_login_streak` (folds into `credits_minted_total`), `cache_fragments_from_login_streak`, `cache_keys_from_login_streak` — the keys are a distinct source, NOT leaderboard keys and NOT cache-lane (ad) issuance (see `docs/ECONOMY.md`). |
| **Cache box lane** (the monetization lane: daily box budget) | Rules + lever defaults/clamps + view/payment derivation: `src/content/cacheLane.ts` (one content owner). Server state: `cache_box_openings` (one row per opening: player, UTC day, payment, ad unit) + the cap lever in `economy_config` (migration 0037). Enforcement lives INSIDE `cc_make_item` (restated by 0037): every opening of the UTC day counts against `cacheBoxDailyCap` (default 10, hard clamp [1, 30]); the day's first opening resolves `free` server-side whatever the caller offered; openings 2..cap pay 1 cache key OR one client-attested watch-ad (the open call carries the ad unit id — no SSV); the nonce idempotency ledger makes a replayed opening a no-op. Reads: `GET /api/caches/me` (`src/server/reads/routes.ts`, JWT identity only). Client: `src/screens/ChestScreen.tsx` is the ONLY ad surface (placement law: never the play screen, never the loot moment); `src/lib/ads/rewardedCacheAd.ts` wraps the AdMob rewarded flow | CACHE BOX ≠ LOOT DROP: caches are the ad lane, drops are earned gameplay, and the vocabulary stays split. Keys remain a STOCK (fragments, leaderboard podiums, streak day-7) that buys ad-free openings INSIDE the budget — no payment buys an opening past the cap. The draw is untouched: `cc_draw_odds('cache_primary_rarity', cache_quality)` with the 0031 quality computation byte-identical (60/32/8 weights from 0004). The old rewarded-key claim (3/day + cooldown) is dropped by 0037 — ads attest openings directly and mint no keys. Meters: `cache_boxes_opened_free` / `_ad` / `_key` fold from `cc_make_item` result payloads (pre-0037 rows count as key); `cache_keys_from_ads` survives as the legacy fold over historical claim rows. |
| **Profile lifetime stats + trophy shelf** | The fold: `computeProfileLifetime` in `src/server/reads/store.ts` (one pure fold; the in-memory and Pg read stores feed it the same input shape). Read: `GET /api/profile/stats` (reads store, JWT caller only). Kill record: `player_kill_stats` + `cc_record_kill_stats` (migration 0034). Client: `src/components/profile/TrophyShelfPanel.tsx` + `LifetimeStatsPanel.tsx`, mounted inside ProfileScreen | A READ-ONLY projection over server records — never a second source of truth. Every figure folds from records another system owns: roaming kills + per-area + boss attempts/victories + caches + salvage/cores minted + reforges + resurrections from `verified_action_ledger` result payloads; elite kills from `roaming.elite_kill` telemetry; discoveries (bosses downed, named elites, legendary finds BY SOURCE) from `collection_discoveries`; endless runs/best depth from ENDED `endless_runs` rows only (an active run proves nothing); dispatch from settled `dispatch_missions` at the settler's own `floor(payout × fraction)`; crafting/repair-self from `craft_jobs`; repair board from the provider's completed `service_jobs`; consumables used from `consumable_events` 'used' rows; extraction from `extraction_state`; market sales from the caller's sold `market_listings`, purchases from their own accept rows, and seller fees from BUYERS' accept rows naming the caller as seller (the only place the fee exists). Cores spent = minted − balance (recycling is the only mint). Kills per weapon type accrue ONLY at the two roaming appliers' pay paths (`cc_apply_chef_rewards` / `cc_settle_offline_roaming`, after their idempotency early-returns), attributed to the weapon equipped at settle time ('unarmed' when none) — boss/endless kills stay out by design, and pre-0034 kills carry no attribution. The trophy shelf is the SERVER's top-3 weapons (rarity → level → newest) as full `item_instances` rows rendered through the compositor (real-item invariant); there is no pin choice in v1. FORBIDDEN inputs: `combat_stats` / `cc_my_stats_summary` (client-writable via `PUT /api/stats/combat` — display history, never lifetime truth) and any client store. Stats no record can prove (lifetime deaths, lifetime credits earned/spent, kills by element) are GAPS — absent from the payload, never estimated. |
| **Reforge** (affix reroll) | Cost rules: `src/content/reforge.ts`. Pools + bake/unbake + the roll: `src/lib/gear/affixPools.ts` (the generators import the same pools and bake switches — one source). Server: `cc_reforge_item` (migration 0027) via `POST /api/ops/reforge-item`. Client: `src/components/gear/ReforgePanel.tsx` inside the gear inspect sheet (Inventory context only) | One atomic, nonce-idempotent op: the roll is computed in TS from the shared pools on a dedicated stream seeded from the op nonce; the SQL applier revalidates ownership / `available` state / lock / kind / affix under the row lock, pins the identity invariants (rarity, level, element, manufacturer, `rollQuality`, parts, node boosts, shield behavior, `legendaryEffectId` — never added, removed, or changed), recomputes the lever-priced cost, charges, and persists. Eligible: the five gear kinds with ≥1 rolled POOL affix; vehicles are OUT (separate family, Garage surface) and activity modules are never reforgeable (procedural; their generation inputs are not persisted on the item). The replacement never duplicates a stat the other affixes carry and never returns the identical affix (pool-exhausted fallback: same stat, different value). Costs are DESTROYED, not escrowed: scrap = salvage value × 3 × `reforgeScrapScalar`; Legendary-rarity items also pay `reforgeLegendaryCoreCost` (default 2 ≈ one salvaged legendary). Baked stats are recomputed by unbake → swap → rebake (round trip bit-identical; weapon baseDamage/attackSpeed recover within one bake-grid step of the fractional pre-bake base). Reforging never writes collection discoveries — identity is unchanged. Meters: `reforges_completed`, `scrap_destroyed_reforge`, `legendary_cores_destroyed_reforge`, and reforge cores extend `legendary_cores_spent` (see `docs/ECONOMY.md`). |
| **Crafted quality → engines** | `src/constants/consumables.ts` (`getConsumableRuntimeEffects`) + `src/lib/consumables/batchProfile.ts` | Consumption prices effects from the batches actually burned: per type, per resolution window, the quantity-weighted average quality of burned units (FIFO quality-ascending burn order). Wired into roaming claims (foreground + offline twin via `consumableQualityProfile`), boss attempts (`consumableQuality` on the attempt → DPS chain pools), patch kits (repair jobs price each kit at base × its batch quality %, migration 0025) and the refuel path. A flat-100 batch is bit-identical to the pre-0024 numbers everywhere. |
| **Crafted gear** | `src/server/writes/craftGear.ts` + the shared generators | Gear frames settle as pending outputs and finalize through the shared TS generators with rarity forced (Epic ceiling — Legendary can never be selected, rolled, or tempered in; crafted items NEVER carry `legendaryEffectId`); provenance `payload.origin = 'crafted'` + `craftedBy`. SQL has payload functions only for weapons, so finalization is TS-side for every slot (`cc_pending_crafted_gear` / `cc_finalize_crafted_gear`). |
| **Public profile activity** | `src/types/activity.ts` → `ActiveActivity.publicPayload` | Display-only; derived from activity store |
| **Animation / diorama display** | `src/lib/animation/fightTimeline.ts` + `src/lib/activity/ActionStage.tsx` | Pure reads of gameplay state |
| **DPS computation** | `src/lib/stats/dpsChain.ts` | See `docs/dps-chain-v2.md` |
| **Skill tree bonuses** | `src/store/slices/skillSlice.ts` (`getBonuses`) | Flows into: roaming DPS (`loadoutSurvival`), Chef idle economy, boss sim, survival HP, stagger dodge |
| **Skill → Chef economy** | `src/server/chef.ts` + `src/server/gameplay/serverLoadout.ts` | Chef routes rebuild skill bonuses from `profiles.skill_spends` + equipped class mod (the client sends none). Skill tree Scavenger bonuses (offlineEarnings, scrapYield, rareDropChance) merged with weapon idle mods |
| **Shield defense** (mitigation, recharge, element) | `src/lib/combat/loadoutSurvival.ts` + `damageContract.ts` | Mitigation reduces all incoming damage (capped 80%). Element match grants +15% resist. NOTE: no engine consumes `rechargeRate` — shield HP rises only via Shield Cell restores (roaming) / consumable pools (boss); the ARCHITECTURE claim of per-tick recharge predates the Chef and is not shipped behavior. |
| **Shield behaviors** (Nova / Absorb / Amp / Turtle) | `src/lib/combat/shieldBehaviors.ts` | Behavior definitions, tuning constants, rarity weights, and the boss pooled model live in the one module. Rolled by `shieldGenerator` into the item payload (`behavior`); resolved per-hit inside `damageContract.ts` for roaming, folded into `bossSimulator.ts` pools for boss fights. Legacy payloads without the field read as Standard and are never rewritten. |
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

### Cache box lane (migration 0037)
```
ChestScreen (the cache surface — the ONLY ad placement)
  → daily free box: one tap, no ad, no key
  → ad box: AdMob rewarded completion (Android only)
       → verifiedOps.makeItem({ payment: 'ad', adUnitId })   # the open call IS the attestation
  → key box: verifiedOps.makeItem({ payment: 'key' })
       → cc_make_item enforces ONE daily budget (cacheBoxDailyCap,
         default 10, UTC day): the first opening resolves FREE
         whatever was offered; openings past the cap are refused;
         the nonce ledger makes each opening exactly-once
       → opening recorded in cache_box_openings (payment + ad unit)
  → budget state: GET /api/caches/me (reads family, JWT only)
```
The pre-0037 rewarded-key claim (`cc_claim_rewarded_cache_key`,
3 keys/day + cooldown, ResourceBar plus button) is retired: the
function is dropped, the route unmounted, the client op deleted.

### Boss attempt
```
BossEncounterPanel (Fight workspace prep: boss intel + prepared consumables + risk)
  -> verifyBossFight(intent: boss/nonce/prepared set/risk)  # client sends intent only — no gear/skill payloads
  -> /api/verify-boss                              # route validates prep vs owned, enforces unlock + entry fee, derives loadout/skills from server records
  -> processBossAttempt()                          # Chef rolls outcome/loot/XP/credits/pity/unlocks/dedicated drops
  -> cc_apply_chef_boss_attempt()                  # profile/consumables/boss_state RPC (entry fee via migration 0011)
  -> syncBossAttemptResult()                       # client syncs returned canonical state, animates, LootMoment on victory
```
### Endless run (0028)
```
EndlessPanel (Fight workspace: chamber intel + belt prep + risk | run view | ended view)
  -> startEndlessRun(intent: nonce/prepared belt/risk)   # POST /api/endless/start
  -> cc_start_endless_run()                              # settles any active run (abandoned, death fraction), burns the belt, charges the recomputed fee, opens the run, takes the action slot
  -> advanceEndlessEncounter(intent: nonce)              # POST /api/endless/encounter — depth derived from the run row
  -> processEndlessEncounter()                           # Chef resolves vs the content-built def; escrow deltas + milestone drop
  -> cc_apply_endless_encounter()                        # escrows deltas; on death/cap ends the run and settles escrow from the row's own totals
  -> bankEndlessRun(intent: nonce)                       # POST /api/endless/bank -> cc_end_endless_run pays escrow in full, releases the slot
  -> syncEndlessResult() + activity.hydrate()            # client syncs profile/items; run state re-read from GET /api/endless/me
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

---

## 11. Roaming Variance + Visual Overhaul (migration 0023)

New sources of truth added by the overhaul slice — one owner each, no
duplicates:

| Domain | Owner |
|---|---|
| Roaming event tables, elite law, essence homes, signature materials, event EV model | `src/content/roamingEvents.ts` |
| Hot area (date-seeded rotation) | `src/content/hotArea.ts` |
| Offline cap law (earned tiers, limiter, 24h ceiling) | `src/content/offlineCap.ts` |
| Per-area visual identity (palettes, weather, animated props, boss arenas) | `src/content/areaPalettes.ts` |
| Segmented rigs + poses | `src/lib/pixel/rig.ts` (+ `PixelRigActor`) |
| Palette remap core | `src/lib/pixel/paletteSwap.ts` |
| Element FX dialects + shot cadence | `src/lib/pixel/elementFx.ts` |
| Shared visual grammar (G-1..G-6) + action set dressing | `src/lib/pixel/grammar.ts` |
| Weapon decals / condition / visual seed | `src/lib/weaponArt/decalSpec.ts` |
| Golden-image scenes + reference renderer | `src/test/golden/goldenScenes.ts`, `src/lib/pixel/sceneRenderer.ts` |

Rules that bind future work:

- Event/elite resolution happens ONLY in the Chef's claim engine on
  dedicated RNG streams (`:event`, `:elite`, `:signature`), so
  eventless claims stay bit-identical to pre-overhaul claims. Screens
  render `ClaimResult.eventsFired` / feed events; they never roll.
- Sprite production runs through `scripts/pixel-key.py` (new art) and
  `scripts/pixel-segments.py` (derived art: rig segments, layers,
  glyph props, vehicles, sets, golden PNG twins). The manifest
  (`src/assets/pixel/manifest.json`) stays the single sprite registry;
  anchors come from the production scripts, never per-screen tweaks.
- Golden baselines are generated from the built scenes and reviewed by
  Muse on regeneration (`npm run golden:update`); a diff fails CI.
