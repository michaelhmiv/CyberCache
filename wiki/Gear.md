# Gear

Gear is your hunter. Everything you equip is a real item instance with its
own level, rarity, roll quality, affixes, and history — and what you see
rendered on your hunter is that actual item, never a generic stand-in.

## Your loadout: 7 gear slots + a vehicle

Your loadout has eight slots. Seven are gear:

- **Primary, Secondary, and Heavy** — three weapon slots. Your Secondary
  contributes a reduced share of its passive stats (30% instead of full),
  so it supports the Primary rather than duplicating it.
- **Ordnance** — your heavy hitter: flat damage plus shield and armor
  damage, with its own effect.
- **Shield** — hit points, recharge rate, and damage mitigation, plus a
  behavior archetype on newer shields (Standard, and types such as Nova,
  Absorb, Amp, and Turtle).
- **Class Mod** — boosts one skill tree and specific nodes in it.
- **Relic** — a pure affix piece: no base stats of its own, all rolled
  bonuses.

The eighth slot is your **vehicle**, which works differently enough to
have its own page: [[Vehicles and the Garage]].

## Weapons: type × manufacturer × element

Every weapon is built from three choices the roll makes for you:

**6 weapon types.** Pistol (balanced all-rounder), SMG (fast, ramping,
status-friendly), Shotgun (burst and multi-hit wave clearing), Sniper
(high crit, built for boss killing), Launcher (slow, huge hits, armor
break and stagger), and Beam (the elemental/status specialist).

**6 manufacturers**, each with a baked-in identity. Redline bakes in
attack speed and ramping damage. Ironwood is crits, precision, and boss
killing. BlastForge is explosions, splash, and armor cracking.
Prismatek specializes in elements, with status chance and status damage
baked into every roll. ThrowTech builds deployable tech with extra wave
damage. HelixWorks is modular and flexible, with a better roll-quality
floor on every roll.

**6 elements.** Kinetic is the neutral baseline. Fire burns flesh and
organic targets over time but struggles against shields. Shock breaks
shields and struggles against heavy armor. Corrosive eats armor and
mechanical targets. Cryo slows and staggers, helping against fast and
enraging enemies. Void is high-variance power aimed at elites and
bosses. Matching an element to a target's weakness pays a ×1.3
multiplier; hitting a resistance pays ×0.7.

## Rarity and affixes

Gear rolls in **5 rarities**, and rarity sets how many affixes (rolled
bonus lines) the item carries:

- **Common** — 0–1 affixes
- **Uncommon** — 1 affix
- **Rare** — 2 affixes
- **Epic** — 3 affixes
- **Legendary** — 4–5 affixes

Higher rarity also rolls better on average: each tier adds a roll-quality
bias (Uncommon +5, Rare +10, Epic +15, Legendary +20). **Roll quality**
itself runs 0–100 and is labeled Poor, Low, Standard, Strong, Excellent,
and — at 96 or better — God Roll. Two items with the same name and rarity
can be very different items; the affixes and the roll quality are why.

Legendary weapons can additionally carry one named
[[Legendary Effects|legendary effect]] — see that page for how they work.

## The one gear home

Everything gear lives on the **Gear tab**, as a rail of four stops:

- **Loadout** — the equip surface: your hunter stands at the top of
  the panel wearing your actual equipped gear — your primary weapon
  in his hands, shield, relic, and belt mounted on the figure — over
  the seven slot chips and the slot picker. Weapon chips draw the
  rolled gun itself, and item names always print in full. Your
  vehicle slot lives here too: its status line — equipped vehicle,
  yield, fuel, condition — heads the **Garage section**, which
  expands in place right under it with everything vehicle: equip,
  refuel, and repair (see [[Vehicles and the Garage]]). (Your
  credits, scrap, keys, and item count print once, in the strip at
  the top of the tab — the loadout panel header carries your DPS
  and HP instead.)
- **Grid** — your full item grid, with salvage/recycle.
- **Items** — your belt, plus every stack you carry: consumable
  batches with their quality % printed, materials, and essences.
- **Workshop** — the crafting bench (see [[Crafting]]).

Tap any item to open its **inspect sheet**: full stats, affixes, source,
and your options — equip or unequip it, lock it (locked items are
protected from salvage), or salvage it.

**Salvage** breaks an item down into scrap plus crafting materials and
essences — weapons lean toward ballistic parts, shields and ordnance
toward reactive components, and elemental gear returns its element's
essence. Salvaging a Legendary also pays out **legendary cores** — see
[[Collections]] for the exact yield, because cores are the scarcest
currency in the game.

**Bulk salvage** clears space in one move. The salvage button on the
Gear tab opens a rarity sheet — **Commons only**, **Uncommon & under**,
**Rare & under**, or **Epic & under** — with the live count each level
would take. Pick one and everything eligible at or under that rarity
is scrapped in a single instant settlement, followed by one summary
card showing the totals you gained. **Epic & under** asks you to
confirm first, with the epic count stated. Locked and equipped items
are always left alone, and **Legendaries are never bulk-scrapped** —
they are salvaged one at a time from the item's inspect sheet.

## Reforge: fix one affix

The **reforge bench** rerolls **one** rolled affix on a weapon, shield,
class mod, relic, or ordnance piece, drawing the replacement from the
same pool the item originally rolled from.

- **Cost:** scrap equal to **3× the item's own salvage value**, so the
  price scales with the item's rarity and level.
- **Legendary items** additionally burn **2 legendary cores** per reroll.
- A reforge changes that one affix and nothing else. Rarity, level,
  element, manufacturer, roll quality, and a weapon's legendary effect
  are the item's identity — they never change, a non-Legendary can never
  gain a legendary effect here, and a Legendary never loses one.
- **Vehicles cannot be reforged** — they are a separate item family
  managed in the Garage.

Reforging is a decision, not a chore: you are burning roughly three
items' worth of salvage to fix one keeper. Save it for items you intend
to keep.

## Where gear comes from

Roaming drops, [[Bosses|boss loot]], [[Caches]], the [[The Market|player
market]], and the [[Crafting|Workshop]] all feed the same inventory.
Workshop gear is capped at Epic — Legendaries are found, not made. Boss
prep shows you the boss's mechanics and your own numbers, never a
computed win chance; choosing which gear to bring is the game. See
[[Combat]] for how these stats meet an enemy, and [[Reference]] for the
full data tables.

---

_Source of truth: `src/constants/weaponTypes.ts`, `src/constants/manufacturers.ts`, `src/constants/elements.ts`, `src/constants/rarities.ts`, `src/content/reforge.ts`, `src/screens/ChestScreen.tsx`, `src/screens/InventoryScreen.tsx`, `src/store/slices/loadoutSlice.ts`, `src/lib/gear/affixPools.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
