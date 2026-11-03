# Reference

This page is the wiki's data annex: CyberCache's complete numbers,
as tables.

## How these tables work

The tables here are **generated, not written**. Scripts under
`scripts/wiki-gen/` render them directly from the game's own content
definitions — the same constants the live game runs on — so a table
cannot quietly drift from the game the way a hand-copied list always
eventually does. A freshness check in CI (`npm run wiki:gen:check`)
fails if a published table ever falls behind the definitions it was
rendered from. If a number is in a Reference table, it is the number
the game shipped.

The biggest tables get their own pages:

- [[Reference-Legendary-Effects]] — all 25 effects with their honest
  implementation status.
- [[Reference-Consumables]] — the full consumables catalog.
- [[Reference-Recipes]] — every Workshop recipe with inputs and gates.
- [[Reference-Bosses]] — the 13-boss roster, intel only.
- [[Reference-Progression]] — skill-tree nodes and Cache Rank tracks.
- [[Reference-Collections]] — the 81 collection entries.

When a per-system page and a Reference table ever disagree, the table
wins: it is rendered from the game itself.

## Weapons & itemization

<!-- GENERATED from src/constants/weaponTypes.ts, src/constants/manufacturers.ts, src/constants/elements.ts, src/constants/rarities.ts — do not edit by hand -->
<!-- wiki-gen:weapons -->
### Weapon types

Base stats below are the frame every roll starts from, before manufacturer bias, rarity quality, and affixes.

| Type | Base DMG | Atk speed | Crit | Crit DMG | Status | Status DMG | Boss | Wave | Shield | Armor | Mag | Reload | Signature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Pistol** | 80 | 1.2 | 10% | ×1.5 | 8% | ×1.2 | ×1 | ×1 | ×1 | ×1 | 15s | 1s | Sidearm Recovery |
| **SMG** | 45 | 2 | 8% | ×1.4 | 12% | ×1.1 | ×0.95 | ×1.15 | ×1.05 | ×0.9 | 10s | 2s | Overheat |
| **Shotgun** | 140 | 0.7 | 6% | ×1.6 | 10% | ×1.3 | ×0.9 | ×1.3 | ×0.95 | ×1.05 | 6s | 2.5s | Multi Proc |
| **Sniper** | 200 | 0.5 | 25% | ×2 | 5% | ×1 | ×1.2 | ×0.7 | ×1 | ×1.1 | 5s | 3s | Precision Window |
| **Launcher** | 300 | 0.35 | 3% | ×1.8 | 15% | ×1.5 | ×1.15 | ×1.1 | ×0.85 | ×1.3 | 2s | 4s | Reload Lock Stagger |
| **Beam** | 60 | 1.5 | 7% | ×1.35 | 20% | ×1.4 | ×1 | ×0.95 | ×1.15 | ×1.15 | 12s | 3s | Ramp Sustain |

### Manufacturers

| Manufacturer | Identity | Baked-in mechanic | Stat bias |
| --- | --- | --- | --- |
| **Redline** | Attack speed, ramping damage, sustained DPS | Attack speed +15% baked into every roll; its ramping damage is folded into base damage (+8%) | Attack Speed ×1.15, Base Damage ×0.95 |
| **Ironwood** | Crits, precision, boss killing | High crit chance/damage; strong single-target modifiers (+20% crit damage vs bosses) | Crit Chance ×1.2, Crit Damage ×1.25, Base Damage ×1.05 |
| **BlastForge** | Explosions, splash, stagger, armor cracking | Explosive damage helps armor break and boss phase checks (+25% armor damage) | Armor Damage ×1.25, Base Damage ×1.1, Attack Speed ×0.9 |
| **Prismatek** | Elemental specialization | Elemental specialization baked into every roll: +30% status chance and status damage, non-Kinetic elements favored | Status Chance ×1.3, Status Damage ×1.3, Base Damage ×0.95 |
| **ThrowTech** | Deployables and disposable tech | Deployable-tech frames: +20% wave damage baked into every roll | Wave Damage ×1.2, Base Damage ×0.9 |
| **HelixWorks** | Modular, flexible, better stat variance | Modular frames: +10 roll quality floor on every roll | Base Damage ×1 |

