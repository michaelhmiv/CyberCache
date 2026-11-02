# Bosses

Bosses are the game's named fights: **13 of them**, each with its own sprite, arena, mechanics, phases, weaknesses, and dedicated legendary drops. They are the main gear check, the main legendary chase, and — once roaming starts to feel safe — the main reason to keep building.

Boss fights occupy your personal action slot while they resolve (see [[Actions and Occupations]]), and the fight itself is a 30-second model of the loadout you bring — every decision happens at prep. How damage and survival are calculated is covered in [[Combat]].

## The ladder

You do not pick any boss you like from a menu. The ladder is sequential: **defeating a boss unlocks the next one.** The first boss, Dune Tyrant, is a level-5 tutorial fight; the ladder then climbs steadily to Vaultkeeper Omega at level 75. A boss's level is the level of the fight — its health, damage, and rewards are built for a hunter around that level.

The roster by band:

- **The early ladder (levels 5–15)** — Dune Tyrant (5), The Siltstalker (10), and Gromm, the Heap Guard (15). These teach the basics: reading a mechanic, bringing a counter element, surviving an enrage.
- **The middle ladder (levels 22–45)** — Ashgut (22), The Mirage Duster (28), The Rust Prophet (35), and Scrap Bishop (45). Phases and repair/shield mechanics start deciding fights here, and prep matters as much as raw DPS.
- **The high ladder (levels 50–65)** — Widow-9, the Spinneret (50), The Mnemosyne Mirror (55), The Static Choir (60), and The Verdant Maw (65). Expect adaptive and multi-phase fights that punish a one-note build.
- **The endgame (levels 70–75)** — Sister Null, the Void Anchor (70), and Vaultkeeper Omega (75). The last word, for now, in single-boss difficulty.

## Boss intel — and what it never shows

Before an attempt, prep shows you the boss itself: its stats, its mechanic, its phases and what each phase checks, its weaknesses and resistances, and the consumables it recommends bringing. Read it — a phase's failure reason tells you plainly what kind of build the phase is testing.

By design, prep **never shows a computed win chance, readiness score, or any odds figure about you**. That is a hard rule of the game, not a missing feature: the intel is the boss's facts, and judging whether your build is ready is your call. If a screen ever seems to be rating your chances, that is a bug — the game does not grade you.

What you bring is also yours to choose: your loadout, a prepared belt of consumables (burned by the attempt), a risk setting that trades survival margin against damage tempo and consumable use, and — if it is charged — your [[Combat|action skill]].

## The risk setting

Each attempt is fought at one of four risk settings, chosen at prep:

- **Conservative** — survival priced 20% higher and damage 5% lower; you burn more consumables. For first attempts on a boss you respect.
- **Balanced** — the default: no adjustment either way.
- **Greedy** — damage priced 5% higher and survival 10% lower; fewer safety consumables burned. For bosses you are farming, not fearing.
- **All In** — damage priced 15% higher and survival 20% lower, with the heaviest consumable burn. A statement of confidence, priced like one.

The setting changes how the fight is modeled, not the boss: the boss's stats, phases, and drops are identical at every setting. What changes is the margin you are choosing to fight with — pick it the way you pick a belt, on purpose, per boss.

## Fees

Every attempt costs an entry fee, charged win or lose. The first boss is free to attempt (rematch 100 credits); fees climb the ladder from there — 200 credits for The Siltstalker, up through 18,000 for a first attempt on Vaultkeeper Omega, with rematches priced a little higher than first entries.

**Rematch escalation:** each victory you score over a boss doubles that boss's next fee for the rest of the day (UTC), up to **8× the base fee**. Beating the same boss a fourth time today means the fifth attempt costs eight times the sticker price. The escalation resets at the day boundary, and the fee shown at prep is the fee you will be charged.

## Winning: XP, credits, and the dedicated drop

A victory pays:

- **XP equal to the boss's level × 50**, before your XP bonuses — a level-45 boss is worth 2,250 XP, which is why the ladder stays a real progression source under the long XP curve (see [[Progression]]).
- **Credits equal to the boss's level × 150**, before legendary-effect and other multipliers.
- **At least one guaranteed loot roll** at the boss's level, with chances at bonus rolls on top.
- **The next boss unlocked.**

The prize roll is the **dedicated drop**: the guaranteed roll has a **10% chance** to land on one of the boss's own named legendaries instead of a generic drop. Dedicated drops are generated at **the higher of the boss's level or your level**, so farming a favorite boss after you outlevel it still produces a weapon at your strength. Generic rolls stay at the boss's level. Each boss's dedicated pool is listed in its intel — if you want a specific named legendary, its boss is where it lives (see [[Legendary Effects]]).

Failed attempts are not pure loss over time: the game remembers your attempts against a boss, and repeated failures quietly improve your position until a victory lands. It will still never tell you the number.

## Losing, death, and resurrection

Losing an attempt costs the entry fee plus a **death fee**: a percentage of the credits you are currently carrying, rising by boss tier — 3% on the first tier, 5% on the second, 7% on the third, and 10% above that — capped at 2,500 / 10,000 / 25,000 / 50,000 credits by the same tiers. Carrying a fortune into a boss you cannot beat is expensive; bank accordingly.

Death in the open world is a different, heavier thing. Dying while roaming is recorded against you, and getting back up works like this:

- **Free resurrection** — wait out the timer: **5 minutes** from the death.
- **Paid resurrection** — skip the wait for **the unlock level of the area you died in × 100 credits**, capped at **50,000**. Dying in the level-1 Dustwaste Frontier costs 100 credits; dying in the level-25 HelixWorks Labyrinth costs 2,500.

Deaths inside [[Endless Mode]] are contained by that mode's own rules and never create an open-world death record — the Chamber's price for dying is paid there, in the run's payout.

---

_Source of truth: `src/constants/bosses.ts`, `src/lib/bossFees.ts`, `src/lib/combat/resurrectionCost.ts`, `src/server/routes/resurrect.ts`, `src/server/chef.ts`, `src/lib/simulation/bossSimulator.ts`, `docs/BOSS_ACTIVITY_ENFORCEMENT.md`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
