# Reference — Recipes

Every recipe in the Workshop's unified catalog — consumables,
refining, gear frames, and tools — with per-unit inputs, times, and
gates. See [[Crafting]] for the occupation around the bench.

**Gates** combine up to four requirements: owned bench, crafting
mastery, a completed [[Actions and Occupations|Research]] course,
and a [[Manufacturer Standing]] rank — never player level. A recipe
with "—" in the Gates column needs only the first bench and its
materials. Gear-frame times are per rarity, since a frame's duration
depends on the rarity you choose when you queue it.

## Materials & essences

<!-- GENERATED from src/constants/visualAssets.ts — do not edit by hand -->
<!-- wiki-gen:materials -->
Every material and essence, drawn as the object it renders as in game — form and colorway are how it reads in the Workshop, the market, and your inventory. The Band column is the processing finish the art itself wears: raw goods are worn and jumbled, refined goods are the same stuff aligned, composites carry their lamination seam.

| Plate | Material | Band | What it is |
| --- | --- | --- | --- |
| <img src="images/materials/scrap-alloy.png" alt="Scrap Alloy" width="48"> | **Scrap Alloy** | Raw | Bolts, plates, and rough salvage metal. |
| <img src="images/materials/ballistic-parts.png" alt="Ballistic Parts" width="48"> | **Ballistic Parts** | Raw | Barrels, chambers, triggers, and shell hardware. |
| <img src="images/materials/reactive-components.png" alt="Reactive Components" width="48"> | **Reactive Components** | Raw | Capacitors, shield nodes, and charged regulators. |
| <img src="images/materials/tech-fragments.png" alt="Tech" width="48"> | **Tech** | Raw | Broken chips, data shards, and machine logic. |
| <img src="images/materials/void-dust.png" alt="Void Dust" width="48"> | **Void Dust** | Raw | Purple unstable residue from anomalous loot. |
| <img src="images/materials/siltglass.png" alt="Siltglass" width="48"> | **Siltglass** | Signature | Dustwaste signature: silt fused to glass in the storm heat. Tier-2 input for sights and refining catalysts. |
| <img src="images/materials/nitrocell-gel.png" alt="Nitrocell Gel" width="48"> | **Nitrocell Gel** | Signature | Redline signature: volatile gel bled from overrun fuel lines. Tier-2 input for overcharge fuel and speed ammo. |
| <img src="images/materials/heartwood-resin.png" alt="Heartwood Resin" width="48"> | **Heartwood Resin** | Signature | Ironwood signature: resin from the bastion heartwood. Tier-2 input for patch kits, shields, and armor work. |
| <img src="images/materials/forgeheart-ingots.png" alt="Forgeheart Ingots" width="48"> | **Forgeheart Ingots** | Signature | BlastForge signature: ingots poured at the forge heart. Tier-2 input for weapon parts and ordnance. |
| <img src="images/materials/prism-shards.png" alt="Prism Shards" width="48"> | **Prism Shards** | Signature | Prismatek signature: reactor-grown prism crystal. Tier-2 input for beam parts, optics, class mods, and scanners. |
| <img src="images/materials/magnetite-cores.png" alt="Magnetite Cores" width="48"> | **Magnetite Cores** | Signature | ThrowTech signature: magnetic cores pulled from the dumpnet grid. Tier-2 input for cargo racks and salvage gear. |
| <img src="images/materials/myco-steel-fiber.png" alt="Myco-Steel Fiber" width="48"> | **Myco-Steel Fiber** | Signature | HelixWorks signature: fungal fiber with a steel weave. Tier-2 input for top survival consumables and relics. |
| <img src="images/materials/refined-alloy.png" alt="Refined Alloy" width="48"> | **Refined Alloy** | Refined | Scrap Alloy, refined: clean, even stock for gear frames. |
| <img src="images/materials/tempered-parts.png" alt="Tempered Parts" width="48"> | **Tempered Parts** | Refined | Ballistic Parts, tempered: hardened barrels, chambers, and triggers. |
| <img src="images/materials/stabilized-cells.png" alt="Stabilized Cells" width="48"> | **Stabilized Cells** | Refined | Reactive Components, stabilized: cells that hold their charge. |
| <img src="images/materials/woven-circuits.png" alt="Woven Circuits" width="48"> | **Woven Circuits** | Refined | Tech, woven: logic looms for advanced work. |
| <img src="images/materials/condensed-void.png" alt="Condensed Void" width="48"> | **Condensed Void** | Refined | Void Dust, condensed: anomaly charge in a denser, steadier form. |
| <img src="images/materials/composite-plating.png" alt="Composite Plating" width="48"> | **Composite Plating** | Composite | Lab composite: layered plate for frames and armor work. |
| <img src="images/materials/circuit-lattice.png" alt="Circuit Lattice" width="48"> | **Circuit Lattice** | Composite | Lab composite: a grown lattice of interlocked circuits. |
| <img src="images/materials/voidweave.png" alt="Voidweave" width="48"> | **Voidweave** | Composite | Lab composite: void-touched weave for exotic builds. |
| <img src="images/materials/chromaweave.png" alt="Chromaweave" width="48"> | **Chromaweave** | Composite | Pigment-bearing weave refined from myco-steel fiber and void essence. Carries a tint craft into a worn part. |