### Elements

A strong matchup deals ×1.3 damage; a weak one ×0.7 (from `getElementMatchup`, the same function the combat math reads).

| Element | Strong against | Weak against | Notes |
| --- | --- | --- | --- |
| **Kinetic** | — | — | Neutral. No major strength or weakness. Reliable baseline. |
| **Fire** | flesh, organic | shield, fire-resistant | Strong against flesh/organic. Applies burn DoT. Weak against shield-heavy. |
| **Shock** | shield | armor, shock-resistant | Strong against shields. Helps shield break checks. Weak against heavy armor. |
| **Corrosive** | armor, mechanical | flesh, shield | Strong against armor/mechanical. Helps armor break and anti-repair. |
| **Cryo** | fast, enrage | armor, cryo-resistant | Slows or staggers. Helps against fast bosses and enrage mechanics. |
| **Void** | elite, boss | consistent | High variance, curse, delayed burst. Powerful but less consistent. |

### Rarities

| Rarity | Affixes | Roll-quality bias | Special-effect chance | Scrap value | Drop weight (relative) |
| --- | --- | --- | --- | --- | --- |
| **Common** | 0–1 | +0 | — | ×1 | 60 |
| **Uncommon** | 1 | +5 | — | ×1.5 | 25 |
| **Rare** | 2 | +10 | 5% | ×2.5 | 10 |
| **Epic** | 3 | +15 | 15% | ×4 | 4 |
| **Legendary** | 4–5 | +20 | 100% | ×8 | 1 |
<!-- /wiki-gen:weapons -->

<!-- GENERATED from src/constants/weaponTypes.ts, src/constants/manufacturers.ts, src/lib/pixel/weaponCardCompositor.ts, src/lib/pixel/showcaseWeaponInput.ts — do not edit by hand -->
<!-- wiki-gen:weapon-frames -->
### Weapon frames, pictured

One representative Rare, Kinetic instance per type × manufacturer — frame and maker grammar are the variables; element and affixes are held neutral, and the seeds are fixed, so these are the same guns on every render. How the finished gun reads with an element lit is the next table.

