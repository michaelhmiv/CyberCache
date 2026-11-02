# Collections

Collections are the long game made visible: a finite, completable log
of the things worth hunting in CyberCache, kept as a **trophy shelf**
on your profile. Every entry on the shelf was proven by a real event —
a drop stored, a boss downed, an elite killed — recorded by the game at
the moment it happened. You can't claim an entry; you can only earn it.

## The catalog: 81 entries in 4 families

- **Legendary Effects — 25 entries.** One for every
  [[Legendary Effects|legendary effect]] in the game. An entry fills
  the first time a weapon carrying that effect becomes yours.
- **Bosses — 13 entries.** One for every boss in the roster. An entry
  fills when you beat that boss — see [[Bosses]].
- **Weapon Frames — 36 entries.** Every weapon type × manufacturer
  combination (6 × 6) at **Legendary** rarity. A Legendary Pistol from
  Redline and a Legendary Pistol from Ironwood are two different
  entries; a Rare version of either is none.
- **Named Elites — 7 entries.** Each roaming area has one named elite
  (the Silt Marshal, Pursuit Prime, Thornwarden, Slag Herald, Phase
  Revenant, Heap Warden, and Specimen Zero). Downing one when a roaming
  elite encounter escalates fills its area's entry.

25 + 13 + 36 + 7 = **81 entries**, and the catalog is derived from the
game's own content — when the game grows, the shelf grows with it.

## How entries complete

Discovery is automatic and permanent. Entries are recorded when the
underlying fact settles: an item is stored after a roaming claim, boss
loot, offline settlement, or cache opening; a market purchase is
delivered to you; a boss victory is applied; an elite kill is recorded.
Buy a Legendary weapon with an effect you've never owned off
[[The Market]], and both its effect entry and its frame entry fill on
delivery. There is nothing to turn in and nothing to forget to claim.

Open Collections from your profile to see the shelf family by family,
with a found count for each and a hint on every missing entry telling
you where it comes from — intel, never odds.

## Legendary cores: minted one way only

The shelf's second job is guarding the game's scarcest currency.
A **legendary core** is minted in exactly one way: **salvaging a
Legendary item**. Nothing else creates them — not caches, not standing
turn-ins, not the market, not collections themselves.

How many cores a salvage pays depends on what you fed it:

- Any Legendary: **1 core**.
- **+1** if the item is level 25 or higher.
- **+1** more if it is level 50 or higher.
- **+1** more if it is a weapon carrying a legendary effect.

So a low-level Legendary shield is worth exactly 1 core, and a
high-level effect weapon — the single most valuable salvage in the
game — pays **4**. Nothing multiplies cores: scrap bonuses and effects
like Market Crash scale your *scrap*, never your cores.

## What cores are for

Cores have exactly two sinks, both at the deep end of [[Gear]] and
[[Crafting]]:

- **Legendary [[Gear|reforge]]** — rerolling an affix on a Legendary
  item burns **2 cores** on top of the scrap cost. One legendary
  reforge costs roughly one salvaged legendary; that tightness is the
  design.
- **Legendary Core Catalyst** — a gear-frame job in the Workshop may
  escrow **1 core per unit** to buy extra generation draws toward a
  better roll (Forge bench or better). The core buys luck, never
  rarity: crafting still caps at Epic and never produces a legendary
  effect.

Cores also **trade on [[The Market]]** by quantity. Trading moves cores
between hunters; it never mints them — every core in circulation still
cost one salvaged Legendary to create, which is what keeps the two
sinks above tight.

## Why the scarcity matters

Cores are why a Legendary is always in demand. Every Legendary you find
is simultaneously a weapon, two collection entries, a market listing
someone wants, and 1–4 cores in waiting. Sinking a Legendary is never
wasted and never free — and the shelf is how you watch the hunt add up
while you decide.

---

_Source of truth: `src/content/collections.ts`, `db/migrations` (`cc_recycle_item`), `src/constants/legendaryEffects.ts`, `src/content/reforge.ts`, `src/content/crafting.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
