# Crafting

Crafting is not a menu you visit between fights. It is an
**occupation** — one of the [[Actions and Occupations|actions]] your
hunter can be doing — and the Workshop is where the work happens. A
dedicated crafter is a real playstyle: when the market is hungry for
crafted goods, the hunter at the bench out-earns the hunter in the
field.

## The one rule: jobs run only while you craft

Workshop jobs advance **only while crafting is your active action**.
Queue a job, switch to roaming or a boss, and the job sits **paused** —
it keeps its place and its escrowed inputs, but no progress is made
until you come back to the bench. One job runs per bench, with up to
**5 more queued** behind it on that bench.

Crafting pays **XP at about 77.5% of roaming's rate** for the same time
(the exact rate is pegged to the best roaming area unlocked at your
level, and a rushed job pays proportionally less because it took less
time). That is deliberately below roaming — and deliberately close
enough that supplying the market beats roaming's raw output whenever
demand is real.

**Everyone can craft, guests included.** Crafting carries no
verified-account gate.

## The catalog: 59 recipes

The unified Workshop catalog holds **59 recipes**:

- **29 consumable recipes** — med kits, shield cells, ammo, ordnance,
  stims, scanners, and utility goods.
- **5 vehicle consumables** — Patch Kit, Field Patch Kit, Master Patch
  Kit, the crafted Fuel Cell, and the Calibration Core for
  [[Shield-Tech]] work.
- **8 refining recipes** — turn base materials into their refined forms
  on the crusher, and combine refined forms into Lab composites in the
  furnace.
- **5 gear frames** — Weapon, Shield, Class Mod, Relic, and Ordnance.
- **3 workshop tools** — fitted upgrades that improve your bench for a
  set number of jobs: better quality, faster jobs, or better refining.
- **6 Manufacturer Standing exclusives** — one consumable per
  manufacturer, unlocked at rank 2 on that maker's ladder (see
  [[Manufacturer Standing]]).
- **3 Research batch recipes** — Shield Cells, Patch Kits, and Ordnance
  Charges made 3 at a time, gated behind the Production Systems course
  in [[Actions and Occupations|Research]]: cheaper in time than three
  singles, dearer in materials.

## Benches

You start on the **Basic Bench** (level 1, free). Two upgrades matter:

- **Forge** — level 15, 5,000 credits. Quality rolls ×1.05; unlocks Rare
  gear frames and catalysts.
- **Lab** — level 30, 25,000 credits + 10 VoidDust. Quality rolls ×1.10
  with +5 to the minimum roll; unlocks Epic frames and the furnace for
  composite refining.

## Inputs: materials, essences, signatures

Recipes consume three families of inputs, all earned by roaming and
salvaging (and all tradable on [[The Market]]):

- **5 base materials** — Scrap Alloy, Ballistic Parts, Reactive
  Components, Tech Fragments, and Void Dust — plus their **5 refined
  forms** and **3 Lab composites**, which refining produces and gear
  frames consume.
- **5 essences** — one per non-Kinetic element (Ignition Fluid, Conduit
  Wire, Acid Compound, Cryo Gel, Void Essence). Each essence type
  trades on [[The Market]] as its own quantity commodity, so a crafter
  short on one element can buy exactly that essence instead of farming
  for it.
- **7 Tier-2 signature materials** — one sourced from each roaming
  area's home territory (Siltglass, Nitrocell Gel, Heartwood Resin,
  Forgeheart Ingots, Prism Shards, Magnetite Cores, Myco-Steel Fiber).
  Signatures are also the **catalysts**: on the Forge or better, adding
  a recipe's signature catalyst widens its quality roll (+10 to the
  minimum, +15 to the maximum).

Inputs are escrowed when a job is queued — they are spoken for until
the job finishes or you cancel it.

## Quality is real

A crafted consumable carries a **quality percentage**, rolled per batch
from a range set by the consumable type, widened by your crafting
mastery, your bench, and any catalyst. Quality is capped at **175%**,
with 125% counting as high quality and 150% as perfect. And quality is
not a label: the engines read it. A 130% Med Kit heals 130% of base, a
130% Patch Kit restores 130% of its base condition, a 130% Fuel Cell
loads 130 fuel units.

This is the crafter's whole edge over the NPC [[Vendor]]:

- The vendor sells a short list of **baseline staples** — Med Kit,
  Shield Cell, Ammo Pack, Ordnance Charge, Boss Scanner, Insurance
  Token, Luck Booster, Generic Fuel Cell, Patch Kit — always at a flat
  **100% quality**.
- **10 consumable types are vendor-excluded**: the vendor never stocks
  them at any quality. The Field and Master Patch Kits, the crafted
  Fuel Cell, the Calibration Core, and all six standing exclusives
  exist only because a crafter made them.
- Everything else the vendor doesn't stock is crafter-and-market
  supply too. If you want it above 100% — or in some cases at all —
  someone has to make it. That someone can be you.

## Gear crafting: capped at Epic

Gear frames produce real [[Gear]] in the slot of your choice, at a
rarity you choose — **capped at Epic**. Legendaries are found, not
made, and crafted gear never carries a [[Legendary Effects|legendary
effect]]. Frame times run from 90 minutes (Common/Uncommon) through
150 minutes (Rare) to 240 minutes (Epic); Rare frames need the Forge,
and Epic frames need the Lab plus gear mastery level 10.

One exception bends the cap without breaking it: a gear-frame job on
the Forge or better may escrow **1 legendary core per unit** as a
Legendary Core Catalyst, buying extra generation draws toward a better
roll. The core buys luck, never rarity — see [[Collections]] for where
cores come from.

## Getting started

Open **Gear → Workshop**, pick a recipe you have the inputs for, set
crafting as your active action, and let the bench work. Salvage from
the [[Gear]] tab is the beginner's supply line: break down drops you
don't want, and the materials and essences come back as your first
crafting stock.

---

_Source of truth: `src/content/crafting.ts`, `src/constants/craftingRecipes.ts`, `src/constants/consumables.ts`, `src/screens/WorkshopScreen.tsx`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
