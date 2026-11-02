# Vehicles & the Garage

Vehicles are real gear: item instances that live in their own loadout
slot, drop like gear, and equip like gear. An equipped, fueled vehicle
makes roaming pay more — it never makes roaming faster, and it never
takes part in boss fights.

## The yield model

CyberCache ticks every **3 seconds**, and a vehicle does not touch that
clock. Instead, the vehicle **multiplies what each tick yields** —
credits, scrap, XP, material quantities, and loot-roll chances — by its
yield factor.

At full condition, a vehicle's factor starts at its class base yield.
Your vehicle's own rolled affixes can raise it further, and two things
drag it back toward ×1.0 (no bonus):

- **Condition.** As condition falls, the bonus fades smoothly with it.
  At zero condition the factor is exactly ×1.0.
- **Fuel.** An unfueled tick pays ×1.0. See below.

Boss attempts never read your vehicle. It is a roaming machine, full
stop.

## The seven classes

Each class unlocks at a player level (the gate is enforced when you
equip) and trades raw yield against fuel burn and durability:

- **Scrap Bike** — level 1, **×1.15** yield. Your starter: modest bonus,
  light fuel burn, wears a little fast.
- **Dune Buggy** — level 8, **×1.35** yield. The general-purpose roaming
  upgrade.
- **Utility Rover** — level 18, **×1.25** yield. The long-haul farmer:
  the lowest fuel burn and slow wear beat the Buggy over a long session.
- **Cargo Hauler** — level 28, **×1.10** yield. Low raw yield, but a
  **+30% material quantity** bonus — the material farmer's pick.
- **Armored Crawler** — level 42, **×1.05** yield. Barely a bonus, but
  near-negligible wear — the dangerous-zone reliability pick.
- **Relay Skimmer** — level 60, **×1.60** yield. The highest yield in
  the game, with the highest fuel burn and fragile condition to match.
- **Leviathan Rig** — level 75, **×1.50** yield. The endgame flagship:
  near-Skimmer yield that holds up far longer, about half the Skimmer's
  wear rate, lower fuel burn, and a **+15% material quantity** bonus.

There is no single best vehicle. The Skimmer wins a short, fueled
sprint; the Rover and the Rig win the long haul; the Hauler wins when
what you want is materials, not credits.

## Getting vehicles

Your **starter Scrap Bike arrives in your initial account bundle**,
auto-equipped if your vehicle slot is empty. After that, vehicles drop
while roaming — a small share of gear drops (4%) arrive as a vehicle
drop instead — and they trade on the [[The Market|player market]] like
any other item.

## Fuel: crafted, and never a hard block

Vehicles burn **fuel units** from a shared tank, at a per-tick rate set
by the class (the Scrap Bike sips; the Skimmer drinks). One **Generic
Fuel Cell** loads **100 fuel units** into the tank.

Fuel cells come from two places: the NPC [[Vendor]] sells the baseline
Generic Fuel Cell, and [[Crafting]] makes the crafted Fuel Cell, which
loads fuel in proportion to its quality — a 130% cell loads 130 units.
**Run dry and nothing stops:** the
bonus simply goes inactive and you keep roaming on foot at ×1.0 until
you refuel. Out of fuel is a missed bonus, never a wall.

## Condition: wear, never destruction

Condition runs 0–100 and decays a little on every fueled tick — faster
in more dangerous areas, slower on durable classes (the Crawler barely
wears at all; the Skimmer wears fastest). Decay degrades the yield
bonus smoothly. **Condition never destroys a vehicle and never blocks
roaming** — a wrecked vehicle is just a vehicle paying no bonus.

**Patch kits restore condition.** At 100% quality, a basic Patch Kit
restores **30 points**, a Field Patch Kit **45**, and a Master Patch Kit
**80** — and a crafted kit's quality percentage scales what it actually
restores, so a 130% kit restores 130% of its base. You have two ways to
use one:

- **Self-repair** — do it yourself in the Workshop: untrained and slow,
  at the kit's base rate.
- **[[Repair Board]]** — post the job and let a mechanic do it:
  trained hands restore more per kit and earn their pay doing it.

## The Garage

Your Garage is the vehicle section of **Gear → Loadout**. There you can
see every vehicle you own, equip one into the vehicle slot, check its
condition and your fuel, refuel, and start a repair. Vehicles are
managed there, not in the [[Gear]] grid — and they cannot be
[[Gear|reforged]]; a vehicle's affixes are its class tuning, not bench
work.

---

_Source of truth: `db/migrations` (vehicle items), `src/content/dispatch.ts` (courier classes), `src/screens/ChestScreen.tsx` (Garage), `src/lib/vehicles/vehicles.ts`, `src/lib/api/initialBundle.ts`, `src/content/repair.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
