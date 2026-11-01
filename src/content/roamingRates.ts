/**
 * roamingRates — the ONE owner of the roaming faucet's base rates.
 *
 * These are the code defaults the Chef settles with
 * (src/server/chef.ts: GEAR_THRESHOLD / FRAGMENT_CHANCE / MATERIAL_CHANCE)
 * and the same numbers the client displays on the roaming panel and the
 * area-picker stats strip. Before this module existed the Action screen
 * carried its own hardcoded copies — and its fragment copy went stale
 * (3%/tick displayed vs the 0.8%/tick the tuning slice #208 shipped),
 * promising fragments at ~3.75× the real rate.
 *
 * Display contract: these are BASE rates. The Chef applies activity /
 * consumable / skill modifiers on top when settling, and the fragment
 * rate additionally sits behind the live economy lever `fragmentChance`
 * (src/server/economy/config.ts, whose code default is FRAGMENT_CHANCE
 * below). Panels that show these numbers are showing the base rate —
 * never restate the literals anywhere else.
 */

/** Gear drop chance per roaming tick, before rare-drop modifiers. */
export const GEAR_DROP_CHANCE = 0.22;

/**
 * Cache-key fragment chance per roaming tick, before activity bonuses.
 * Pacing-baseline tuning (lifecycle evaluation): 0.03 → 0.008 — the
 * launch rate minted ~7 keys/hour of roaming; fragments now trickle at
 * ~2 keys/hour while the jackpot legendary's guaranteed fragment and
 * the 5-fragments-per-key conversion are unchanged.
 */
export const CACHE_FRAGMENT_CHANCE = 0.008;

/** Material find chance per roaming tick, before activity bonuses. */
export const MATERIAL_FIND_CHANCE = 0.08;