| Type | Redline | Ironwood | BlastForge | Prismatek | ThrowTech | HelixWorks |
| --- | --- | --- | --- | --- | --- | --- |
| **Pistol** | <img src="images/weapons/frames/pistol-redline.png" alt="Pistol — Redline" width="240"> | <img src="images/weapons/frames/pistol-ironwood.png" alt="Pistol — Ironwood" width="240"> | <img src="images/weapons/frames/pistol-blast-forge.png" alt="Pistol — BlastForge" width="240"> | <img src="images/weapons/frames/pistol-prismatek.png" alt="Pistol — Prismatek" width="240"> | <img src="images/weapons/frames/pistol-throw-tech.png" alt="Pistol — ThrowTech" width="240"> | <img src="images/weapons/frames/pistol-helix-works.png" alt="Pistol — HelixWorks" width="240"> |
| **SMG** | <img src="images/weapons/frames/smg-redline.png" alt="SMG — Redline" width="240"> | <img src="images/weapons/frames/smg-ironwood.png" alt="SMG — Ironwood" width="240"> | <img src="images/weapons/frames/smg-blast-forge.png" alt="SMG — BlastForge" width="240"> | <img src="images/weapons/frames/smg-prismatek.png" alt="SMG — Prismatek" width="240"> | <img src="images/weapons/frames/smg-throw-tech.png" alt="SMG — ThrowTech" width="240"> | <img src="images/weapons/frames/smg-helix-works.png" alt="SMG — HelixWorks" width="240"> |
| **Shotgun** | <img src="images/weapons/frames/shotgun-redline.png" alt="Shotgun — Redline" width="240"> | <img src="images/weapons/frames/shotgun-ironwood.png" alt="Shotgun — Ironwood" width="240"> | <img src="images/weapons/frames/shotgun-blast-forge.png" alt="Shotgun — BlastForge" width="240"> | <img src="images/weapons/frames/shotgun-prismatek.png" alt="Shotgun — Prismatek" width="240"> | <img src="images/weapons/frames/shotgun-throw-tech.png" alt="Shotgun — ThrowTech" width="240"> | <img src="images/weapons/frames/shotgun-helix-works.png" alt="Shotgun — HelixWorks" width="240"> |
| **Sniper** | <img src="images/weapons/frames/sniper-redline.png" alt="Sniper — Redline" width="240"> | <img src="images/weapons/frames/sniper-ironwood.png" alt="Sniper — Ironwood" width="240"> | <img src="images/weapons/frames/sniper-blast-forge.png" alt="Sniper — BlastForge" width="240"> | <img src="images/weapons/frames/sniper-prismatek.png" alt="Sniper — Prismatek" width="240"> | <img src="images/weapons/frames/sniper-throw-tech.png" alt="Sniper — ThrowTech" width="240"> | <img src="images/weapons/frames/sniper-helix-works.png" alt="Sniper — HelixWorks" width="240"> |
| **Launcher** | <img src="images/weapons/frames/launcher-redline.png" alt="Launcher — Redline" width="240"> | <img src="images/weapons/frames/launcher-ironwood.png" alt="Launcher — Ironwood" width="240"> | <img src="images/weapons/frames/launcher-blast-forge.png" alt="Launcher — BlastForge" width="240"> | <img src="images/weapons/frames/launcher-prismatek.png" alt="Launcher — Prismatek" width="240"> | <img src="images/weapons/frames/launcher-throw-tech.png" alt="Launcher — ThrowTech" width="240"> | <img src="images/weapons/frames/launcher-helix-works.png" alt="Launcher — HelixWorks" width="240"> |
| **Beam** | <img src="images/weapons/frames/beam-redline.png" alt="Beam — Redline" width="240"> | <img src="images/weapons/frames/beam-ironwood.png" alt="Beam — Ironwood" width="240"> | <img src="images/weapons/frames/beam-blast-forge.png" alt="Beam — BlastForge" width="240"> | <img src="images/weapons/frames/beam-prismatek.png" alt="Beam — Prismatek" width="240"> | <img src="images/weapons/frames/beam-throw-tech.png" alt="Beam — ThrowTech" width="240"> | <img src="images/weapons/frames/beam-helix-works.png" alt="Beam — HelixWorks" width="240"> |
<!-- /wiki-gen:weapon-frames -->

<!-- GENERATED from src/constants/elements.ts, src/constants/weaponTypes.ts, src/constants/manufacturers.ts, src/lib/pixel/weaponCardCompositor.ts, src/lib/pixel/showcaseWeaponInput.ts — do not edit by hand -->
<!-- wiki-gen:weapon-elements -->
### Element reads, pictured

The same representative frame per type — same maker, same seed, Rare — re-rolled with each element. Only the element changes across a row: Kinetic is the honest unlit base, the other five light the frame's current in their own colorway.

