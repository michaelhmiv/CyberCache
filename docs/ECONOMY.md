# CyberCache Economy Operations

Meters and live tuning levers for the credit economy (migration
`0018_economy_observability.sql`). The economy's truth is the
`verified_action_ledger`: every credit that exists entered or left
through a ledger-recorded action, so the daily meters are a pure
recompute over the ledger plus `item_instances` — no separate
counters to drift.

## Meters

`POST /api/jobs/daily-heartbeat` (the existing 06:00 UTC cron) now
also recomputes **economy metrics for yesterday (UTC) plus the six
days before it** into `public.economy_metrics`, one row per UTC day.
Each day is a full recompute with an upsert, so re-running the
heartbeat — or backfilling after a missed day — is idempotent and
never double-counts. A metrics failure is reported in the heartbeat
response (`economyMetrics.error`) and never fails the snapshot job.

### Metrics dictionary

| Column | Meaning |
|---|---|
| `credits_minted_roaming` | Foreground roaming claims (`cc_apply_chef_rewards` → `rewards.credits_awarded`) |
| `credits_minted_boss` | Boss victories, **grossed up**: the ledger's `attempt.creditsGained` is already net of the entry fee, so the meter adds `entry_fee` back on victories |
| `credits_minted_offline` | Offline settlements (`cc_settle_offline_roaming` → `rewards.credits_awarded`; unsettled rows mint nothing) |
| `credits_minted_other` | Legacy idle claims (`cc_idle_claim`), legacy roaming claims (`cc_claim_roaming_rewards`), and new-account bundles (`cc_initial_bundle` — a flat 5,000-credit grant recorded as a literal in the function, so the meter counts rows × 5,000). From migration 0031 it also folds the Cache Rank Silver Tongue market uplift: Σ `market_fee.cache_rank_proceeds_bonus` over the day's `cc_accept_listing` rows (the uplift is minted to the seller; the fee share stays destroyed in `credits_destroyed_market_fees`) |
| `credits_minted_vendor_buyback` | Vendor buyback payouts (`cc_vendor_sell` → `total_payout`, migration 0020). The vendor counter creates these credits, so they are a mint; gross vendor sink stays in `credits_destroyed_vendor` and the counter's net is the difference |
| `credits_minted_login_streak` | Daily login-streak credit grants (Σ `credits_awarded` over `cc_login_streak_claim` rows, migration 0036). A real faucet — it folds into `credits_minted_total`. Sized small by design: a tier-1 week pays 1,900 credits ≈ 2 hours of baseline roaming (15 cr/min), spread over 7 days; the tier-5 ceiling week pays 5,700 |
| `credits_minted_contracts` | Contracts-board credit grants (Σ `credits_awarded` over `cc_claim_contract_reward` + `cc_claim_contract_set_bonus` rows, migration 0042). A real faucet — it folds into `credits_minted_total`, never into `_other`. Design budget: ≤ ~10% of daily mint — watch this column against `credits_minted_total`; a breach means contract rewards are out-pacing play and `contractRewardScalar` should come down |
| `contracts_claimed` | Contract claims per day (count of `cc_claim_contract_reward` rows; set-bonus rows are not claims) |
| `contracts_expired_unclaimed` | Instances whose window closed still `active`, counted on the window-end day (daily sets: period = day − 1; weekly sets: period = day − 7). The forfeiture meter — claims vs expiries is the board's completion pressure gauge |
| `contract_rerolls` | Rerolls per day (count of `cc_reroll_contract` rows, free and paid) |
| `contract_keys_awarded` | Cache keys paid by weekly full-set bonuses (Σ `cache_keys_awarded` over `cc_claim_contract_set_bonus` rows). Bounded by construction: ≤ 1/player/week at defaults |
| `scrap_destroyed_contract_rerolls` | Scrap destroyed by paid rerolls (Σ `scrap_charged` over `cc_reroll_contract` rows) — a sink, recorded on the reroll ledger row |
| `credits_minted_total` | Sum of the four sources |
| `credits_destroyed_market_fees` | The market sale fee destroyed on completed player sales (`cc_accept_listing` → `market_fee.fee_credits`; NPC sales are exempt and record 0) |
| `credits_destroyed_vendor` | NPC vendor purchases (`cc_vendor_buy` → `total_price`) |
| `credits_destroyed_resurrection` | Revive charges (`cc_resurrect` → `creditsCharged`) |
| `credits_destroyed_respec` | Skill retrains (`cc_retrain` → `total_price`) |
| `credits_destroyed_boss_entry_fees` | Every boss attempt's `entry_fee`, win or lose |
| `credits_destroyed_boss_death_fees` | Defeat charges beyond the entry fee (`attempt.creditsLost − entry_fee` on defeats) |
| `credits_destroyed_total` | Sum of the six sinks |
| `net_credit_change` | Minted total − destroyed total. Sustained large positives = inflation; watch this first |
| `legendaries_roaming` / `_boss` / `_cache` | Legendary `item_instances` created that day, by `payload.sourceTag` (`World Drop` / `Boss Drop` / `Cache-Forged`). Offline-generated drops carry `World Drop`, so they count as roaming. Event legendaries are in none of the three (and not in the total) |
| `market_listings_created` | `cc_market_create` rows |
| `market_sales` / `market_volume` | Completed sales (`cc_accept_listing`) and Σ sale price |
| `market_median_price` | Median sale price (`percentile_cont(0.5)`); `null` on a day with no sales |
| `market_median_by_rarity` | Same median per item rarity, as jsonb — the pricing baseline other systems compare against |
| `cache_keys_from_ads` | Rewarded-ad key claims (`cc_claim_rewarded_cache_key`). **Legacy since 0037:** the claim function is dropped and no new rows are written; the fold survives so pre-lane history keeps counting |
| `cache_boxes_opened_free` | Cache openings resolved free that day (`cc_make_item` rows with `result_payload.payment = 'free'`, migration 0037) — the daily free box |
| `cache_boxes_opened_ad` | Cache openings paid by a watch-ad attestation (`payment = 'ad'`, migration 0037) |
| `cache_boxes_opened_key` | Cache openings paid with a key (`payment = 'key'`, migration 0037). Pre-0037 `cc_make_item` rows carry no payment and count here — every historical opening was key-paid (or the free box, indistinguishable in the old payload) |
| `cache_keys_from_leaderboards` | Cache keys paid by weekly-leaderboard settlement (Σ `cache_keys_awarded` over `cc_leaderboard_settlement` rows, migration 0035). A deliberate separate mint from the ad lane: since 0037 the lane is a budget of OPENINGS (free/key/ad), not a cap on any key source — leaderboard keys simply join the stock and buy ad-free openings inside it. Keys are not credits — this meter never enters the minted/destroyed totals. Ceiling by construction: 4 races/week × 6 podium keys = 24 keys/week across the whole player base |
| `cache_keys_from_login_streak` | Cache keys paid by the daily login streak (Σ `cache_keys_awarded` over `cc_login_streak_claim` rows, migration 0036). A third deliberate key source, metered distinctly from the ad lane and from leaderboard keys: one key per completed 7-day cycle, never scaled by tier — ceiling by construction: ≤1 key/week/player |
| `cache_fragments_from_login_streak` | Cache fragments paid by the daily login streak (Σ `fragments_awarded` over `cc_login_streak_claim` rows, migration 0036). Metered as its own source rather than folded into `cache_fragments_awarded`, which stays the roaming/offline claim fold. A tier-1 week pays 9 fragments ≈ 1 hour of roaming fragment drops (0.008/tick) |
| `research_enrollments_started` | Course enrollments started that day (count of `cc_enroll_research` rows, migration 0038). One active enrollment per player, so this is also the count of players who committed credits to the education track that day |
| `research_courses_completed` | Course completions settled that day (count of `cc_research_complete` rows, migration 0038). Settlement is lazy (read-triggered), so a completion lands on the day it is first observed at/after its completes_at — the count is exact, the day attribution follows observation |
| `research_credits_destroyed` | Enrollment fees destroyed that day (Σ `cost_credits` over `cc_enroll_research` rows, migration 0038). Research is the game's largest structured credit sink: 310,000 cr across the 12-course catalog (77,500 per faculty), charged and destroyed at enroll — completion pays nothing back and cancel refunds nothing, so the sink lands exactly once per enrollment. Folds into `credits_destroyed_total` |
| `standing_points_awarded` | jsonb `{turn_in: {manufacturer: points}, drip: {manufacturer: points}}` (migration 0043). Turn-in points fold from `cc_turn_in_item` ledger rows; drip points fold from the `manufacturer_standing_daily` counter table (the accrual writes no per-claim ledger rows by design). Standing is reputation, not currency — it never folds into the credit totals; this meter exists to watch earn rates per ladder (a ladder out-earning the others is a content signal, not an economy bug — R6 keeps the ladders independent) |
| `standing_items_destroyed` | Items destroyed at the Rep Desk that day: `cc_turn_in_item` rows + tribute items on `cc_rank_up_manufacturer` rows. Deliberately separate from `legendaries_salvaged` — a turned-in Legendary mints NO cores and pays NO scrap, so it must never enter the salvage meters |
| `standing_tribute_credits_destroyed` | Rank-up tribute credits destroyed that day (Σ `tribute_credits` over `cc_rank_up_manufacturer` rows, migration 0043). 410,000 cr per full ladder at scalar 1.0 (R7). A component of `standing_credits_destroyed`; folds into `credits_destroyed_total` |
| `standing_credits_destroyed` | All Rep Desk credit destruction that day: tributes + `cc_standing_buy` + `cc_standing_order_weapon` totals. Folds into `credits_destroyed_total` (the tribute component is NOT double-counted — it is inside this total, with `standing_tribute_credits_destroyed` as its breakout) |
| `standing_orders_fulfilled` | Signature Orders persisted that day (count of `cc_standing_order_weapon` rows, migration 0043). Hard-bounded by design: ≤ 6/week/player (one per manufacturer per ISO week, rank 5 only) |
| `standing_rank_ups` | jsonb by manufacturer: rank grants that day (count of `cc_rank_up_manufacturer` rows grouped by `manufacturer`, migration 0043) |
| `cache_opens` | Cache opens (`cc_make_item` + `cc_draw_item`) |
| `cache_fragments_awarded` | Σ `rewards.cache_fragments_awarded` over claim/settle/legacy-roaming rows. **Gap:** keys issued by fragment conversion are not separately attributable in ledger payloads — watch fragments awarded vs. opens instead |
| `craft_jobs_completed` | Craft jobs whose last unit completed that day (`craft_jobs.completed_at`, migration 0024) |
| `craft_units_completed` | Individual units settled that day (job outputs stamped with their completion instant) |
| `craft_xp_awarded` | Σ player XP paid by craft completions that day (the occupation faucet; compare against roaming XP to audit the 70–85% band) |
| `materials_destroyed_crafting` | jsonb by material id: escrow consumed at enqueue minus cancel refunds, netted per day from the craft ledger rows. This is the crafting sink — refining inputs and recipe inputs leave supply here |
| `extraction_passes` | Extraction passes finalized that day (Σ `passes_completed` over `cc_apply_extraction` ledger rows, migration 0033) |
| `extraction_xp_awarded` | Σ player XP paid by extraction passes that day (the second occupation faucet; audit against `craft_xp_awarded` and roaming XP for the 0.75 peg) |
| `materials_minted_extraction` | jsonb by material id: units minted by extraction finds that day, aggregated per id across the payload's `finds_materials` and `finds_essences` (disjoint id spaces). The mint mirror of `materials_destroyed_crafting` — the supply side of the crafter economy |
| `refined_units_produced` | Refined/composite material units created by refine jobs that day (the sink's other side: 10 in → 8–10 out) |
| `gear_items_crafted` | `item_instances` created that day with `payload.origin = 'crafted'` (gear frames; never Legendary by construction) |
| `crafted_market_sales` / `crafted_market_volume` | Completed market sales whose listing was a crafted batch or a crafted-origin item, and Σ their prices — the crafter-economy pulse (specialization proof tracking) |
| `repair_jobs_posted` | Repair-board jobs posted that day (migration 0025; counted at posting) |
| `repair_jobs_completed` | Repair jobs reaching a terminal settlement that day (`service_jobs.completed_at`) |
| `repair_points_restored` | Σ condition points actually restored by board jobs settled that day (the work the XP prices) |
| `repair_credits_volume` | Σ gross service payouts (paid part only; refunds never move) |
| `repair_fees_destroyed` | Σ service fees destroyed at settlement — these also fold into `credits_destroyed_total` |
| `repair_kits_consumed` | Patch kits burned that day across BOTH lanes (board jobs + timed self-repair units) |
| `repair_xp_awarded` | Σ player XP paid by board settlements (2/point restored at the default lever) |
| `legendaries_salvaged` | Legendary items destroyed by salvage that day (`cc_recycle_item` rows whose result item is Legendary). A DESTRUCTION meter — deliberately separate from the `legendaries_*` creation meters above; a legendary is counted once at creation (by source) and once here when it dies, never twice in the same meter |
| `legendary_cores_minted` | Σ `cores_award` over the day's `cc_recycle_item` rows — cores enter supply only when a Legendary is salvaged (migration 0026) |
| `legendary_cores_spent` | Σ `escrow_cores` over the day's `cc_enqueue_craft_job` rows − Σ `cores_refunded` over the day's `cc_cancel_craft_job` rows + Σ `cores_charged` over the day's `cc_reforge_item` rows (migration 0027) — cores that left player balances for a spend: catalyst escrows (held, refundable on cancel) plus reforge charges (destroyed outright). Each core is counted exactly once; the reforge share is broken out in `legendary_cores_destroyed_reforge` below |
| `reforges_completed` | Count of the day's `cc_reforge_item` rows (migration 0027) |
| `scrap_destroyed_reforge` | Σ `scrap_charged` over the day's `cc_reforge_item` rows — scrap destroyed by reforge (a scrap meter, never a credits meter: it does not enter `credits_destroyed_total`) |
| `legendary_cores_destroyed_reforge` | Σ `cores_charged` over the day's `cc_reforge_item` rows — the destroyed share of `legendary_cores_spent`, broken out so the reforge sink reads separately from catalyst escrow |
| `endless_runs_started` | Count of the day's `cc_start_endless_run` rows (migration 0028) |
| `endless_runs_ended` | Runs ended that day: `cc_end_endless_run` rows with `ended` true + `cc_apply_endless_encounter` rows whose `run_status` closed the run (`died` / `banked` at the depth cap). Abandoned runs end inside a start row and are counted in `endless_deepest_depth` / payouts but have no separate ending row |
| `endless_encounters_cleared` | Count of the day's victorious `cc_apply_endless_encounter` rows |
| `endless_deepest_depth` | Deepest `depth_reached` among runs ENDED that day (bank rows, closing encounter rows, and `abandoned_settlement` payloads inside start rows) |
| `endless_credits_paid` | Σ run-end payouts (`payout.credits` on end/encounter rows + `abandoned_settlement.payout.credits` on start rows). A real faucet: folds into `credits_minted_total` |
| `endless_xp_paid` | Same shape for XP — metered here only (XP is not a credits meter) |
| `endless_fees_destroyed` | Σ `entry_fee` over the day's `cc_start_endless_run` rows — destroyed at entry; folds into `credits_destroyed_total` |
| `endless_milestone_drops` / `endless_milestone_drops_by_rarity` | Count of milestone drops recorded on the day's encounter rows, total and as a rarity → count map |
| `cache_rank_tokens_granted` | Σ `tokens_granted` over the day's `cc_cache_rank_grant` rows (migration 0031) — level-derived grants only; the watermark + ledger key make replays invisible here (a replay inserts no row) |
| `cache_rank_tokens_spent` | Σ `cost` over the day's `cc_cache_rank_spend` rows — the token sink; lifetime granted − spent should track Σ `profiles.cache_rank_tokens` |

Transfers are not mints or sinks: a market sale's principal moves
buyer → seller (only the destroyed fee leaves supply), and repair
service payments (migration 0025) move escrow → mechanic the same
way — owners escrow the full price at posting, completion pays in
full, every other terminal state pays pro-rata for points actually
restored, and the shared market fee is destroyed from the paid part
(Darknet Broker's reduction applies; Market Manipulator's does not —
no item changes hands). The dormant 0004 `cc_item_job_finish` flow
is deleted.

### Price intelligence (migration 0019)

The daily `market_median_by_rarity` above covers gear sales only
(it keys off the sold item's rarity). Per-item pricing truth for
every listing kind lives in the price-stats fold
(`src/lib/market/priceStats.ts`, served at
`GET /api/market/price-stats?keys=…` to signed-in players): sales
group by the identity key stamped on each listing at creation —
gear: type/category + rarity + 10-level band; consumables: type +
quality band; materials: the material id — and compare on UNIT
price (listing price ÷ quantity), so stack sizes never distort a
median. The same fee (`marketFeeRate` lever + skill reductions)
applies to consumable and material sales; their completions land in
the same ledger rows, so the meters above count them unchanged.

## Levers

Live values live in `public.economy_config` (key → jsonb value).
Every change goes through `cc_set_economy_config`, which upserts the
value and appends the old/new pair to the append-only
`public.economy_config_history`. TypeScript consumers read through
the ONE accessor, `src/server/economy/config.ts` (`EconomyConfig`,
≤60 s in-memory cache — a change lands within a minute, no
redeploy). A key with no row resolves to its code default; a stored
value that fails validation is ignored; a database read failure
serves the last good snapshot or the defaults — config can never
take the game down.

| Key | Default | Safe range | Consumers |
|---|---|---|---|
| `marketFeeRate` | 0.05 | 0 – 1 | `cc_accept_listing` reads the table itself (`cc_economy_config_number('marketFeeRate', 0.05)`, clamped 0..1); the TS mirror (`src/lib/market/marketFee.ts`) takes the rate from the accessor-driven provider where wired |
| `bossDedicatedChance` | 0.10 | 0 – 1 | Verify-boss route stamps it onto `BossAttemptRequest.economy`; the Chef uses it over `BOSS_DEDICATED_DROP_CHANCE` |
| `fragmentChance` | 0.008 | 0 – 1 | Claim + settle-offline routes stamp it onto `ClaimRequest.economy`; the Chef uses it over `FRAGMENT_CHANCE` (activity bonuses still multiply on top) |
| `rematchEscalationCap` | 8 | 1 – 64 (integer) | Verify-boss route passes it to `escalatedBossFee` — **the charged fee is the truth**. Client prep-panel displays use the shipped default (×8) and are advisory only |
| `roamingLegendaryScalar` | 1.0 | 0 – 5 | Claim + settle-offline routes stamp it onto `ClaimRequest.economy`; the Chef multiplies the Legendary entry of the area's `dropPoolRarityWeights` on a copy at roll time. The area tables are constants and are never edited |
| `vehicleYieldScalar` | 1.0 | 0 – 3 | Claim + settle-offline routes stamp it onto `ClaimRequest.economy`; the Chef multiplies the equipped vehicle's yield bonus by it (`1 + (baseYield − 1) × (1 + yieldAffixPct) × conditionFraction × vehicleYieldScalar`). 0 parks every vehicle at ×1.0 without touching the class table in `src/lib/vehicles/vehicles.ts` |
| `vendorBuybackRate` | 0.4 | 0 – 0.9 | `cc_vendor_sell` reads the table itself (`cc_economy_config_number('vendorBuybackRate', 0.4)`, clamped 0..0.9); the TS mirror (`src/server/writes/memory.ts`) takes the rate from a provider where wired. The catalog it pays against is `src/lib/vendor/catalog.ts` (SQL twin `cc_vendor_catalog`, migration 0020) |
| `craftXpRate` | 0.775 | 0.70 – 0.85 (**hard band**: validation clamps into it; the occupation law's crafting-vs-roaming XP ratio can never leave 70–85% via config) | Craft settlers (`cc_settle_craft_jobs` via `cc_craft_unit_xp`; TS twin `src/content/crafting.ts` `craftUnitXp`) — read live at each unit's completion |
| `craftTimeScalar` | 1.0 | 0.5 – 2.0 | Craft enqueue (SQL + TS twin) — snapshotted into each job's unit duration at enqueue |
| `craftQualityShift` | 0 | −10 – +10 | Quality bounds at completion (`cc_craft_quality_bounds`; TS twin `craftQualityBounds`) — shifts both bounds |
| `gearTemperBaseChance` | 0.05 | 0 – 0.30 | Gear-frame completion (temper draw count) — +0.01 per gear-mastery level from the same formula, read live at completion |
| `refineBaseYield` | 0.80 | 0.50 – 1.00 | Refine completion — yield rate = base + 0.004 × refining mastery level (cap 1.00), read live at completion |
| `repairWorkRateBase` | 20 | 1 – 200 | Repair work rate (condition points/hour at mastery 1) — snapshotted into self-repair unit durations at enqueue and board-job snapshots at accept (migration 0025) |
| `repairMasterySpeedPerLevel` | 0.02 | 0 – 0.1 | Work-rate multiplier per repair-mastery level above 1 (speed factor caps ×2.0); snapshotted with the rate |
| `repairMasteryEfficiencyPerLevel` | 0.02 | 0 – 0.1 | Per-kit restoration multiplier per repair-mastery level above 1 (caps ×1.5); snapshotted with the rate |
| `serviceXpPerPoint` | 2 | 0 – 10 (integer) | Player XP per condition point actually restored on board jobs, paid once at settlement (partial jobs included) |
| `repairAbandonWindowHours` | 48 | 1 – 720 (integer) | Owner reclaim window: an accepted job with no progress for this long can be reclaimed (settles pro-rata, outcome `abandoned`) |
| `repairListingExpiryDays` | 7 | 1 – 30 (integer) | Unaccepted board listings expire and refund in full after this many days |
| `reforgeScrapScalar` | 1.0 | 0 – 5 | Multiplier on the reforge scrap cost (salvage value × 3 × scalar; migration 0027). `cc_reforge_item` reads the table itself (`cc_economy_config_number('reforgeScrapScalar', 1)`); the TS pricing mirror is `src/content/reforge.ts` `reforgeCostFor`, fed live values through a provider where wired |
| `reforgeLegendaryCoreCost` | 2 | 0 – 8 (integer) | Flat legendary cores charged when reforging a Legendary-rarity item (0027); other rarities never pay cores |
| `endlessHpGrowth` | 1.12 | 1 – 1.5 | Endless enemy health/shield/armor multiplier per depth, compounding (0028); rules owner `src/content/endless.ts` |
| `endlessDpsGrowth` | 1.10 | 1 – 1.5 | Endless enemy DPS multiplier per depth, compounding (0028) |
| `endlessXpPerLevel` | 6 | 0 – 50 | Escrow XP per endless encounter, per encounter level (before the +4%/depth reward growth) — vs a boss victory's 50/level for a discrete fee-charged attempt |
| `endlessCreditsPerLevel` | 22 | 0 – 200 | Escrow credits per endless encounter, per encounter level — vs a boss victory's 150/level gross |
| `cacheBoxDailyCap` | 10 | 1 – 30 (integer) | Cache lane (0037): total Data-Cache openings per player per UTC day, the free box included. `cc_make_item` reads the table itself (`cc_economy_config_number('cacheBoxDailyCap', 10)`, clamped 1..30); the TS mirror is `src/content/cacheLane.ts`, with the in-memory write/read twins taking the value through providers where wired. The free count (1/day) is a rule, not a lever |
| `endlessScrapPerLevel` | 0.5 | 0 – 10 | Escrow scrap per endless encounter, per encounter level |
| `endlessRewardDepthGrowth` | 0.04 | 0 – 0.25 | Additive per-depth growth on per-encounter escrow rewards |
| `endlessDeathPayoutFraction` | 0.5 | 0 – 1 | Fraction of escrow paid when an endless run ends in death (or abandonment at re-entry); banking pays 1.0. `cc_apply_endless_encounter` / `cc_start_endless_run` read the table themselves |
| `endlessEntryFeePerLevel` | 10 | 0 – 100 | Endless entry fee base, per player level; doubled per run started today (UTC) up to `endlessFeeEscalationCap`. `cc_start_endless_run` recomputes and charges its own figure |
| `endlessFeeEscalationCap` | 8 | 1 – 64 (integer) | Cap on the endless entry-fee escalation multiplier |
| `endlessMilestoneLegendaryPerDepth` | 0.10 | 0 – 1 | Milestone-drop Legendary rarity-weight growth per depth (weight multiplier 1 + rate × depth, capped ×10) |
| `endlessMilestoneEpicPerDepth` | 0.05 | 0 – 1 | Milestone-drop Epic rarity-weight growth per depth (multiplier capped ×5) |
| `endlessMaxDepth` | 250 | 10 – 1000 (integer) | Hard endless depth cap — reaching it banks the run in full (anti-pathology valve) |
| `cacheRankTokensPerLevel` | 1 | 0 – 3 (integer) | Cache Rank tokens per level gained (0031); entitlement is recomputed from the watermark, so a raise never re-pays old levels |
| `cacheRankMilestoneBundleBase` | 5 | 0 – 25 (integer) | Cache Rank bundle at the first milestone (L10); bundle at milestone k = base + step × (k − 1) |
| `cacheRankMilestoneBundleStep` | 5 | 0 – 25 (integer) | Growth between milestone bundles (defaults give +5/+10/+15/+20/+25 at L10/25/50/75/100; total earnable at defaults = 174) |
| `cacheRankCostBase` | 1 | 1 – 10 (integer) | Cache Rank cost of a track's first ranks: cost(next at r) = round(base + growth × floor(r / 2)) |
| `cacheRankCostGrowth` | 1 | 0 – 2 | Cost growth per rank pair (defaults: 1,1,2,2,3,3,4,4,5,5 = 30/track; full menu 210 > 174 earnable) |
| `cacheRankCreditsPerRank` | 0.01 | 0 – 0.02 | Greed: +credits earn fraction per rank (×10 ranks = +10% max), multiplied LAST in the Chef rates |
| `cacheRankXpPerRank` | 0.01 | 0 – 0.02 | Fast Learner: +XP fraction per rank — Chef rates + craft/repair completion XP in both twins |
| `cacheRankScrapPerRank` | 0.01 | 0 – 0.02 | Salvage Hound: +scrap fraction per rank |
| `cacheRankDamagePerRank` | 0.005 | 0 – 0.01 | Heavy Hand: +damage fraction per rank (+5% max) — Chef derived DPS + the boss sim seam |
| `cacheRankMaxHpPerRank` | 0.01 | 0 – 0.02 | Thick Skin: +max HP fraction per rank (+10% max) on base HP only; shield HP is never scaled |
| `cacheRankCacheQualityPerRank` | 0.02 | 0 – 0.04 | Cache Optimizer: +cache quality per rank (+0.20 max) — non-minimum rarity weights × (1 + q) in `cc_make_item` + the TS draw twin; shares the lane with the `cacheQuality` skill effect |
| `cacheRankMarketProceedsPerRank` | 0.005 | 0 – 0.01 | Silver Tongue: +fraction of POST-FEE proceeds per rank (+5% max), minted to the seller in `cc_accept_listing` + the TS fee mirror; NPC listings exempt |
| `streakCreditScalar` | 1.0 | 0 – 3 | Scalar on every daily login-streak credit grant (0036). `cc_record_login_streak_day` reads the table itself (`cc_economy_config_number('streakCreditScalar', 1)`, clamped 0..3, floored after scaling); the content owner is `src/content/loginStreak.ts`. 0 turns streak credits off without touching the ladder |
| `streakFragmentScalar` | 1.0 | 0 – 3 | Scalar on every daily login-streak fragment grant (0036); same read pattern as `streakCreditScalar`. The day-7 cache key is NOT scaled by any lever — it stays 1 per completed cycle by construction |
| `contractRewardScalar` | 1.0 | 0 – 2 | Contracts board (0042): scalar on every contract credit/fragment reward AND the full-set bonuses. Priced AT ISSUANCE into the instance's frozen `reward` (the set bonus prices at claim); a later move never reprices an issued contract. `cc_contract_terms` / `cc_claim_contract_reward` read it via `cc_economy_config_number('contractRewardScalar', 1)`, clamped 0..2, fragments floored after scaling; the content owner is `src/content/contracts.ts` |
| `contractTargetScalar` | 1.0 | 0.5 – 2 | Contracts board (0042): scalar on every contract target, priced at issuance into the frozen instance. Same read pattern (`cc_economy_config_number('contractTargetScalar', 1)`, clamped 0.5..2) |
| `contractDailyCount` | 3 | 1 – 5 (integer) | Contracts board (0042): contracts on the daily board. Read by `cc_issue_contracts` at issuance (clamped 1..5) |
| `contractWeeklyCount` | 5 | 1 – 8 (integer) | Contracts board (0042): contracts on the weekly board. Read by `cc_issue_contracts` at issuance (clamped 1..8) |
| `contractRerollScrapDaily` | 100 | 0 – 1,000 (integer) | Contracts board (0042): scrap DESTROYED by a non-free daily reroll (the first reroll per set is free). Read by `cc_reroll_contract` (clamped 0..1000); the destruction meters as `scrap_destroyed_contract_rerolls` |
| `contractRerollScrapWeekly` | 400 | 0 – 5,000 (integer) | Contracts board (0042): scrap DESTROYED by a non-free weekly reroll. Read by `cc_reroll_contract` (clamped 0..5000) |
| `contractWeeklyKeys` | 1 | 0 – 3 (integer) | Contracts board (0042): cache keys in the weekly full-set bonus — the contracts system's ONLY key source, hard-bounded by the weekly cadence (≤ 3/week at the clamp ceiling, 1 at default). Read by `cc_claim_contract_reward` (clamped 0..3); meters as `contract_keys_awarded` |
| `researchDurationScalar` | 1.0 | 0.5 – 2 | Research (0038): multiplies catalog course durations AT ENROLL ONLY — the result snapshots into the enrollment, so moving the lever never moves a running course. `cc_enroll_research` reads the table itself (`cc_economy_config_number('researchDurationScalar', 1)`, clamped 0.5..2); the content owner is `src/content/research.ts` |
| `researchCostScalar` | 1.0 | 0.5 – 3 | Research (0038): multiplies catalog course costs AT ENROLL ONLY (floored, snapshotted, destroyed at enroll). Same read pattern as `researchDurationScalar`. No lever touches an unlock magnitude — those are content, like skill node values |
| `standingScrapDivisor` | 10 | 2 – 50 | Manufacturer Standing (0043): turn-in award divisor — standing = round(item scrap value / divisor), minimum 1. Read by `cc_turn_in_item` via `cc_economy_config_number('standingScrapDivisor', 10)`, clamped 2..50; the content owner is `src/content/manufacturerStanding.ts` |
| `standingPerKill` | 1 | 0 – 10 | Manufacturer Standing (0043): use-drip points per recorded kill with that manufacturer's weapon equipped as primary (foreground claims AND offline settlement). Read by `cc_accrue_manufacturer_standing` (default 1); points floor per accrual |
| `standingDripDailyCap` | 100 | 0 – 1,000 (integer) | Manufacturer Standing (0043): per-manufacturer daily cap on drip points (UTC day). Turn-ins are uncapped; this caps only the passive drip, so the 25,000-point rank-5 threshold stays a long road (~127 days of maxed drip alone at defaults, before turn-ins) |
| `standingTributeScalar` | 1.0 | 0 – 3 | Manufacturer Standing (0043): multiplies rank-up tribute credit costs (rounded at charge). Read by `cc_rank_up_manufacturer`. The item tributes (Rare+/Epic+ items at ranks 3–5) are content, never levered |
| `standingOrderPrice` | 150,000 | 0 – 10,000,000 (integer) | Manufacturer Standing (0043): Signature Order price, destroyed at order. Read by `cc_standing_order_weapon` (clamped 0..10,000,000) |
| `standingOrderEnabled` | 1 | 0 – 1 (integer) | Manufacturer Standing (0043): Signature Order kill switch. 0 refuses new orders server-side; standing, ranks, and every other desk op are unaffected |

Skill-based fee reductions (Darknet Broker, Market Manipulator)
apply multiplicatively **after** the levered rate, in both the SQL
and TS paths. Service payments (0025) take the Darknet Broker
reduction only — no item changes hands, so Market Manipulator does
not apply.

## Pulling a report / moving a lever

Both endpoints sit behind the same `x-chef-job-secret` gate as the
job routes and are not mounted when `CHEF_JOB_SECRET` is unset.
They are operator surface only — never player-visible, no client UI.

```bash
# Last 14 days of metrics + effective lever values (days: 1..90)
curl -s https://chef-production.up.railway.app/api/admin/economy?days=14 \
  -H "x-chef-job-secret: $CHEF_JOB_SECRET"

# Move one lever (validated; unknown keys and out-of-range → 400)
curl -s -X POST https://chef-production.up.railway.app/api/admin/economy/config \
  -H "x-chef-job-secret: $CHEF_JOB_SECRET" \
  -H 'content-type: application/json' \
  -d '{"key": "marketFeeRate", "value": 0.08}'
```

The response echoes the full effective config after the write. For
history: `select * from public.economy_config_history order by changed_at desc;`

## Watching for abuse: repair-board self-dealing (live, migration 0025)

The repair board is live, and per Michael's ruling self-dealing is
NOT blocked upfront (same-account self-accept is refused; alts are
a **detection** problem, not new schema): repair completions land
in the same verified ledger as everything else, and the repair
meters above make wash volume visible per day. The detection query
shape is: per provider, repair-job
completions grouped by counterparty — flag providers whose volume
concentrates on one or two counterparties, whose charged prices sit
far from the day's `market_median_by_rarity`-style medians for
comparable work, or whose completion cadence is machine-regular.
The meters in this doc provide the economy-wide baselines those
deviations are measured against. No new tables are needed when the
repair slice lands.

## Roaming-variance levers (migration 0023, visual overhaul slice)

The roaming event system (§2 of the overhaul brief) is economy
surface and rides the same lever registry:

| Lever | Default | Range | Meaning |
|---|---|---|---|
| `eventChanceBase` | 0.05 | 0..0.15 | Per-tick roaming event roll. 0 silences events. Hard ceiling = the brief's 15% clamp. |
| `eventValueBudgetPct` | 0.08 | 0..0.5 | The anti-leak budget the event tables were authored against: expected event value per tick ≤ this fraction of a plain tick's value (`eventValuePerTick` vs `plainTickValue` in `src/content/roamingEvents.ts`, asserted in tests). |
| `hotAreaMaterialBonus` | 0.2 | 0..1 | Extra material-find chance in the day's hot area. |
| `eliteEscalationChance` | 0.12 | 0..1 | Chance an elite rotating into the kill cycle escalates into the area's named elite (HP ×3, Epic-floor drop). |
| `hotAreaYieldBonus` | 0.1 | 0..1 | Yield bonus in the hot area (danger also ×1.15 — a code constant, `HOT_AREA_DANGER_MULTIPLIER`). |
| `absoluteOfflineCapHours` | 24 | 1..24 (int) | The AFK ceiling: effective cap = min(earned tier + keystone, user limiter, this). |

Deliberately NOT levers: `lootBeaconEventBonus` / `scannerEventBonus`
(their sources of truth are the consumable defs and vehicle affix
rolls the Chef already reads) and `eliteRarityFloor` (an enum —
Epic — not a number; it lives in `roamingEvents.ts` as a constant).
Fragments gained a second faucet from events (cache finds, storm
doubling, elite bonus); the combined rate is band-tested in
`src/test/overhaulMechanics.test.ts`.

## Legendary cores (migration 0026, collections slice)

Cores are the sink-loop currency for duplicate/unwanted legendaries:
they are minted ONLY by salvaging Legendary gear and are priced to
stay scarce.

**Yield** (`legendaryCoreYieldFor` in `src/content/collections.ts`;
the SQL inside `cc_recycle_item` mirrors it and parity tests pin the
two): 1 base for any Legendary, +1 at item level 25, +1 at item
level 50, +1 for a weapon carrying a legendary effect — range 1–4.
Nothing multiplies cores: Market Crash's 4× and the Scavenger
salvage skills are SCRAP economy (their defs say "scrap value"), and
they compose with the core yield by leaving it untouched.

**Scarcity math:** roaming legendary weights were cut to ×0.1 in the
tuning slice, so legendaries arrive slowly; a low-level non-weapon
legendary — the common salvage — yields exactly 1 core, and even the
single most valuable salvage in the game (a level-50+ effect weapon)
yields 4. Core-priced spends are denominated in whole cores per unit
(the crafting catalyst below; reforge next), so every spend costs at
least one whole legendary.

**Spends in this slice:** the Legendary Core Catalyst — gear-frame
craft jobs escrow 1 core per unit at enqueue (Forge/bench 2+,
mutually exclusive with the material catalyst) and each completed
unit generates with +2 draws (best-of-N rollQuality, the gear
system's quality currency — the same lever tempering uses). Cancels
refund escrowed cores on the material catalyst's schedule (full for
unstarted units, half floored for the in-progress unit).

**Reforge (migration 0027)** is the second core spend and the first
outright destruction: rerolling one affix on a Legendary costs
2 cores (lever `reforgeLegendaryCoreCost`) plus scrap priced at
three times the item's salvage value (lever `reforgeScrapScalar`;
non-legendary reforge is scrap-only). At the modal salvage yield
(2–3 cores for a mid/high-level legendary), one legendary reforge
costs roughly one salvaged legendary — the loop stays tight by
construction. The rules live in `src/content/reforge.ts`; both
currencies are destroyed on use and metered above.

**Watch:** `legendary_cores_minted` vs `legendary_cores_spent` per
day, and the minted/salvaged ratio (average yield per destroyed
legendary should sit between 1 and 4 — outside that band, something
is mis-attributing).
