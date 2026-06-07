# CyberCache Master Mechanics Reference

> **Canonical source of truth for all game mechanics.** Updated with every feature change.  
> Any agent working on CyberCache should load this document first to understand the full mechanical landscape.

---

## 1. Legendary Effects (25 Total)

### Tier 1 (Boss Tier 1+) — SIMPLE STAT MODIFIERS

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `debt_collector` | Debt Collector | Pity system: +3% win chance per loss, cap +30% | Pity tracker in bossSlice, applied in simulateBoss() |
| `warranty_void` | Warranty Void | Each failed boss attempt: +2% base damage, cap +20% | Implemented in applyLegendaryEffects() |
| `ricochet_gospel` | Ricochet Gospel | Crits bounce: adds `critChance * 0.4` to damage mult | Implemented in applyLegendaryEffects() |
| `bad_decision` | Bad Decision | Hides win chance from player; +25% credit reward on win | Implemented via hasBadDecision() + applyBadDecisionBonus() |
| `glass_sun` | Glass Sun | Fire weapons: +50% damage. All: -30% survival | Implemented in applyLegendaryEffects() |
| `the_accountant` | The Accountant | Every 100 enemies killed: +1 rarity tier on next drop | **NOT YET IMPLEMENTED** |
| `armor_eater` | Armor Eater | Corrosive weapons: +20% armor break, -50% boss healing | Implemented in applyLegendaryEffects() |
| `thunder_receipt` | Thunder Receipt | Shield break via Shock: refunds 1 Ordnance charge | **NOT YET IMPLEMENTED** |

### Tier 2 (Boss Tier 4+)

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `second_opinion` | Second Opinion | Victory: loot roll happens twice, pick one | **NOT YET IMPLEMENTED** |
| `salvage_rights` | Salvage Rights | Kills with this weapon: +50% scrap | **NOT YET IMPLEMENTED** |
| `overclocked` | Overclocked | Attack speed ramps +5%/5s, crit drops -2%/ramp | Implemented (flat 1.15x approximation) |
| `borrowed_time` | Borrowed Time | If survival fails: auto-consume 1 MedKit to pass | **NOT YET IMPLEMENTED** |
| `kickback` | Kickback | Every 7th hit: 300% burst (avg +28.6% DPS) | Implemented |
| `vampiric_ledger` | Vampiric Ledger | 5% of damage dealt → bonus credits on win | **NOT YET IMPLEMENTED** |
| `echo_chamber` | Echo Chamber | 30% chance status re-applies (1.3x damage mult) | Implemented |
| `insurance_fraud_weapon` | Insurance Fraud | On defeat: 50% of consumed consumables refunded | **NOT YET IMPLEMENTED** |
| `market_crash` | Market Crash | 4x scrap value; 50% market fee bypass | **NOT YET IMPLEMENTED** |
| `stable_loop` | Stable Loop | Action Skill charges 25% faster when primary | **NOT YET IMPLEMENTED** |
| `phase_shifter` | Phase Shifter | First hit per phase ignores 40% of shield/armor | **NOT YET IMPLEMENTED** |
| `hot_swapper` | Hot Swapper | Secondary weapon contributes 60% (not 30%) | **NOT YET IMPLEMENTED** |

### Tier 3 (Boss Tier 7+)

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `chain_lightning` | Chain Lightning | Shock procs chain to 2 extra targets | **NOT YET IMPLEMENTED** |
| `molten_core` | Molten Core | Fire DoT stacks 5x; each stack -10% boss healing | **NOT YET IMPLEMENTED** |
| `cryo_stasis` | Cryo Stasis | Cryo procs: 20% mini-stagger (+5% DPS window) | **NOT YET IMPLEMENTED** |
| `void_bargain` | Void Bargain | +40% Void damage, 5% self-shield damage per hit | **NOT YET IMPLEMENTED** |
| `jackpot` | Jackpot | Every 150 kills: 1 Cache Key fragment | **NOT YET IMPLEMENTED** |

---

## 2. Consumables (19 Types)

### Survival