| Type | Kinetic | Fire | Shock | Corrosive | Cryo | Void |
| --- | --- | --- | --- | --- | --- | --- |
| **Pistol** (Redline) | <img src="images/weapons/elements/pistol-kinetic.png" alt="Pistol — Kinetic" width="240"> | <img src="images/weapons/elements/pistol-fire.png" alt="Pistol — Fire" width="240"> | <img src="images/weapons/elements/pistol-shock.png" alt="Pistol — Shock" width="240"> | <img src="images/weapons/elements/pistol-corrosive.png" alt="Pistol — Corrosive" width="240"> | <img src="images/weapons/elements/pistol-cryo.png" alt="Pistol — Cryo" width="240"> | <img src="images/weapons/elements/pistol-void.png" alt="Pistol — Void" width="240"> |
| **SMG** (Ironwood) | <img src="images/weapons/elements/smg-kinetic.png" alt="SMG — Kinetic" width="240"> | <img src="images/weapons/elements/smg-fire.png" alt="SMG — Fire" width="240"> | <img src="images/weapons/elements/smg-shock.png" alt="SMG — Shock" width="240"> | <img src="images/weapons/elements/smg-corrosive.png" alt="SMG — Corrosive" width="240"> | <img src="images/weapons/elements/smg-cryo.png" alt="SMG — Cryo" width="240"> | <img src="images/weapons/elements/smg-void.png" alt="SMG — Void" width="240"> |
| **Shotgun** (BlastForge) | <img src="images/weapons/elements/shotgun-kinetic.png" alt="Shotgun — Kinetic" width="240"> | <img src="images/weapons/elements/shotgun-fire.png" alt="Shotgun — Fire" width="240"> | <img src="images/weapons/elements/shotgun-shock.png" alt="Shotgun — Shock" width="240"> | <img src="images/weapons/elements/shotgun-corrosive.png" alt="Shotgun — Corrosive" width="240"> | <img src="images/weapons/elements/shotgun-cryo.png" alt="Shotgun — Cryo" width="240"> | <img src="images/weapons/elements/shotgun-void.png" alt="Shotgun — Void" width="240"> |
| **Sniper** (Prismatek) | <img src="images/weapons/elements/sniper-kinetic.png" alt="Sniper — Kinetic" width="240"> | <img src="images/weapons/elements/sniper-fire.png" alt="Sniper — Fire" width="240"> | <img src="images/weapons/elements/sniper-shock.png" alt="Sniper — Shock" width="240"> | <img src="images/weapons/elements/sniper-corrosive.png" alt="Sniper — Corrosive" width="240"> | <img src="images/weapons/elements/sniper-cryo.png" alt="Sniper — Cryo" width="240"> | <img src="images/weapons/elements/sniper-void.png" alt="Sniper — Void" width="240"> |
| **Launcher** (ThrowTech) | <img src="images/weapons/elements/launcher-kinetic.png" alt="Launcher — Kinetic" width="240"> | <img src="images/weapons/elements/launcher-fire.png" alt="Launcher — Fire" width="240"> | <img src="images/weapons/elements/launcher-shock.png" alt="Launcher — Shock" width="240"> | <img src="images/weapons/elements/launcher-corrosive.png" alt="Launcher — Corrosive" width="240"> | <img src="images/weapons/elements/launcher-cryo.png" alt="Launcher — Cryo" width="240"> | <img src="images/weapons/elements/launcher-void.png" alt="Launcher — Void" width="240"> |
| **Beam** (HelixWorks) | <img src="images/weapons/elements/beam-kinetic.png" alt="Beam — Kinetic" width="240"> | <img src="images/weapons/elements/beam-fire.png" alt="Beam — Fire" width="240"> | <img src="images/weapons/elements/beam-shock.png" alt="Beam — Shock" width="240"> | <img src="images/weapons/elements/beam-corrosive.png" alt="Beam — Corrosive" width="240"> | <img src="images/weapons/elements/beam-cryo.png" alt="Beam — Cryo" width="240"> | <img src="images/weapons/elements/beam-void.png" alt="Beam — Void" width="240"> |
<!-- /wiki-gen:weapon-elements -->

## Affix pools

<!-- GENERATED from src/lib/gear/affixPools.ts — do not edit by hand -->
<!-- wiki-gen:affixes -->
Weapons roll from three sub-pools (combat, boss, idle); shields, ordnance, class mods, and relics each roll from their own pool. Ranges below are the roll ranges baked into an item when an affix lands.

#### Weapon — combat pool

| Affix roll | Stat |
| --- | --- |
| +3–12% Damage | baseDamage |
| +2–8% Crit Chance | critChance |
| +5–20% Crit Damage | critDamage |
| +3–10% Attack Speed | attackSpeed |
| +5–15% Boss Damage | bossDamageMod |
| +5–15% Wave Damage | waveDamageMod |

#### Weapon — boss pool

| Affix roll | Stat |
| --- | --- |
| +8–20% Shield Break | shieldDamageMod |
| +8–20% Armor Break | armorDamageMod |

#### Weapon — idle pool

