# Endless Mode

Endless Mode — the **Chaos Chamber** — is the post-campaign proving ground: an unbounded descent of encounters that get stronger every depth until your build meets its wall. There is no final depth to clear (a hard cap exists at depth 250 as a safety valve, and reaching it simply banks your run in full). The mode's whole game is one decision, repeated: **push deeper, or bank now?**

A run occupies your personal action slot for its entire duration — starting one means your hunter is in the Chamber, not roaming, crafting, or extracting (see [[Actions and Occupations]]). You will need to be alive to enter: a standing open-world death must be resolved first (see [[Bosses]]).

## How a run works

A run's **encounter levels** are anchored at your level when you enter: depth 1 is fought at your entry level, depth 10 at entry level + 9, and so on. Encounter level prices the rewards and the milestone gear's level — the stakes scale with you.

The fights themselves do not. **The Chamber is a fixed ladder, the same for every hunter:** how strong a depth is depends only on the depth, never on who is climbing. A depth-1 fight is a depth-1 fight whether a level-10 hunter or a level-100 hunter walks in — the stronger hunter simply tears through the early depths by being stronger.

- **Most depths are war packs** — roaming-elite encounters dressed in a rotating area, priced at a fraction of the par boss **for that depth** (35% of its health pool, 45% of its damage).
- **Every 5th depth is a boss-tier encounter** wearing a shipped boss's kit — its mechanic, phases, weaknesses, and resistances — floored at the strength of the strongest boss at or below **that depth**, so a boss depth is always a genuine spike over the packs around it.
- **You may swap gear between encounters.** Each encounter is priced against the loadout you currently hold, so adjusting your build mid-run for the next boss depth is legitimate play.
- **Your prepared consumable belt is committed once, at entry**, and burned there. The run is one attempt; its encounters are phases. Unlike boss fights, you do not re-pay the belt per encounter — and the reward rates below are priced with that in mind.

One boss habit the Chamber deliberately does not borrow: a boss depth wears its kit's mechanic, phases, weaknesses, and resistances, but not its **attack pattern** — Chamber fights price the kit's damage continuously, with no cadence gaps, so shield recharge never gets quiet to work in inside the Chamber. Patterns belong to the authored ladder (see [[Bosses]]).

Like [[Bosses|boss prep]], the Chamber's prep shows you the run's facts — scaling rates, first-encounter and first-boss vitals, reward rates, the fee schedule — and never a readiness figure or win chance for you.

## The escalation

Two compounding curves steepen the ladder as you descend, on top of the par kit itself stepping up each time the depths cross into a higher boss tier:

- **Enemy health, shield, and armor: ×1.04 per depth** (compounding from depth 1).
- **Enemy damage: ×1.03 per depth** (compounding from depth 1).

Depth 10 opposition has roughly 1.4× the health and 1.3× the damage of depth 1 before the tier step; by depth 25 the health multiplier is around 2.6×, and it never stops growing. No build out-scales that forever — the question is only where your wall is.

**A note on records:** best depths set before the Chamber became a fixed ladder were earned on ladders priced off the runner's own level, so they are not directly comparable to fixed-ladder depths — the same depth number did not mean the same fights.

## Rewards: the escrow

Currency rewards do **not** pay out as you go. Credits, XP, and scrap from each cleared depth accrue into the run's **escrow**, and escrow is paid only when the run ends:

- Per encounter cleared, escrow gains **encounter level × 6 XP**, **encounter level × 22 credits**, and **encounter level × 0.5 scrap** — each growing by an additional **+4% per depth** cleared.
- **Milestone gear drops are the exception.** Boss-tier depths (every 5th) drop gear that is yours immediately, stored like boss loot at the encounter's level. Its Epic and Legendary weights grow the deeper you are when it drops — but even deep, a milestone Legendary stays rarer than a boss's dedicated-drop rate. The Chamber taxes the bank, never the trophies. And if your weekly [[Leaderboards and Streaks|leaderboard]] drop-luck buff is active, it covers Chamber milestone drops too, exactly as it covers roaming and boss drops.

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
