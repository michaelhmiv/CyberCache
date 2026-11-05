/**
 * roamingRates — the ONE owner of the roaming faucet's base rates.
 *
 * These are the code defaults the Chef settles with
 * (src/server/chef.ts: GEAR_THRESHOLD / KEY_CHANCE / MATERIAL_CHANCE)
 * and the same numbers the client displays on the roaming panel and
 * the area-picker stats strip. Before this module existed the Action
 * screen carried its own hardcoded copies — and its key-precursor
 * copy went stale (3%/tick displayed vs the 0.8%/tick the tuning
 * slice #208 shipped), promising the faucet at ~3.75× the real rate.
 *
 * Display contract: these are BASE rates. The Chef applies activity /
 * consumable / skill modifiers on top when settling, and the key
 * rate additionally sits behind the live economy lever
 * `cacheKeyChance` (src/server/economy/config.ts, whose code default
 * is CACHE_KEY_CHANCE below). Panels that show these numbers are
 * showing the base rate — never restate the literals anywhere else.
 */

/** Gear drop chance per roaming tick, before rare-drop modifiers. */
export const GEAR_DROP_CHANCE = 0.22;

/**
 * Cache KEY chance per roaming tick, before activity bonuses.
 * History (the faucet used to pay a fragment currency, 5 fragments
 * = 1 key): 0.03 fragments/tick at launch (minted ~7 keys/hour of
 * roaming) → pacing-baseline tuning cut it to 0.008 (~2 keys/hour).
 * Owner ruling 2026-11-04 (cache lane rebuild, migration 0082):
 * fragments are ABOLISHED and roaming pays whole keys directly at
 * 0.00012/tick (0.012%) — ~0.144 keys/hour, roughly 1 key per ~7
 * roaming-equivalent hours. The daily opening cap died the same
 * day, so scarcity lives entirely in supply, and the flat sources
 * (login streak day 7, the weekly contracts set bonus, weekly
 * leaderboard podiums, the jackpot legendary's guaranteed key)
 * become the primary way keys appear. Settlement is fractional with
 * a silent banked remainder — the same bookkeeping credits, scrap,
 * and XP claims use — so the long-run rate is exact and no
 * sub-key currency ever exists.
 */
export const CACHE_KEY_CHANCE = 0.00012;

/** Material find chance per roaming tick, before activity bonuses. */
export const MATERIAL_FIND_CHANCE = 0.08;