| Type | Effect on boss sim | Consumed When |
|---|---|---|
| `MedKit` | +150 HP to survival check | Emergency slot (if survival would fail) |
| `MedKitRefined` | +300 HP to survival check | Emergency slot |
| `ShieldCell` | +100 shield HP + faster recharge | Emergency slot |
| `NanoSwarm` | Repairs 250 shield over 10s | Emergency slot |
| `AdrenalineShot` | 1.25× survival multiplier (auto-revive) | Emergency slot (if survival would fail) |

### Offense — Ammo

| Type | Effect on boss sim | Consumed When |
|---|---|---|
| `AmmoPack` | +10s uninterrupted fire (reload skip) | Mid-Fight (when mag empties) |
| `ArmorPiercingAmmo` | +10s fire, +25% armor break | Mid-Fight |
| `IncendiaryAmmo` | +10s fire, +8% DPS (burn DoT) | Mid-Fight |
| `ShockAmmo` | +10s fire, +30% shield break | Mid-Fight |
| `CorrosiveAmmo` | +10s fire, +25% armor break, anti-heal | Mid-Fight |
| `CryoAmmo` | +10s fire, +15% survival (boss slow) | Mid-Fight |
| `VoidAmmo` | +10s fire, +20% DPS, -5% self shield | Mid-Fight |

### Offense — Ordnance / Stim

| Type | Effect on boss sim | Consumed When |
|---|---|---|
| `OrdnanceCharge` | +1 grenade use (shield/armor break) | Pre-Fight |
| `OverchargeStim` | +12% DPS (next 3 shots +100% avg) | Mid-Fight (at 50% HP) |
| `TargetPainter` | +15% DPS (+20% crit ≈ +15%) | Pre-Fight |
| `PhaseShiftGrenade` | +50% armor break (ignores armor 5s) | Mid-Fight |

### Utility

| Type | Effect on boss sim | Consumed When |
|---|---|---|
| `LuckBooster` | No combat effect. 25% extra loot on win | Pre-Fight |
| `BossScanner` | Reveals exact weakness % and true win chance | Pre-Fight |
| `InsuranceToken` | -50% death fee | Passive (applied on defeat) |
| `DataSkimmer` | 25% chance to duplicate one loot drop on win | Pre-Fight |
| `Jammer` | Cancels boss enrage/phase mechanic | Mid-Fight |
| `MagnetizedPayload` | +2 free ordnance uses | Pre-Fight |

### Consumables V2 Tactical Model

Consumables are tactical boss-prep tools, not generic stat buttons. Roaming combat does not auto-consume boss consumables; the player deliberately equips them for intentional boss attempts.

Each consumable definition includes:

- Slot eligibility: `PreFight`, `MidFight`, and/or `Emergency`
- Family: `survival`, `ammo`, `ordnance`, `tactical`, `economy`, or `corrupted`
- Trigger: fight start, shield phase, armor phase, boss mechanic, survival failure, victory, defeat, loot roll, or manual/current-sim abstraction
- Consume policy: `onAttempt`, `onTrigger`, `onVictory`, `onDefeat`, or `ifUsed`
- Counter tags: shield, armor, enrage, phase, repair, burn, burst, elite, loot, deathFee
- Effect and drawback rules consumed by the current score-based boss simulator

Starter V2 roles:

| Consumable | Slot | Tactical Role | Status |
|---|---|---|---|
| `MedKit` | Emergency | Emergency Save | implemented |
| `ShieldCell` | Emergency | Shield Sustain | implemented |
| `NanoSwarm` | Emergency | Attrition Repair | approximated by survival score |
| `AdrenalineShot` | Emergency | Emergency Save | approximated by survival score |
| `ShockAmmo` | MidFight | Shield Break | implemented |
| `CorrosiveAmmo` | MidFight | Armor Break / Repair Counter | approximated by break + mechanic score |
| `VoidAmmo` | MidFight | High-Risk DPS | implemented |
| `Grenade` / `OrdnanceCharge` | PreFight or MidFight | Burst Break | implemented |
| `TargetPainter` | PreFight | Focused DPS | implemented as DPS score |
| `BossScanner` | PreFight | Boss Intel | approximated by failure readout and mechanic support |
| `Jammer` | MidFight | Mechanic Counter | approximated by mechanic score |
| `InsuranceToken` | PreFight | Death Fee Cover | implemented |
| `DataSkimmer` | PreFight | Loot Risk | implemented as bonus loot roll |
| `LuckBooster` | PreFight | Loot Quality | implemented as bonus loot chance |