| Affix roll | Stat |
| --- | --- |
| +5–15% Offline Earnings | offlineEarningsMod |
| +3–10% Rare Drop Chance | rareDropChanceMod |
| +5–20% Scrap Yield | scrapYieldMod |

#### Shield pool

| Affix roll | Stat |
| --- | --- |
| +5–15% Shield HP | hp |
| +5–15% Recharge Rate | rechargeRate |
| +3–10% Mitigation | mitigation |

#### Ordnance pool

| Affix roll | Stat |
| --- | --- |
| +5–15% Ordnance Damage | damage |
| +8–20% Shield Break | shieldDamage |
| +8–20% Armor Break | armorDamage |

#### Class mod pool

| Affix roll | Stat |
| --- | --- |
| +3–10% Weapon Damage | weaponDamage |
| +2–6% Crit Chance | critChance |
| +5–12% Boss Damage | bossDamageMod |
| +1–3 Bonus Skill Points | skillPoints |

#### Relic pool

| Affix roll | Stat | Category |
| --- | --- | --- |
| +8–20% Offline Earnings | offlineEarningsMod | idle |
| +5–15% Rare Drop Chance | rareDropChanceMod | idle |
| +8–25% Scrap Yield | scrapYieldMod | idle |
| +5–20% XP Gain | xpBoostMod | idle |
| +5–15% Cache Key Drop Rate | cacheKeyChanceMod | idle |
| +5–12% Boss Damage | bossDamageMod | boss |
| +5–15% Survival | survivalBoost | boss |
| +5–20% Consumable Efficiency | consumableEfficiency | skill |
<!-- /wiki-gen:affixes -->

## Gear, pictured

Every non-weapon gear kind, in the forms the game actually renders.
Weapons are pictured in the frames and element tables above; the
legendaries have their own page ([[Reference-Legendary-Effects]]).
See [[Gear]] for how the slots play.

<!-- GENERATED from src/components/gearArt/ShieldIllustration.tsx, src/components/gearArt/RelicIllustration.tsx, src/components/gearArt/ClassModIllustration.tsx, src/components/gearArt/OrdnanceIllustration.tsx, src/constants/shieldSilhouettes.ts, src/constants/relicSilhouettes.ts, src/constants/classModSilhouettes.ts, src/constants/ordnanceSilhouettes.ts, src/lib/combat/shieldBehaviors.ts — do not edit by hand -->
<!-- wiki-gen:gear-plates -->
### Shields

A shield's form is picked by its element and its seed — the illustration draws the device. Behavior is a separate stats axis (rolled by rarity when the shield drops; see [[Shield-Tech]]), and the current illustration does not draw it: any behavior can wear any form. Plates are Rare shields with no affixes, rendered by the game's own ShieldIllustration.

| Plate | Form | Rolled for |
| --- | --- | --- |
| <img src="images/gear/shield-rounded.png" alt="Rounded Guard" width="240"> | **Rounded Guard** | Fire or Corrosive on an even seed; Void on an odd seed |
| <img src="images/gear/shield-buckler.png" alt="Buckler" width="240"> | **Buckler** | Fire or Shock on an odd seed |
| <img src="images/gear/shield-bulwark.png" alt="Bulwark" width="240"> | **Bulwark** | Corrosive or Cryo on an odd seed |
| <img src="images/gear/shield-hex-plate.png" alt="Hex Plate" width="240"> | **Hex Plate** | Shock or Kinetic on an even seed |
| <img src="images/gear/shield-split-panel.png" alt="Split Panel" width="240"> | **Split Panel** | Kinetic or Void on an odd seed; Cryo on an even seed |

**Shield behaviors** — what the stats axis rolls:

| Behavior | What it does |
| --- | --- |
| **Standard** | No special behavior. |
| **Nova** | When this shield breaks, it erupts in a burst of damage. |
| **Absorb** | Chance to fully absorb a hit and restore shield. |
| **Amp** | Bonus damage while the shield is at full charge. |
| **Turtle** | Oversized capacity, slow recharge. |

### Ordnance

