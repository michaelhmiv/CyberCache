# Endless Mode

Endless Mode — the **Chaos Chamber** — is the post-campaign proving ground: an unbounded descent of encounters that get stronger every depth until your build meets its wall. There is no final depth to clear (a hard cap exists at depth 250 as a safety valve, and reaching it simply banks your run in full). The mode's whole game is one decision, repeated: **push deeper, or bank now?**

A run occupies your personal action slot for its entire duration — starting one means your hunter is in the Chamber, not roaming, crafting, or extracting (see [[Actions and Occupations]]). You will need to be alive to enter: a standing open-world death must be resolved first (see [[Bosses]]).

## How a run works

A run is anchored at your level when you enter. Encounter levels rise by one per depth: depth 1 is fought at your entry level, depth 10 at entry level + 9, and so on.

- **Most depths are war packs** — roaming-elite encounters dressed in a rotating area, priced at a fraction of a boss's strength (35% of the par boss's health pool, 45% of its damage).
- **Every 5th depth is a boss-tier encounter** wearing a shipped boss's kit — its mechanic, phases, weaknesses, and resistances — floored at the strength of the strongest boss at or below your anchor level, so a boss depth is always a genuine spike over the packs around it.
- **You may swap gear between encounters.** Each encounter is priced against the loadout you currently hold, so adjusting your build mid-run for the next boss depth is legitimate play.
- **Your prepared consumable belt is committed once, at entry**, and burned there. The run is one attempt; its encounters are phases. Unlike boss fights, you do not re-pay the belt per encounter — and the reward rates below are priced with that in mind.

Like [[Bosses|boss prep]], the Chamber's prep shows you the run's facts — scaling rates, first-encounter and first-boss vitals, reward rates, the fee schedule — and never a readiness figure or win chance for you.

## The escalation

Two compounding curves end every run eventually:

- **Enemy health, shield, and armor: ×1.12 per depth** (compounding from depth 1).
- **Enemy damage: ×1.10 per depth** (compounding from depth 1).

Compounding is the point: depth 10 opposition has roughly 2.8× the health and 2.4× the damage of depth 1; by depth 25 the health multiplier is around 15×. No build out-scales that forever — the question is only where your wall is.

## Rewards: the escrow

Currency rewards do **not** pay out as you go. Credits, XP, and scrap from each cleared depth accrue into the run's **escrow**, and escrow is paid only when the run ends:

- Per encounter cleared, escrow gains **encounter level × 6 XP**, **encounter level × 22 credits**, and **encounter level × 0.5 scrap** — each growing by an additional **+4% per depth** cleared.
- **Milestone gear drops are the exception.** Boss-tier depths (every 5th) drop gear that is yours immediately, stored like boss loot at the encounter's level. Its Epic and Legendary weights grow the deeper you are when it drops — but even deep, a milestone Legendary stays rarer than a boss's dedicated-drop rate. The Chamber taxes the bank, never the trophies.

## Banking, death, and the tax

How the run ends decides what the escrow pays:

- **Bank out alive** — end the run voluntarily at any point: escrow pays **100%**.
- **Die in the Chamber** — the run ends and escrow pays **50%** (floored). The other half is the price of greed.
- **Abandon a run** — starting a new run over an active one settles the old run as abandoned, at the same **50%**.

Death in the Chamber is **contained**: it writes no open-world death record, needs no resurrection, and locks you out of nothing. The escrow tax is the entire consequence — which is exactly what makes "one more depth" a real gamble with a banked fortune behind you.

## Entry fees

Every entry charges a fee: **10 credits × your level**, for the first run of the day. Each additional run started the same day (UTC) **doubles** the fee, capped at **8×** the base — the same escalation shape as [[Bosses|boss rematch fees]], counted on starts instead of victories. The fee is charged per entry, win or lose, and a carried-out payout from a previous run can fund the next entry.

## A run, step by step

1. **Enter.** Pay the entry fee, commit your belt, and the run takes your action slot. Your anchor level is locked in here.
2. **Descend.** Clear encounters one depth at a time. After each, decide: continue, or open the bank screen and walk out whole.
3. **Hit the boss depths.** Every 5th depth is the gear check — swap equipment between encounters if the next boss kit demands a different element or more survival.
4. **Watch the escrow, not the depth counter.** The number that matters is what you stand to lose half of. When the escrow holds more than you are willing to halve, banking is not cowardice; it is the mode working as designed.
5. **End it your way.** Bank for 100%, or push until the Chamber ends it for you at 50%.

## Why run it

Endless is where a finished build finds out what it is worth: a long run banks roughly boss-kill-scale XP and credits while exposing the whole bank to the death tax, pays milestone gear at rising rarity weights, and gives your [[Combat|action skill]] a steady charge source (20 charge per encounter that does not fire). It is competitive with boss farming at moderate depths without replacing it — bosses remain the home of named legendaries and guaranteed rolls.

Farming one boss repeatedly instead? See [[Bosses]]. Building the gear to push deeper? See [[Gear]] and [[Crafting]].

---

_Source of truth: `src/content/endless.ts`, `src/server/routes/endless.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