The current boss simulator still uses abstract score phases. PR 4 should replace that mapping with an event-driven boss simulation that can evaluate exact phase windows, trigger-level consumption, mechanic cancellation, and reward/death-fee timing.

---

## 3. Weapon Types & Signature Mechanics

| Type | Mag Duration | Reload | Signature Mechanic | Sim Effect |
|---|---|---|---|---|
| **Pistol** | 15s | 1s | Sidearm Recovery | 0s downtime; 30% DPS when ammo-starved |
| **SMG** | 10s | 2s | Overheat | 8s at 1.5× → 3s at 0.1× (avg ~1.09×) |
| **Shotgun** | 6s | 2.5s | Multi-Proc | 2.2× effective status chance |
| **Sniper** | 5s (shots) | 3s | Precision Window | +40% first 3s per phase (~3 phases) |
| **Launcher** | 2s | 4s | Reload Lock Stagger | 0.85× DPS; each shot = stagger attempt |
| **Beam** | 12s | 3s | Ramp & Sustain | 0.3→1.5× over 10s (avg ~1.1× long fights) |

### Ammo System

- **Reserve Fire**: When mag empty + no ammo pack → 30% DPS
- **Ammo Packs**: Each adds 10s uninterrupted fire, consumed mid-fight
- **Mag extension affixes**: +15% mag duration, -30% reload, 15% ammo efficiency

---

## 4. Manufacturers (6)

| Manufacturer | Weapon Bias | Shield Identity | Mod Identity | Relic Identity |
|---|---|---|---|---|
| **Redline** | +15% speed, -5% damage | Overcharge: low HP, fast recharge | Gunslinger bonus | +speed while shield full |
| **Ironwood** | +10% damage, -10% speed | Bastion: high HP, slow recharge | Boss damage nodes | +crit when low HP |
| **BlastForge** | +status chance, +explosive | Reactive: fire splash on break | Demolition bonus | Explosive kills → shield |
| **Prismatek** | +element match bonus, balanced | Adaptive: matches element taken | Elemental nodes | Status +2s |
| **ThrowTech** | +grenade damage, +stagger | Drone: 2 absorb charges | Scavenger bonus | Kills spawn turret |
| **HelixWorks** | +10 roll quality, random stat | Modular: 2 shield parts | Any tree, flexible | +1 random affix |

### Synergy Bonus
- 4+ matching manufacturers: +10% all stats
- 5+ matching: +15%
- 6 matching: +20%
- Weapon + Shield match: +5% bonus

---

## 5. Element Matchups

| Element | Strong vs (1.3×) | Weak vs (0.7×) |
|---|---|---|
| Kinetic | — (neutral, always 1.0×) | — |
| Fire | Flesh/Organic | Shield |
| Shock | Shield | Armor |
| Corrosive | Armor/Mechanical | Flesh/Shield |
| Cryo | Fast/Enrage | Armor |
| Void | Elite/Boss | Consistent |

---

## 6. Rarity System

| Rarity | Weight | Affixes | Quality Bias | Legendary? | Scrap Mult |
|---|---|---|---|---|---|
| Common | 60 | 0-1 | 0 | No | 1× |
| Uncommon | 25 | 1 | +5 | No | 1.5× |
| Rare | 10 | 2 | +10 | 5% | 2.5× |
| Epic | 4 | 3 | +15 | 15% | 4× |
| Legendary | 1 | 4-5 | +20 | 100% | 8× |

---

## 7. Salvage Formulas