Form is a hash of the item's effect text and its seed — any ordnance can wear any form.

| Plate | Form |
| --- | --- |
| <img src="images/gear/ordnance-spike.png" alt="Spike Grenade" width="240"> | **Spike Grenade** |
| <img src="images/gear/ordnance-cylinder.png" alt="Cylinder Charge" width="240"> | **Cylinder Charge** |
| <img src="images/gear/ordnance-disc.png" alt="Disc Mine" width="240"> | **Disc Mine** |
| <img src="images/gear/ordnance-canister.png" alt="Payload Canister" width="240"> | **Payload Canister** |

### Class mods

Form follows the boosted tree's keyword.

| Plate | Form | Trees |
| --- | --- | --- |
| <img src="images/gear/class-mod-core.png" alt="Combat Core" width="240"> | **Combat Core** | Gunslinger trees |
| <img src="images/gear/class-mod-drive.png" alt="Tactical Drive" width="240"> | **Tactical Drive** | Demolition trees |
| <img src="images/gear/class-mod-chip.png" alt="Skill Chip" width="240"> | **Skill Chip** | Scavenger trees — and any tree the keyword picker doesn't match, Fixer included |

### Relics

Form follows where the relic came from.

| Plate | Form | Drops from |
| --- | --- | --- |
| <img src="images/gear/relic-shard.png" alt="Void Shard" width="240"> | **Void Shard** | World drops, on an even seed |
| <img src="images/gear/relic-prism.png" alt="Echo Prism" width="240"> | **Echo Prism** | Event drops; world drops on an odd seed |
| <img src="images/gear/relic-totem.png" alt="Boss Totem" width="240"> | **Boss Totem** | Boss drops |
| <img src="images/gear/relic-chip.png" alt="Data Chip" width="240"> | **Data Chip** | Cache-forged items |
<!-- /wiki-gen:gear-plates -->

## Roaming areas

<!-- GENERATED from src/constants/roamingAreas.ts, src/constants/visualAssets.ts — do not edit by hand -->
<!-- wiki-gen:areas -->
Baseline rates are the area design rates before gear, skills, vehicles, and the hot-area rotation multiply them.

| Area | Danger | Enemies | Credits/min | Scrap/min | XP/tick | Material bias | Signature loot | Influence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Dustwaste Frontier** | Low | Raiders, scrap drones, and scavengers | 15 | 3 | 1 | Scrap Alloy, Ballistic Parts | Balanced gear, early salvage, cache fragments | Mixed |
| **Redline Circuit** | Medium | Fast raiders, pursuit drones, and overheating runners | 18 | 3 | 1.2 | Scrap Alloy, Ballistic Parts | SMGs, pistols, attack speed, reload and ramp affixes | Redline |
| **Ironwood Bastion** | Medium/High | Marksmen, armored captains, and sentry posts | 17 | 4 | 1.4 | Ballistic Parts, Tech | Snipers, pistols, crit rolls, weakpoint and boss-damage flavor | Ironwood |
| **BlastForge Yards** | Medium/High | Armored machines, refinery bots, and demolition crews | 16 | 5 | 1.65 | Scrap Alloy, Ballistic Parts, Reactive Components | Launchers, shotguns, armor break, stagger and explosive flavor | BlastForge |
| **Prismatek Reactor** | Variable | Elemental anomalies, shielded test subjects, and reactor constructs | 18 | 4 | 1.9 | Tech | Beams, elemental weapons, status affixes, weakness exploitation | Prismatek |
| **ThrowTech Dumpnet** | Medium | Hacked drones, turret nests, minefields, and signal traps | 19 | 4 | 2.15 | Tech, Reactive Components | Deployable-flavored gear, ordnance, utility drops, drone parts | ThrowTech |
| **HelixWorks Labyrinth** | High | Prototype constructs, unstable test rigs, and shifting lab defenses | 21 | 5 | 2.4 | Tech, Void Dust, Scrap Alloy, Reactive Components | HelixWorks gear, higher roll quality flavor, modular parts | HelixWorks |
<!-- /wiki-gen:areas -->

