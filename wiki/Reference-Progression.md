# Reference — Progression

The two permanent progression menus in full: every skill-tree node,
and the Cache Rank tracks with their earning and cost curves. See
[[Progression]] for how points, tokens, and mastery fit together.

## Skill trees

<!-- GENERATED from src/constants/skillTrees.ts — do not edit by hand -->
<!-- wiki-gen:skill-trees -->
The four trees hold **67 nodes** and **303 points** of spending room. A hunter earns 1 point per level from level 2 — **99 points by level 100** — so the trees are deliberately wider than any single build: choosing is the game.

### Gunslinger

| Tier | Node | Type | Cost | Max points | Effect | Requires |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Calibrated Iron** | small | 1 | 5 | +5% Weapon Damage | — |
| 1 | **Heavy Slugs** | small | 1 | 5 | +5% Weapon Damage | — |
| 2 | **Steady Hand** | small | 1 | 5 | +3% Crit Chance | — |
| 2 | **Weakspot Training** | small | 1 | 5 | +3% Crit Chance | — |
| 3 | **Terminal Ballistics** | small | 1 | 5 | +10% Crit Damage | — |
| 3 | **Overpenetration** | small | 1 | 5 | +10% Crit Damage | — |
| 4 | **Quick Cycle** | small | 1 | 5 | +8% Attack Speed | — |
| 4 | **Rapid Servos** | small | 1 | 5 | +8% Attack Speed | — |
| 5 | **Target Priority** | small | 1 | 5 | +10% Boss Damage | — |
| 5 | **High-Value Execution** | small | 1 | 5 | +10% Boss Damage | — |
| 6 | **Procedural Loads** | small | 1 | 5 | +5% Status Chance | — |
| 6 | **Shield Breach** | small | 1 | 5 | +5% Shield Damage | — |
| 7 | **Focus Fire** | major | 3 | 1 | +15% Boss Damage when using Sniper or Pistol. | Target Priority, High-Value Execution |
| 7 | **Speedloader** | major | 3 | 1 | +20% Attack Speed for first 10 seconds of boss fight. | Quick Cycle, Rapid Servos |
| 8 | **Weakspot Analysis** | major | 3 | 1 | +25% Crit Damage against bosses below 50% HP. | Terminal Ballistics, Overpenetration |
| 8 | **Elemental Overclock** | major | 3 | 1 | Equipping a weapon matching the boss weakness grants +10% overall damage. | Procedural Loads |
| 9 | **Death by a Thousand Cuts** | keystone | 5 | 1 | Critical hits increase the DPS check score by an additional +25%. If crit chance exceeds 50%, gain +10% boss damage. | Focus Fire, Speedloader, Weakspot Analysis |

### Demolition

| Tier | Node | Type | Cost | Max points | Effect | Requires |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Payload Expansion** | small | 1 | 5 | +10% Ordnance Damage | — |
| 1 | **Fragmentation** | small | 1 | 5 | +10% Ordnance Damage | — |
| 2 | **Volatile Mix** | small | 1 | 5 | +8% Explosive Damage | — |
| 2 | **Blast Radius** | small | 1 | 5 | +8% Explosive Damage | — |
| 3 | **Penetrator Rounds** | small | 1 | 5 | +10% Armor Damage | — |
| 3 | **Crack Core** | small | 1 | 5 | +10% Armor Damage | — |
| 4 | **Concussion** | small | 1 | 5 | +5% Stagger Chance | — |
| 4 | **Impact Force** | small | 1 | 5 | +5% Stagger Chance | — |
| 5 | **Overcharge** | small | 1 | 5 | +15% Heavy Weapon Burst | — |
| 5 | **Siege Mode** | small | 1 | 5 | +15% Heavy Weapon Burst | — |
| 6 | **Ion Surge** | small | 1 | 5 | +10% Shield Break Contribution from Ordnance | — |
| 7 | **Breaching Charge** | major | 3 | 1 | Ordnance attacks strip an additional 20% shield before DPS phase. | Ion Surge, Payload Expansion |
| 7 | **Concussive Payload** | major | 3 | 1 | Stagger effects last 30% longer and reduce boss damage output by 15% while active. | Concussion, Impact Force |
| 8 | **Scorched Earth** | major | 3 | 1 | If you bring a Launcher as Heavy Weapon, gain +20% armor break and +10% boss DPS. | Penetrator Rounds, Crack Core |
| 8 | **Cluster Bombs** | major | 3 | 1 | Ordnance has a 25% chance to trigger twice (second trigger at 50% damage). | Volatile Mix, Blast Radius |
| 9 | **Unstable Power** | keystone | 5 | 1 | Explosive damage contributes directly to Armor Break check. When armor is broken, next heavy weapon burst deals +50% damage. | Breaching Charge, Concussive Payload, Scorched Earth |

### Scavenger