### Base Scrap Alloy
```
ScrapAlloy = max(5, floor((level * 5 + 10) * rarityMult * (0.5 + rollQuality/100)))
```
### Type-Specific Materials
```
Weapon → BallisticParts = floor((level/3 + 1) * rarityMult * 0.6)
Shield/Ordnance → ReactiveComponents = floor((level/3 + 1) * rarityMult * 0.6)
ClassMod/Relic → TechFragments = floor((level/4 + 1) * rarityMult * 0.5)
Epic+ → VoidDust = ceil(rarityMult/4) × (rollQuality>80 ? 2 : 1)
```
### Elemental Essences
```
Elemental gear → baseEssence = ceil(rarityMult/2) + (rollQuality>75 ? 1 : 0)
Fire→IgnitionFluid, Shock→ConduitWire, Corrosive→AcidCompound, Cryo→CryoGel, Void→VoidEssence
```
### Part Bonus
```
PartBonus = parts.length * floor(level/5) extra ScrapAlloy
```

---

## 8. Crafting System (Workshop)

### Benches
- **Bench 1**: Unlock at Lv.5, free
- **Bench 2**: Unlock at Lv.15, 5,000cr
- **Bench 3**: Unlock at Lv.30, 25,000cr + 10 VoidDust
- Max 3 active queues (one per bench)

### Time Reduction (Scavenger Tree)
- Small nodes: 2% per point × 10 points = max 20%
- Keystone (King of Scrap): +15% → max 35%

### Cancel Refund
- Cancel active queue → 50% material refund

---

## 9. Skill Trees

### Gunslinger (Weapon scaling)
- **Small nodes**: weaponDamage, critChance, critDamage, attackSpeed, bossDamageMod, statusChance, shieldDamageMod
- **Majors**: Focus Fire (Sniper/Pistol +15%), Speedloader (+20% opening AS), Weakspot Analysis (+25% crit sub-50%), Elemental Overclock (+10% on matching weakness)
- **Keystone**: Death by a Thousand Cuts — crits → +25% DPS check; >50% crit → +10% boss damage

### Demolition (Ordnance/Armor break)
- **Small nodes**: ordnanceDamage, explosiveDamage, armorDamageMod, staggerChance, heavyWeaponBurst, ordnanceShieldBreak
- **Majors**: Breaching Charge (+20% shield strip), Concussive Payload (+30% stagger duration), Scorched Earth (Launcher: +20% armor, +10% DPS), Cluster Bombs (25% double ordnance)
- **Keystone**: Unstable Power — explosive → armor break; broken armor → +50% heavy burst

### Scavenger (Economy/Offline)
- **Small nodes**: offlineEarnings, rareDropChance, lootQuantity, scrapYield, consumableEfficiency, cacheQuality, marketFeeReduction
- **Majors**: Hoarder's Instinct (+25% auto-salvage, 10% bonus consumable), Insurance Fraud (50% consumable recovery), Market Manipulator (+15% found-item fee reduction), Lucky Find (+15% drop chance post-boss)
- **Keystone**: King of Scrap — low-rarity +100% scrap, 25% bonus material chance, +4h offline cap

### Skill Point System
- 1 point per level (starting at level 2)
- Respec costs: 100cr × total points spent

---

## 10. Boss Combat (4-Phase Engine)

### Phases
1. **Survival Check**: Player HP + Shield HP + MedKits/ShieldCells + NanoSwarm vs Boss DPS × 30s
2. **Break Check**: Shield damage + Armor damage vs Boss Shield/HP gates
3. **DPS Check**: Weapon DPS with ammo windows + consumable buffs vs Boss HP
4. **Mechanic Check**: Boss-specific trait threshold (stagger chance, element match, etc.)

### Risk Settings
| Setting | Survival | DPS | Consumables | Chaos |
|---|---|---|---|---|
| Conservative | 1.2× | 0.95× | 1.4× | -0.02 |
| Balanced | 1.0× | 1.0× | 1.0× | 0 |
| Greedy | 0.9× | 1.05× | 0.7× | +0.02 |
| AllIn | 0.8× | 1.15× | 1.6× | +0.04 |