## Vehicles

<!-- GENERATED from src/lib/vehicles/vehicles.ts — do not edit by hand -->
<!-- wiki-gen:vehicles -->
### Vehicle classes

| Class | Ladder tier | Yield | Fuel / tick | Wear rate | Material bonus | Role |
| --- | --- | --- | --- | --- | --- | --- |
| **Scrap Bike** | 1 | ×1.15 | 0.9 | ×1.1 | — | Starter mobility. |
| **Dune Buggy** | 8 | ×1.35 | 1.1 | ×1 | — | General roaming travel. |
| **Utility Rover** | 18 | ×1.25 | 0.7 | ×0.7 | — | Best fuel efficiency, slow wear — the long-haul farmer. |
| **Cargo Hauler** | 28 | ×1.1 | 1.3 | ×0.95 | +30% | Material farming support: lower raw yield, bonus material quantity. |
| **Armored Crawler** | 42 | ×1.05 | 1.5 | ×0.25 | — | Dangerous-zone reliability: near-negligible wear. |
| **Relay Skimmer** | 60 | ×1.6 | 2 | ×1.25 | — | Fastest yield, highest fuel burn, fragile. |
| **Leviathan Rig** | 75 | ×1.5 | 1.6 | ×0.5 | +15% | Endgame flagship: near-Skimmer yield, Crawler-grade endurance, a working cargo rack. |

The ladder tier is design data only (drop weighting, dispatch courier bands) — **no class has a level requirement**: vehicles are market goods, and if you can buy it, you can drive it.

### The model in numbers

- One fuel cell loads **100 fuel units** into the tank.
- Condition decays **0.02 points per fueled tick** before the class wear rate and area danger scaling:

| Area danger | Decay scaling |
| --- | --- |
| Low | ×0.6 |
| Medium | ×1 |
| Medium/High | ×1.3 |
| Variable | ×1.1 |
| High | ×1.6 |

- Patch kits restore condition at 100% quality: PatchKit **30** · FieldPatchKit **45** · MasterPatchKit **80**.
- Vehicles arrive as gear drops: **4%** of gear drops are replaced by a vehicle drop.

### Vehicle affix pool

| Affix roll | Stat |
| --- | --- |
| +4–10% Vehicle Yield | vehicleYieldPct |
| +5–15% Fuel Efficiency | vehicleFuelEfficiencyPct |
| +10–30% Reinforced Frame | vehicleFramePct |
| +8–20% Cargo Racks | vehicleCargoPct |
| +5–15% Scanner (find) | vehicleScannerPct |
<!-- /wiki-gen:vehicles -->

## Slots paytable

The machine prints this same table in-game; the return rate below is
derived from it by the game's own math.

<!-- GENERATED from src/content/slots.ts — do not edit by hand -->
<!-- wiki-gen:slots -->
| Outcome | Chance | Pays |
| --- | --- | --- |
| **Bust** | 54.8% | Nothing |
| **Kickback** | 20% | 0.5× bet back |
| **Break-even** | 12% | 1× bet back |
| **Triple** | 6% | 3× bet |
| **Vendor Bundle** | 4.2% | Staple goods ≈ 2× bet |
| **Fragment Drop** | 2% | 5 cache fragments |
| **Ten-Spot** | 0.8% | 10× bet |
| **Cache Key** | 0.15% | 1 cache key |
| **Jackpot** | 0.05% | 50× bet |

- **Credit RTP: 50.5%** — derived from the table above (Σ weight × credit multiplier over the credit outcomes), not a hardcoded figure.
- Bet tiers: Chump Change — 50 cr · Working Stiff — 250 cr · High Roller — 1000 cr.
- Daily pull cap: **100 pulls** per UTC day (a live economy lever; 0 closes the machine).
- The Vendor Bundle prize is staples worth ≈2× the bet; the Cache Key prize pays **5 fragments** instead when the daily cache budget is full.
<!-- /wiki-gen:slots -->

---

_Source of truth: `src/content/`, `src/constants/`, `src/lib/` — rendered by `scripts/wiki-gen/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
