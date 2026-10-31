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
| `credits_minted_other` | Legacy idle claims (`cc_idle_claim`), legacy roaming claims (`cc_claim_roaming_rewards`), and new-account bundles (`cc_initial_bundle` — a flat 5,000-credit grant recorded as a literal in the function, so the meter counts rows × 5,000) |
| `credits_minted_vendor_buyback` | Vendor buyback payouts (`cc_vendor_sell` → `total_payout`, migration 0020). The vendor counter creates these credits, so they are a mint; gross vendor sink stays in `credits_destroyed_vendor` and the counter's net is the difference |
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
| `cache_keys_from_ads` | Rewarded-ad key claims (`cc_claim_rewarded_cache_key`) |
| `cache_opens` | Cache opens (`cc_make_item` + `cc_draw_item`) |
| `cache_fragments_awarded` | Σ `rewards.cache_fragments_awarded` over claim/settle/legacy-roaming rows. **Gap:** keys issued by fragment conversion are not separately attributable in ledger payloads — watch fragments awarded vs. opens instead |
| `craft_jobs_completed` | Craft jobs whose last unit completed that day (`craft_jobs.completed_at`, migration 0024) |
| `craft_units_completed` | Individual units settled that day (job outputs stamped with their completion instant) |
| `craft_xp_awarded` | Σ player XP paid by craft completions that day (the occupation faucet; compare against roaming XP to audit the 70–85% band) |
| `materials_destroyed_crafting` | jsonb by material id: escrow consumed at enqueue minus cancel refunds, netted per day from the craft ledger rows. This is the crafting sink — refining inputs and recipe inputs leave supply here |
| `refined_units_produced` | Refined/composite material units created by refine jobs that day (the sink's other side: 10 in → 8–10 out) |
| `gear_items_crafted` | `item_instances` created that day with `payload.origin = 'crafted'` (gear frames; never Legendary by construction) |
| `crafted_market_sales` / `crafted_market_volume` | Completed market sales whose listing was a crafted batch or a crafted-origin item, and Σ their prices — the crafter-economy pulse (specialization proof tracking) |

Transfers are not mints or sinks: a market sale's principal moves
buyer → seller (only the destroyed fee leaves supply), and service
job payments (`cc_item_job_finish`) move escrow → provider.

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

Skill-based fee reductions (Darknet Broker, Market Manipulator)
apply multiplicatively **after** the levered rate, in both the SQL
and TS paths.

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

## Watching for abuse: repair-board self-dealing (later slice)

The mechanics/repair slice will run an open job board, and the
self-dealing question (alts washing jobs to farm mechanic XP /
credits) is a **detection** problem, not new schema: repair
completions will land in the same verified ledger as everything
else. The detection query shape is: per provider, repair-job
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