| Tier | Node | Type | Cost | Max points | Effect | Requires |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Uplink Tap** | small | 1 | 5 | +15% Offline Earnings | — |
| 1 | **Background Processes** | small | 1 | 5 | +15% Offline Earnings | — |
| 2 | **Data Miner** | small | 1 | 5 | +10% Rare Drop Chance | — |
| 2 | **Scrap Filter** | small | 1 | 5 | +10% Rare Drop Chance | — |
| 3 | **Bulk Transfer** | small | 1 | 5 | +10% Loot Quantity | — |
| 3 | **Parallel Download** | small | 1 | 5 | +10% Loot Quantity | — |
| 4 | **Decompiler** | small | 1 | 5 | +20% Scrap Yield | — |
| 4 | **Compression** | small | 1 | 5 | +20% Scrap Yield | — |
| 5 | **Efficient Routines** | small | 1 | 5 | Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue). | — |
| 5 | **Conservation** | small | 1 | 5 | Workshop craft jobs run faster: −2% unit time per point (−20% across both nodes). | — |
| 6 | **Encrypted Payloads** | small | 1 | 5 | +5% Cache Quality Modifier | — |
| 6 | **Darknet Broker** | small | 1 | 5 | +5% Marketplace Listing Fee Reduction | — |
| 7 | **Hoarder's Instinct** | major | 3 | 1 | Salvaging gear grants +25% bonus scrap. | Decompiler, Compression |
| 7 | **Insurance Fraud** | major | 3 | 1 | Consumables used in a victorious boss fight have a 50% chance to be refunded. | Efficient Routines, Conservation |
| 8 | **Market Manipulator** | major | 3 | 1 | Listing fees reduced an additional 15% for items you personally found. | Darknet Broker |
| 8 | **Lucky Find** | major | 3 | 1 | +15% Rare Drop Chance. | Data Miner, Scrap Filter |
| 9 | **King of Scrap** | keystone | 5 | 1 | Low-rarity weapons gain +100% scrap value. Commons have 25% chance for bonus crafting material. Offline cap +4 hours. | Hoarder's Instinct, Insurance Fraud, Lucky Find |

### Fixer

| Tier | Node | Type | Cost | Max points | Effect | Requires |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Assembly Rhythm** | small | 1 | 5 | Workshop craft jobs run faster: −2.5% unit time per point (server-side, snapshotted at enqueue). | — |
| 1 | **Parallel Hands** | small | 1 | 5 | Workshop craft jobs run faster: −2.5% unit time per point (−25% across both nodes). | — |
| 2 | **Calibrated Eye** | small | 1 | 5 | +1 crafted quality shift per point (server-side, applied when a unit completes). | — |
| 2 | **Tolerance Stacking** | small | 1 | 5 | +1 crafted quality shift per point (+10 across both nodes). | — |
| 3 | **Torque Discipline** | small | 1 | 5 | Repair work runs faster: −3% unit time per point (snapshotted at enqueue/accept). | — |
| 3 | **Bay Choreography** | small | 1 | 5 | Repair work runs faster: −3% unit time per point (−30% across both nodes). | — |
| 4 | **Kit Stretching** | small | 1 | 5 | Patch kits restore +2.5% more condition per point (multiplies repair efficiency). | — |
| 4 | **Salvage Solder** | small | 1 | 5 | Patch kits restore +2.5% more condition per point (+25% across both nodes). | — |
| 5 | **Rig Tuning** | small | 1 | 5 | +2% vehicle yield bonus per point (adds into the yield affix bracket). | — |
| 5 | **Aero Fairings** | small | 1 | 5 | +2% vehicle yield bonus per point (+20% across both nodes). | — |
| 6 | **Lean Burn** | small | 1 | 5 | Vehicles burn −3% fuel per point (applied after fuel-efficiency affixes). | — |
| 6 | **Appraiser's Eye** | small | 1 | 5 | +1% vendor buyback rate per point (added to the buyback lever; the rate caps at 90%). | — |
| 7 | **Master Artificer** | major | 3 | 1 | Crafted gear temper chance +5%. | Calibrated Eye, Tolerance Stacking |
| 7 | **Fleet Engineer** | major | 3 | 1 | Vehicles lose 25% less condition per fueled tick. | Rig Tuning, Aero Fairings |
| 8 | **House Brand** | major | 3 | 1 | Marketplace listing fees reduced an additional 15% for Workshop-crafted items you sell. | Appraiser's Eye |
| 8 | **Second Shift** | major | 3 | 1 | +1 concurrent self-repair job. | Torque Discipline, Bay Choreography |
| 9 | **The Fixer** | keystone | 5 | 1 | Legendary Core Catalyst gear crafts gain +1 generation draw per unit. Each bench queue holds +1 job. Workshop Rush Ticket reduction cap rises to 55%. | Master Artificer, Fleet Engineer, Second Shift |
<!-- /wiki-gen:skill-trees -->

## Cache Rank

Cache Rank is not an achievement system: tokens come from levels
alone, and the seven tracks below are the whole menu. There is no
respec — ranks are permanent.

<!-- GENERATED from src/content/cacheRank.ts — do not edit by hand -->
<!-- wiki-gen:cache-rank -->
- **Earning:** 1 token per level gained, plus milestone bundles — Level 10: +5 · Level 25: +10 · Level 50: +15 · Level 75: +20 · Level 100: +25. Lifetime earnable by level 100: **174 tokens**.
- **Costs:** the next rank on a track costs 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 across its ten ranks (30 tokens to max one track). Maxing all 7 tracks costs **210 tokens** against 174 earnable — the menu is deliberately wider than the wallet.

| Track | Bonus applies to | Per rank | Max ranks | Tokens to max |
| --- | --- | --- | --- | --- |
| **Greed** | Credits earned from roaming, bosses, and the Chamber | +1% | 10 | 30 |
| **Fast Learner** | XP earned from every source | +1% | 10 | 30 |
| **Salvage Hound** | Scrap earned from roaming and the Chamber | +1% | 10 | 30 |
| **Heavy Hand** | Damage in roaming, boss fights, and the Chamber | +0.5% | 10 | 30 |
| **Thick Skin** | Maximum hunter HP | +1% | 10 | 30 |
| **Cache Optimizer** | Cache quality — Epic and Legendary cache draws weigh heavier | +2% | 10 | 30 |
| **Silver Tongue** | Market sale proceeds, paid on top of the post-fee amount | +0.5% | 10 | 30 |
<!-- /wiki-gen:cache-rank -->

---

_Source of truth: `src/constants/skillTrees.ts`, `src/content/cacheRank.ts` — rendered by `scripts/wiki-gen/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