| Plate | Essence | Band | What it is |
| --- | --- | --- | --- |
| <img src="images/materials/ignition-fluid.png" alt="Ignition Fluid" width="48"> | **Ignition Fluid** | Essence | Hot fuel for incendiary payloads. |
| <img src="images/materials/conduit-wire.png" alt="Conduit Wire" width="48"> | **Conduit Wire** | Essence | Blue wire bundles that carry shock charge. |
| <img src="images/materials/acid-compound.png" alt="Acid Compound" width="48"> | **Acid Compound** | Essence | Toxic reagent for corrosive effects. |
| <img src="images/materials/cryo-gel.png" alt="Cryo Gel" width="48"> | **Cryo Gel** | Essence | Cold gel used for freeze modules. |
| <img src="images/materials/void-essence.png" alt="Void Essence" width="48"> | **Void Essence** | Essence | Condensed anomaly charge for unstable gear. |
<!-- /wiki-gen:materials -->

## The recipes

<!-- GENERATED from src/content/crafting.ts, src/constants/craftingRecipes.ts, src/constants/visualAssets.ts — do not edit by hand -->
<!-- wiki-gen:recipes -->
| Recipe | Kind | Output (per unit) | Inputs (per unit) | Time | Gates | Station |
| --- | --- | --- | --- | --- | --- | --- |
| **Med Kit** | consumable | Med Kit | Scrap Alloy ×15, Reactive Components ×8 | 12 min | — | bench |
| **Med Kit (Refined)** | consumable | Med Kit (Refined) | Scrap Alloy ×25, Reactive Components ×15, Void Dust ×1 | 25 min | — | bench |
| **Shield Cell** | consumable | Shield Cell | Scrap Alloy ×20, Reactive Components ×12 | 15 min | — | bench |
| **Nano-Swarm** | consumable | Nano Swarm | Scrap Alloy ×30, Reactive Components ×20, Void Dust ×2 | 40 min | — | bench |
| **Adrenaline Shot** | consumable | Adrenaline Shot | Scrap Alloy ×40, Reactive Components ×25, Void Dust ×3 | 1 h | — | bench |
| **Ammo Pack** | consumable | Ammo Pack | Scrap Alloy ×10, Ballistic Parts ×6 | 10 min | — | bench |
| **High-Capacity Ammo Pack** | consumable | High-Capacity Ammo Pack | Scrap Alloy ×18, Ballistic Parts ×12, Tech ×2 | 18 min | — | bench |
| **Armor-Piercing Ammo** | consumable | Armor-Piercing Ammo | Scrap Alloy ×15, Ballistic Parts ×10 | 15 min | — | bench |
| **Incendiary Ammo** | consumable | Incendiary Ammo | Scrap Alloy ×15, Ballistic Parts ×8, Ignition Fluid ×3 | 18 min | — | bench |
| **Shock Ammo** | consumable | Shock Ammo | Scrap Alloy ×15, Ballistic Parts ×8, Conduit Wire ×3 | 18 min | — | bench |
| **Corrosive Ammo** | consumable | Corrosive Ammo | Scrap Alloy ×15, Ballistic Parts ×8, Acid Compound ×3 | 18 min | — | bench |
| **Cryo Ammo** | consumable | Cryo Ammo | Scrap Alloy ×15, Ballistic Parts ×8, Cryo Gel ×3 | 18 min | — | bench |
| **Void Ammo** | consumable | Void Ammo | Scrap Alloy ×20, Ballistic Parts ×10, Void Essence ×5 | 25 min | — | bench |
| **Ordnance Charge** | consumable | Ordnance Charge | Scrap Alloy ×12, Ballistic Parts ×10 | 12 min | — | bench |
| **EMP Charge** | consumable | EMP Charge | Scrap Alloy ×18, Ballistic Parts ×8, Conduit Wire ×4, Tech ×2 | 22 min | — | bench |
| **Corrosive Charge** | consumable | Corrosive Charge | Scrap Alloy ×18, Ballistic Parts ×8, Acid Compound ×4, Tech ×2 | 22 min | — | bench |
| **Overcharge Stim** | consumable | Overcharge Stim | Scrap Alloy ×25, Ballistic Parts ×15, Void Dust ×2 | 30 min | — | bench |
| **Target Painter** | consumable | Target Painter | Scrap Alloy ×20, Ballistic Parts ×10, Tech ×2 | 20 min | — | bench |
| **Phase Shift Grenade** | consumable | Phase Shift Grenade | Scrap Alloy ×30, Ballistic Parts ×15, Void Dust ×5 | 35 min | — | bench |
| **Luck Booster** | consumable | Luck Booster | Scrap Alloy ×15, Tech ×8 | 15 min | — | bench |
| **Boss Scanner** | consumable | Boss Scanner | Scrap Alloy ×20, Tech ×12 | 20 min | — | bench |
| **Insurance Token** | consumable | Insurance Token | Scrap Alloy ×30, Tech ×15, Void Dust ×2 | 35 min | — | bench |
| **Data Skimmer** | consumable | Data Skimmer | Scrap Alloy ×25, Tech ×15, Void Dust ×3 | 40 min | — | bench |
| **Jammer** | consumable | Jammer | Scrap Alloy ×20, Tech ×10, Conduit Wire ×2 | 25 min | — | bench |
| **Magnetized Payload** | consumable | Magnetized Payload | Scrap Alloy ×15, Ballistic Parts ×10, Tech ×5 | 22 min | — | bench |
| **Signal Scrambler** | consumable | Signal Scrambler | Scrap Alloy ×15, Tech ×10, Conduit Wire ×2 | 20 min | — | bench |
| **Loot Beacon** | consumable | Loot Beacon | Scrap Alloy ×20, Tech ×14, Void Dust ×2 | 30 min | — | bench |
| **Salvage Contract** | consumable | Salvage Contract | Scrap Alloy ×12, Tech ×8 | 16 min | — | bench |
| **Workshop Rush Ticket** | consumable | Workshop Rush Ticket | Scrap Alloy ×18, Tech ×12, Void Dust ×1 | 24 min | — | bench |
| **Patch Kit** | consumable | Patch Kit | Scrap Alloy ×4, Reactive Components ×1 | 12 min | — | bench |
| **Field Patch Kit** | consumable | Field Patch Kit | Scrap Alloy ×6, Reactive Components ×3, Tech ×1, Heartwood Resin ×1 | 25 min | — | bench |
| **Master Patch Kit** | consumable | Master Patch Kit | Scrap Alloy ×8, Reactive Components ×5, Tech ×3, Void Dust ×1 | 45 min | Mastery: crafting_consumables 15 | bench |
| **Fuel Cell** | consumable | Fuel Cell | Scrap Alloy ×6, Nitrocell Gel ×1 | 15 min | — | bench |
| **Calibration Core** | consumable | Calibration Core | Reactive Components ×20, Tech ×15, Prism Shards ×2, Void Dust ×2 | 40 min | Bench 2 | bench |
| **Refined Alloy** | refine | Refined Alloy ×8 | Scrap Alloy ×10 | 20 min | — | crusher |
| **Tempered Parts** | refine | Tempered Parts ×8 | Ballistic Parts ×10 | 20 min | — | crusher |
| **Stabilized Cells** | refine | Stabilized Cells ×8 | Reactive Components ×10 | 20 min | — | crusher |
| **Woven Circuits** | refine | Woven Circuits ×8 | Tech ×10 | 20 min | — | crusher |
| **Condensed Void** | refine | Condensed Void ×8 | Void Dust ×10 | 25 min | — | crusher |
| **Composite Plating** | refine | Composite Plating ×2 | Refined Alloy ×4, Stabilized Cells ×2 | 45 min | Bench 3 | furnace |
| **Circuit Lattice** | refine | Circuit Lattice ×2 | Woven Circuits ×4, Tempered Parts ×2 | 45 min | Bench 3 | furnace |
| **Voidweave** | refine | Voidweave ×2 | Condensed Void ×2, Woven Circuits ×2 | 45 min | Bench 3 | furnace |
| **Chromaweave** | refine | Chromaweave ×2 | Myco-Steel Fiber ×2, Void Essence ×1 | 30 min | Bench 2 | furnace |
| **Weapon Frame** | gear | weapon frame | Refined Alloy ×6, Tempered Parts ×4, Forgeheart Ingots ×2 | Common 1 h 30 min · Uncommon 1 h 30 min · Rare 2 h 30 min · Epic 4 h | — | bench |
| **Shield Frame** | gear | shield frame | Stabilized Cells ×6, Refined Alloy ×4, Heartwood Resin ×2 | Common 1 h 30 min · Uncommon 1 h 30 min · Rare 2 h 30 min · Epic 4 h | — | bench |
| **Class Mod Frame** | gear | classMod frame | Woven Circuits ×5, Circuit Lattice ×2, Prism Shards ×2 | Common 1 h 30 min · Uncommon 1 h 30 min · Rare 2 h 30 min · Epic 4 h | — | bench |
| **Relic Frame** | gear | relic frame | Condensed Void ×4, Voidweave ×2, Myco-Steel Fiber ×2 | Common 1 h 30 min · Uncommon 1 h 30 min · Rare 2 h 30 min · Epic 4 h | — | bench |
| **Ordnance Frame** | gear | ordnance frame | Tempered Parts ×6, Stabilized Cells ×3, Forgeheart Ingots ×2 | Common 1 h 30 min · Uncommon 1 h 30 min · Rare 2 h 30 min · Epic 4 h | — | bench |
| **Precision Calipers** | tool | Precision Calipers | Circuit Lattice ×2, Prism Shards ×2 | 1 h | — | bench |
| **Servo Bench Rig** | tool | Servo Bench Rig | Composite Plating ×2, Magnetite Cores ×2 | 1 h | — | bench |
| **Reclaimer Head** | tool | Reclaimer Head | Composite Plating ×1, Circuit Lattice ×1, Voidweave ×1 | 1 h | — | bench |
| **Shield Cell ×3 (Batch)** | consumable | Shield Cell ×3 | Scrap Alloy ×50, Reactive Components ×30 | 33 min | Research: Production Systems | bench |
| **Patch Kit ×3 (Batch)** | consumable | Patch Kit ×3 | Scrap Alloy ×10, Reactive Components ×3 | 26 min | Research: Production Systems | bench |
| **Ordnance Charge ×3 (Batch)** | consumable | Ordnance Charge ×3 | Scrap Alloy ×30, Ballistic Parts ×25 | 26 min | Research: Production Systems | bench |
| **Redline Tonic** | consumable | Redline Tonic | Ballistic Parts ×12, Nitrocell Gel ×2, Reactive Components ×6 | 25 min | Standing: Redline rank 2 | bench |
| **Heartwood Sight Oil** | consumable | Heartwood Sight Oil | Heartwood Resin ×2, Tech ×10, Reactive Components ×6 | 25 min | Standing: Ironwood rank 2 | bench |
| **Forgeheart Charge** | consumable | Forgeheart Charge | Forgeheart Ingots ×2, Ballistic Parts ×12, Reactive Components ×8 | 25 min | Standing: BlastForge rank 2 | bench |
| **Prism Coating** | consumable | Prism Coating | Prism Shards ×2, Void Essence ×3, Tech ×8 | 25 min | Standing: Prismatek rank 2 | bench |
| **ThrowTech Decoy Kit** | consumable | ThrowTech Decoy Kit | Magnetite Cores ×2, Tech ×12, Scrap Alloy ×20 | 25 min | Standing: ThrowTech rank 2 | bench |
| **Helix Calibration Kit** | consumable | Helix Calibration Kit | Siltglass ×2, Tech ×12, Void Dust ×2 | 25 min | Standing: HelixWorks rank 2 | bench |
| **Bulwark Helm** | cosmetic | Bulwark Helm | Scrap ×3200, Composite Plating ×2, Prism Shards ×2 | 3 h | Bench 3 | bench |
| **Bulwark Siege Torso** | cosmetic | Bulwark Siege Torso | Scrap ×3600, Composite Plating ×3, Refined Alloy ×4 | 3 h 30 min | Bench 3 | bench |
| **Bulwark Pauldron Arm** | cosmetic | Bulwark Pauldron Arm | Scrap ×2000, Tempered Parts ×3 | 2 h | Bench 3 | bench |
| **Bulwark Gauntlet** | cosmetic | Bulwark Gauntlet | Scrap ×2000, Tempered Parts ×3 | 2 h | Bench 3 | bench |
| **Bulwark Support Arm** | cosmetic | Bulwark Support Arm | Scrap ×1800, Tempered Parts ×2 | 1 h 45 min | Bench 3 | bench |
| **Bulwark Thigh (Near)** | cosmetic | Bulwark Thigh (Near) | Scrap ×2200, Refined Alloy ×3 | 2 h | Bench 3 | bench |
| **Bulwark Thigh (Far)** | cosmetic | Bulwark Thigh (Far) | Scrap ×2200, Refined Alloy ×3 | 2 h | Bench 3 | bench |
| **Stomper Leg (Near)** | cosmetic | Stomper Leg (Near) | Scrap ×2800, Composite Plating ×1, Tempered Parts ×2 | 2 h 30 min | Bench 3 | bench |
| **Stomper Leg (Far)** | cosmetic | Stomper Leg (Far) | Scrap ×2800, Composite Plating ×1, Tempered Parts ×2 | 2 h 30 min | Bench 3 | bench |
| **Packmaster Tank** | cosmetic | Packmaster Tank | Scrap ×2600, Circuit Lattice ×2, Woven Circuits ×2 | 2 h 30 min | Bench 3 | bench |
| **Dreadplate Helm** | cosmetic | Dreadplate Helm | Scrap ×700, Prism Shards ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Torso** | cosmetic | Dreadplate Torso | Scrap ×600, Refined Alloy ×2 | 45 min | Bench 2 | bench |
| **Dreadplate Upper Arm** | cosmetic | Dreadplate Upper Arm | Scrap ×600, Tempered Parts ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Forearm** | cosmetic | Dreadplate Forearm | Scrap ×600, Tempered Parts ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Support Arm** | cosmetic | Dreadplate Support Arm | Scrap ×600, Tempered Parts ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Thigh (Near)** | cosmetic | Dreadplate Thigh (Near) | Scrap ×600, Refined Alloy ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Thigh (Far)** | cosmetic | Dreadplate Thigh (Far) | Scrap ×600, Refined Alloy ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Lower Leg (Near)** | cosmetic | Dreadplate Lower Leg (Near) | Scrap ×600, Tempered Parts ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Lower Leg (Far)** | cosmetic | Dreadplate Lower Leg (Far) | Scrap ×600, Tempered Parts ×1 | 45 min | Bench 2 | bench |
| **Dreadplate Back Rig** | cosmetic | Dreadplate Back Rig | Scrap ×600, Woven Circuits ×1 | 45 min | Bench 2 | bench |
| **Redline Helm** | cosmetic | Redline Helm | Scrap ×1800, Nitrocell Gel ×2 | 1 h 30 min | Bench 2 | bench |
| **Ironwood Helm** | cosmetic | Ironwood Helm | Scrap ×1800, Heartwood Resin ×2 | 1 h 30 min | Bench 2 | bench |
| **BlastForge Helm** | cosmetic | BlastForge Helm | Scrap ×1800, Forgeheart Ingots ×2 | 1 h 30 min | Bench 2 | bench |
| **Prismatek Helm** | cosmetic | Prismatek Helm | Scrap ×1800, Prism Shards ×2 | 1 h 30 min | Bench 2 | bench |
| **ThrowTech Helm** | cosmetic | ThrowTech Helm | Scrap ×1800, Magnetite Cores ×2 | 1 h 30 min | Bench 2 | bench |
| **HelixWorks Helm** | cosmetic | HelixWorks Helm | Scrap ×1800, Siltglass ×2 | 1 h 30 min | Bench 2 | bench |
| **Tint a Part** | cosmetic | Tint a Part | Scrap ×25 | 5 min | — | bench |
<!-- /wiki-gen:recipes -->

---

_Source of truth: `src/content/crafting.ts`, `src/constants/craftingRecipes.ts` — rendered by `scripts/wiki-gen/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