### Death Fee
- Tier 1: 3% of credits (cap 2,500)
- Tier 2: 5% (cap 10,000)
- Tier 3: 7% (cap 25,000)
- Tier 4+: 10% (cap 50,000)

### Pity System
- +3% win chance per loss, cap +30%
- Resets on victory

### Consumable Consumption
- **Victory**: Pre-Fight + Mid-Fight consumed (Emergency only if triggered)
- **Defeat**: ALL loaded consumables consumed

### Boss Prep V2 / Event-Ready Analysis
- Boss fights are intentional prep encounters and remain separate from roaming combat.
- Boss definitions now include tags and phase metadata for mechanics such as shield regen, armor repair, enrage, phase/control, burn attrition, and multi-phase siege.
- Boss Prep analyzes each modeled phase against the existing survival, shield break, armor break, DPS, and mechanic score model.
- Phase status is shown as `safe`, `close`, `risky`, or `failing`.
- Prep now surfaces projected failure phase, current answers, missing counters, consumables at risk, and a plain-language risk profile.
- Consumables V2 counter tags feed the analysis. Shock Ammo answers shield phases, Corrosive/Armor-Piercing answers armor and repair, Jammer answers enrage/phase/repair, Target Painter answers DPS races, emergency sustain answers survival, Insurance Token reduces defeat-cost risk, and Boss Scanner improves intel.
- This is lightweight and event-ready, not a full final scripting engine. Event trigger labels such as `fightStart`, `shieldPhase`, `armorPhase`, `bossMechanic`, `emergency`, `victory`, `defeat`, and `lootRoll` are mapped onto the current score model.
- Deeper weapon part behavior, deterministic boss balance snapshots, and full event hooks are future PR 5+ validation/balance work.

---

## 11. Economy

### Credits
- Farming tick: zone.idleCreditsPerMinute / 20 per tick (3s intervals)
- Boss victory: level × 150 credits
- Boss defeat: death fee (as above)
- Vendor: buy consumables for credits
- Market: 10% listing fee

### Cache Keys
- Start with 3
- 3% drop chance per farming tick (fragments)
- 5 fragments → 1 key
- Cache odds: Rare 60%, Epic 32%, Legendary 8%

### Offline Claim
- Credits: zone.idleCreditsPerMinute × offline minutes × (1 + offlineEarnings bonus)
- Scrap: zone.idleScrapPerMinute × offline minutes
- Workshop: queues complete in real time
- Cap: 2-12 hours (extendable via Scavenger keystone)

---

## 12. Current Implementation Status

### ✅ Fully Wired
- Legendary effects: glass_sun, ricochet_gospel, warranty_void, debt_collector, armor_eater, kickback, overclocked, echo_chamber, bad_decision
- All 19 consumable effects in boss simulator
- Ammo windows + signature mechanics for all 6 weapon types
- Workshop crafting with 3 benches + offline completion
- Boss progression (unlock chain, pity system)
- Salvage yields with all material/essence types

### ⚠️ Partially Wired / Needs Hookup
- **Scavenger economy bonuses**: `rareDropChance`, `lootQuantity`, `scrapYield`, `offlineEarnings`, `cacheQuality`, `marketFeeReduction` — computed by getBonuses() but NOT applied to farming, offline claim, or scrap yield
- **DataSkimmer / LuckBooster extraLoot**: `executeBossAttempt()` returns `extraLoot` flag but BossPrepModal ignores it
- **Tier 2-4 legendary effects**: Defined in constants but switch statement in applyLegendaryEffects() has default→neutral
- **Auto-salvage Scavenger bonuses**: FightScreen scrapItem() doesn't apply scrapYield bonus

### ❌ Not Yet Implemented
- Missions / Dispatch Board
- Weapon parts extraction/socketing
- Fusion Lab (component-level upgrades)
- New boss mechanics (ammo drain, reflect, adaptive resist, etc.)
- Manufacturer synergy detection in simulator
- Consumable rarity tiers (Standard/Refined/Hyperion)
