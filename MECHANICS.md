# CyberCache Master Mechanics Reference

> **Canonical source of truth for all game mechanics.** Updated with every feature change.  
> Any agent working on CyberCache should load this document first to understand the full mechanical landscape.

---

## 1. Legendary Effects (25 Total)

Every effect below is in exactly one of three implementation tiers — the
Notes column says which, and `src/lib/legendaryEffects.ts` carries the
same labels at each case:

- **Implemented** — the described behavior runs in the authoritative
  path (boss simulator / Chef / Postgres applier) and changes outcomes.
- **SIM PROXY** — the boss simulator approximates the mechanic with a
  flat multiplier. The described mechanic itself (charge refunds, DoT
  stacks, proc chains, staggers…) does **not** exist; the proxy number
  is what the sim actually uses. Proxies are labelled, never implied
  to be the real mechanic.
- **Implemented in Chef/SQL** — fully implemented, but outside
  `applyLegendaryEffects()`: in the Chef claim/boss engine or a
  Postgres applier, where the economy outcomes actually resolve.

### Tier 1 (Boss Tier 1+) — SIMPLE STAT MODIFIERS

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `debt_collector` | Debt Collector | Pity system: +3% win chance per loss, cap +30% | Implemented — pity tracker in bossSlice, applied in simulateBoss(); the applyLegendaryEffects() case is a deliberate no-op |
| `warranty_void` | Warranty Void | Each failed boss attempt: +2% base damage, cap +20% | Implemented in applyLegendaryEffects() |
| `ricochet_gospel` | Ricochet Gospel | Crits bounce: adds `critChance * 0.4` to damage mult | Implemented in applyLegendaryEffects() (the single-target bounce return is the damage mult) |
| `bad_decision` | Bad Decision | Hides win chance from player; +25% credit reward on win | Implemented via hasBadDecision() + applyBadDecisionBonus() |
| `glass_sun` | Glass Sun | Fire weapons: +50% damage. All: -30% survival | Implemented in applyLegendaryEffects() |
| `the_accountant` | The Accountant | Every 100 enemies killed: +1 rarity tier on next drop | **SIM PROXY** — no drop-tier logic exists in any drop path. Sim instead grants a DPS bonus scaled by kill count (+3% per 100 kills, cap +15%) |
| `armor_eater` | Armor Eater | Corrosive weapons: +20% armor break, -50% boss healing | Armor break implemented in applyLegendaryEffects(). The -50% healing half is **not implemented**: the boss engine has no healing mechanic to reduce |
| `thunder_receipt` | Thunder Receipt | Shield break via Shock: refunds 1 Ordnance charge | **SIM PROXY** — no Ordnance/Action Skill charge refund exists. Sim grants +25% shield break for Shock weapons instead |

### Tier 2 (Boss Tier 4+)

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `second_opinion` | Second Opinion | Victory: the guaranteed loot roll happens twice; keep the stronger weapon, the other is auto-scrapped | Implemented in Chef/SQL — processBossAttempt() rolls the pair, keeps the higher-combatPower weapon, and credits the twin's standard salvage value via cc_apply_chef_boss_attempt (0008) |
| `salvage_rights` | Salvage Rights | Kills with this weapon: +50% scrap | Implemented in Chef — processRoamingClaim() multiplies claim scrap by 1.5 while this weapon is the primary (same multiplier stack as gear/skill scrap mods) |
| `overclocked` | Overclocked | Attack speed ramps +5%/5s, crit drops -2%/ramp | **SIM PROXY** — implemented as a flat 1.15x damage approximation; no ramp/decay is simulated |
| `borrowed_time` | Borrowed Time | If survival fails: auto-consume 1 MedKit to pass | **SIM PROXY** — no MedKit is consumed and no survival-fail rescue occurs. Sim grants a flat 1.25x survival multiplier instead |
| `kickback` | Kickback | Every 7th hit: 300% burst (avg +28.6% DPS) | Implemented in applyLegendaryEffects() as the exact average-DPS equivalent |
| `vampiric_ledger` | Vampiric Ledger | 5% of damage dealt → bonus credits on win | **SIM PROXY** — wired as a flat +5% victory-credit multiplier (consumed by the sim and the Chef boss path); it is not computed from damage dealt |
| `echo_chamber` | Echo Chamber | 30% chance status re-applies (1.3x damage mult) | Implemented in applyLegendaryEffects() as the exact expected-value multiplier |
| `insurance_fraud_weapon` | Insurance Fraud | On defeat: 50% of consumed consumables refunded | Implemented — getInsuranceFraudRefundChance() drives real per-type refund rolls in the Chef boss path and executeBossAttempt() |
| `market_crash` | Market Crash | This weapon's scrap value is 4x normal when recycled | Implemented in Chef/SQL — cc_recycle_item (0008) and its TS mirrors award 4x scrap. (The former "50% market fee bypass" clause was removed when no market fee existed; a 5% sale fee now exists (0017, see §11) but the effect remains scrap-only — no fee-bypass clause has been re-added) |
| `stable_loop` | Stable Loop | Action Skill charges 25% faster when primary | **SIM PROXY** — there is no Action Skill charge system to accelerate. Sim grants a flat 1.1x damage multiplier ("more frequent abilities") instead |
| `phase_shifter` | Phase Shifter | First hit per phase ignores 40% of shield/armor | **SIM PROXY** — no per-phase first-hit ignore exists. Sim grants a flat +15% shield/armor break instead |
| `hot_swapper` | Hot Swapper | Secondary weapon contributes 60% (not 30%) | Implemented — getHotSwapperSecondaryMult() is applied in bossSimulator() |

### Tier 3 (Boss Tier 7+)

| ID | Name | Mechanical Effect | Notes |
|---|---|---|---|
| `chain_lightning` | Chain Lightning | Shock procs chain to 2 extra targets | **SIM PROXY** — boss fights are single-target; no proc chains exist. Sim grants +20% Shock damage and +15% shield break instead |
| `molten_core` | Molten Core | Fire DoT stacks 5x; each stack -10% boss healing | **SIM PROXY** — no DoT stacking exists and the boss engine has no healing to reduce. Sim grants +25% Fire damage and +15% armor break instead |
| `cryo_stasis` | Cryo Stasis | Cryo procs: 20% mini-stagger (+5% DPS window) | **SIM PROXY** — no mini-stagger rolls exist. Sim grants +10% Cryo damage instead |
| `void_bargain` | Void Bargain | +40% Void damage, 5% self-shield damage per hit | Part implemented, part proxy — the +40% Void damage is exact; the drawback is approximated as a flat 0.85x survival multiplier, not per-hit self-shield damage |
| `jackpot` | Jackpot | Every 150th enemy killed by this weapon: 1 Cache Key fragment | Implemented in Chef — processRoamingClaim() awards the fragment when the server kill-cycle counter crosses a multiple of 150 while this weapon is the primary |

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

## 4.1 Roaming Areas

Roaming areas are normal AFK combat zones for the Fight screen's background loop. They are separate from boss fights, which remain intentional encounters selected and prepared through the boss flow.

Each roaming area is a place first, shaped by a dominant manufacturer philosophy:

| Area | Manufacturer Influence | Combat Identity | Loot / Material Focus |
|---|---|---|---|
| Dustwaste Frontier | Mixed | Starter roaming, balanced salvage, cache fragments | Balanced gear, ScrapAlloy, BallisticParts |
| Redline Circuit | Redline | High density, speed farming, sustained DPS | SMGs, pistols, attack speed, ScrapAlloy, BallisticParts |
| Ironwood Bastion | Ironwood | Fewer tougher elites, precision, better quality lean | Snipers, pistols, crit, BallisticParts, TechFragments |
| BlastForge Yards | BlastForge | Armor break, explosives, stagger pressure | Launchers, shotguns, ReactiveComponents, fire/corrosive flavor |
| Prismatek Reactor | Prismatek | Elements, status, weakness matching | Beams, elemental drops, elemental essences, TechFragments |
| ThrowTech Dumpnet | ThrowTech | Gadgets, deployables, drones, utility tech | Ordnance, utility gear, TechFragments, ReactiveComponents |
| HelixWorks Labyrinth | HelixWorks | Modular gear, roll quality flavor, crafting depth | HelixWorks gear, relics, TechFragments, VoidDust |

Current implementation:
- The selected roaming area persists in idle state and changes Fight screen presentation.
- Area choice influences displayed rates, enemy flavor, rarity weights, weapon manufacturer/type/element bias, gear-kind mix, and a small material/essence trickle.
- Existing stage zone data remains available, but player-facing roaming identity now comes from areas.
- **Area Legendary weights (pacing-baseline tuning, 2026-10-30)**: each area's `dropPoolRarityWeights` Legendary value is 0.1 (Dustwaste Frontier, Redline Circuit), 0.15 (Ironwood Bastion), or 0.2 (BlastForge Yards, Prismatek Reactor, ThrowTech Dumpnet, HelixWorks Labyrinth) — one tenth of the launch values, so a roaming Legendary is a rare event next to boss drops. Rare/Epic weights are unchanged, and so is the global §6 table (it feeds boss generic rolls and cache-forged generation, not area pools).

Deferred for later PRs:
- Full manufacturer reputation.
- Area-specific bosses or boss gating.
- Consumables V2.
- Deep material balance pass.
- Endgame region systems, dynamic events, or multiplayer/backend features.

---

## 4.2 Death & Resurrection (Roaming)

Shipped truth (Phase 0 Slice 4, 2026-10-30; migration `0013_death_resurrection.sql`):

**Death is server-computed and server-recorded.** The Chef claim sim decides when a monster hit takes the hunter to 0 HP. When that happens during a claim, the claim route persists the death on the profile — `profiles.death_state` = `{ diedAtMs, areaId, monsterId, monsterName }` — and prepends the entry to `profiles.death_log` (newest first, capped at 20). The first death wins: while a record stands, later claims never move `diedAtMs` or rewrite the killer. The claim response carries the record, and the client feeds it to the survival slice's `die()` — so the death overlay's "Killed by" line, the profile death log, and the free-recovery countdown all show the server's killer, area, and time (the countdown is anchored to `diedAtMs`, not the local clock).

**Resurrection is a server op: `POST /api/resurrect` (`cc_resurrect`).** Identity comes from the Chef JWT; the op requires a standing death record and is nonce-idempotent (a replay returns the stored result and never double-charges). Two paths:

- **Free Recovery** — available 5 minutes after the recorded death (`RESURRECTION_FREE_TIMER_MS`). `cc_resurrect` validates the elapsed time against the **database clock** and the recorded `diedAtMs`; the client's countdown is display only.
- **Pay Credits** — skip the timer. The price is `resurrectionCostForArea()` over the **recorded death area**: `unlockLevel × 100` credits, capped at 50,000 (100 cr in a level-1 area … 2,500 cr in HelixWorks). One shared function prices both the death screen's display and the server's charge, so they cannot drift. The op balance-checks and deducts atomically in the same transaction that clears the death state. The client deducts nothing locally; it syncs the profile the op returns.

Rejected with no charge and the death still standing: no death record (409), free timer not yet elapsed, insufficient credits. Boss defeats are separate — they cost the §10 death fee and never touch this system.

**The Revive Token does not exist.** The death screen used to offer a permanently disabled "Use revive token" option for an item with no consumable def, no acquisition source, and no server record; Slice 4 removed the option and every reference to it. A future revive token would need all three: a def in the consumable registry, a source (drop/vendor/recipe), and a server consume path in the resurrection op.

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

## 6.1 Shield Behaviors

Shields roll a behavior archetype at generation (weights by rarity in
`src/lib/combat/shieldBehaviors.ts` — Common mostly Standard, Legendary
always a real behavior). The behavior is stored in the item payload;
shields generated before behaviors existed carry no field and read as
Standard everywhere (never rewritten). One module owns the definitions
and tuning constants; roaming resolves behaviors per-hit inside
`computeMonsterDamageVsHunter`, the boss sim folds them into its pooled
model (`modelShieldBehaviorForBoss`).

| Behavior | Effect |
|---|---|
| Standard | No special behavior. |
| Nova | When the shield breaks (crosses to 0 while armed), it erupts for 150% of capacity damage — roaming: at the kill cycle's current target; boss: flat damage off the boss's HP. Fires once per break; re-arms only after the shield is restored above 50% of capacity. |
| Absorb | While the shield is up, each incoming hit has a 15% chance to be fully negated and restore 5% of capacity as shield HP. |
| Amp | While shield HP is at full capacity, outgoing damage ×1.25. (Boss sim: fight-averaged over the fraction of the fight the shield pool holds.) |
| Turtle | Capacity ×1.5 at generation, recharge rate ×0.5. Note: no engine consumes `rechargeRate` — shield HP rises only via Shield Cell restores / boss consumable pools — so in the current sims the capacity edge stands alone and the halved stat is the standing tradeoff wherever recharge is read. |

---

## 7. Salvage Formulas

Current authority: `cc_recycle_item` is the verified salvage economy path.
Inventory UI submits item id intent and syncs the returned profile/item state;
it must not award scrap, materials, or essences locally. The TypeScript
`calculateSalvageYield()` helper is an inspection/preview model until the RPC
is expanded to award the full material/essence breakdown server-side.

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

### What the RPC actually awards (Phase 2d)
`cc_recycle_item` awards scrap only: `cc_salvage_scrap(rarity, level)` (Market Crash legendaries ×4), then the Scavenger salvage skills multiply it — Hoarder's Instinct +25% (`salvageBonus`), King of Scrap ×2 on Common/Uncommon (`lowRarityScrapBonus`) — rounded once. King of Scrap also grants +1 bonus crafting material on salvaged Commons at 25% (`commonMaterialChance`), kind-mapped as in the Type-Specific table above (fallback ScrapAlloy). The TS owner of the skill math is `src/lib/skills/salvageBonuses.ts`; migration 0022 mirrors it in SQL and the in-memory stores call the TS owner. The rich material/essence breakdown above remains preview-only.

---

## 8. Crafting System (Workshop)

### Benches
- **Bench 1**: Unlock at Lv.5, free
- **Bench 2**: Unlock at Lv.15, 5,000cr
- **Bench 3**: Unlock at Lv.30, 25,000cr + 10 VoidDust
- Max 3 active queues (one per bench)

### Time Reduction (Scavenger Tree)
- Small nodes (Efficiency ×2): Consumable Efficiency converts to craft-time reduction at 2% per point, capped at 20% (`getCraftTimeWithReduction` in `src/lib/craftingEngine.ts`)
- No keystone craft-time bonus exists: King of Scrap's effects are salvage/offline (see §9). An earlier draft of this section claimed a keystone +15% — it was never in the defs or the engine; corrected in Phase 2d.

### Cancel Refund
- Cancel active queue → 50% material refund

---

## 9. Skill Trees

### Gunslinger (Weapon scaling)
- **Small nodes**: weaponDamage, critChance, critDamage, attackSpeed, bossDamageMod, statusChance, shieldDamageMod
- **Majors**: Focus Fire (Sniper/Pistol +15% boss damage), Speedloader (+20% attack speed for the first 10s), Weakspot Analysis (+25% crit damage while the boss is below 50% HP), Elemental Overclock (+10% on matching weakness)
- **Keystone**: Death by a Thousand Cuts — crits → +25% DPS check; >50% crit → +10% boss damage

### Demolition (Ordnance/Armor break)
- **Small nodes**: ordnanceDamage, explosiveDamage, armorDamageMod, staggerChance, heavyWeaponBurst, ordnanceShieldBreak
- **Majors**: Breaching Charge (+20% ordnance shield strip), Concussive Payload (+30% stagger duration, boss deals 15% less damage while staggered), Scorched Earth (Launcher heavy: +20% armor break, +10% boss DPS), Cluster Bombs (25% chance ordnance re-triggers at 50% damage)
- **Keystone**: Unstable Power — explosive → armor break; broken armor → +50% heavy burst

### Scavenger (Economy/Offline)
- **Small nodes**: offlineEarnings, rareDropChance, lootQuantity, scrapYield, consumableEfficiency, cacheQuality, marketFeeReduction
- **Majors**: Hoarder's Instinct (+25% salvage scrap), Insurance Fraud (50% consumable recovery on victorious boss fights), Market Manipulator (+15% found-item fee reduction), Lucky Find (+15% rare drop chance)
- **Keystone**: King of Scrap — low-rarity +100% scrap, 25% bonus material chance, +4h offline cap
- **Phase 2d (keystone skill layer)**: every major/keystone effect key now has a registered consumer (`src/lib/skills/skillConsumers.ts`, enforced by `src/test/keystoneSkillLayer.test.ts` — a dead key fails the suite). Hoarder's Instinct and Lucky Find were REPLACED: their old effects (auto-salvage yield / post-boss drop window) had no engine to consume them — no auto-salvage system exists, and no persistent post-boss session state exists — so the nodes now grant the salvage/rare-drop effects above at the same power. Node ids, names, positions, and costs are unchanged, so existing spends carry over with no migration. One SMALL node remains unwired, flagged openly: `cacheQuality` (Encrypted Payloads) — cache generation does not read it yet; follow-up inventory.

### Fixer (Crafting/Repair/Vehicles/Trade — migration 0029)
- **Small nodes**: craftSpeedBonus (craft unit time −2.5%/pt, multiplicative after the Scavenger term, combined floor 0.60×), craftQualityBonus (+1 quality shift/pt, composed with the lever under one [−10, +20] clamp), repairSpeedBonus (−3% repair time/pt), repairEfficiencyBonus (+2.5% kit restoration/pt, composes past the 1.5 mastery cap to a 1.80 ceiling), vehicleYieldBonus (+2%/pt into the yield affix bracket), vehicleFuelBonus (−3% burn/pt, after affixes), vendorBuybackBonus (+1% buyback rate/pt, added to the lever under the 0.90 ceiling)
- **Majors**: Master Artificer (+5% crafted-gear temper chance), Fleet Engineer (vehicles lose 25% less condition per fueled tick), House Brand (+15% fee reduction on Workshop-crafted items — disjoint from Market Manipulator's found-item term by the drop-source taxonomy, and never applied to repair service fees), Second Shift (+1 concurrent self-repair job — the cap lives on self-repair enqueue; board work stays uncapped-but-sequential)
- **Keystone**: The Fixer — core-catalyst gear crafts +1 generation draw/unit, bench queues hold +1 job, Workshop Rush Ticket reduction cap 0.45 → 0.55
- Every Fixer effect is consumed server-side from the player's own records (`computeSkillBonuses` in TS; `cc_skill_effective_points` in migration 0029's SQL) and registered in `src/lib/skills/skillConsumers.ts` — the zero-dead-keys law covers the fourth tree. The Fixer's action skill (Overclock) is a separate later slice; this slice is the tree only.

### Skill Point System
- **XP curve (stretched, pacing-baseline tuning 2026-10-30; migration 0016)**: XP to next level is `floor(100 · L^1.72)` below level 25, then `floor(25377 · (L/25)^0.5 · 1.048^max(0, L−45))` — 12,480,235 XP total to reach 100 (launch curve: 766,955). Early levels stay quick, the boss ladder takes a regular player ~7 weeks, and the post-45 tail compounds 4.8% per level: level 100 is a ~24-month horizon for a regular (6 roaming-h/day), 4+ years for a casual. One shared formula (`xpToNextLevel` in `src/content/simulation.ts`) drives the client, the Chef's `cc_apply_xp`, and the in-memory mirror; level derives from stored level + XP state, so the stretch needed no data migration. Skill-point income stretches with the curve — intended: the 99-point lifetime budget against 303 points of trees (226 + the Fixer's 77, migration 0029) is the longevity design, unchanged.
- 1 point per level (starting at level 2)
- Respec costs: 100cr × total points spent
- Respec is reachable in Profile → Skill Trees: the Respec button runs `cc_retrain` end-to-end (server charges total spent × 100cr, zeroes `skill_spends`, and the returned profile snapshot refunds the points in the UI immediately). Until Phase 0 Slice 5 the button only existed in the screen's standalone header, which the embedded Profile render suppressed — the mechanism worked but no player could reach it.

### Mastery
- ~29 tracks (`mastery_definitions`): weapons per type, locations per roaming area, combat (boss attempts/defeats, ordnance), economy (vendor, market, net worth), inventory (cache draws, recycling, scrap), consumable efficiency, consumable crafting, skills training, services.
- XP is granted by the verified-action ledger trigger (`cc_apply_mastery_for_verified_action`) and levels follow `cc_mastery_level` (level L → L+1 costs L² × 100 XP). Levels are display/progression only, except `crafting_consumables`, whose level widens the crafted-quality bounds in `cc_claim_crafted_consumable`.
- Shipped flows feed it (Phase 0 Slice 5, migration 0014 — before that, roaming and boss play granted nothing):
  - **Roaming claims + offline settlements**: location mastery for the *actual* area farmed (greatest(1, XP awarded), the legacy idle-claim rule; `dustwaste_frontier` maps to the original `locations.dustwaste` definition), weapon mastery = XP awarded for the equipped primary weapon's type, and consumable efficiency / ordnance from the consumed set.
  - **Boss attempts**: combat.boss_attempts +20 per attempt, combat.boss_defeats +100 on victory, weapon mastery = XP awarded (XP is victory-gated, so defeats grant none), consumable mastery from the prepared set actually consumed. Boss attempts grant **no** location mastery — bosses have no area in the data model; the legacy flat Dustwaste grant was fiction and was not carried over.
  - Legacy ops (cache draws, recycling, vendor, market, services, retrain, idle claim, battle result) keep their original grants.
- Players see their tracks in Profile → Mastery (level, total XP, and progress to the next level), read from `GET /api/mastery/summary`.

---

## 10. Boss Combat (4-Phase Engine)

### Shipped resolution flow (Phase 0 Slice 1, 2026-10-30)

The boss loop is wired end-to-end and resolves immediately,
Chef-owned:

1. The Fight workspace's prep panel (`BossEncounterPanel`) shows
   **boss intel only** — the def's stats, elemental nature,
   mechanic, phases with declared counters, and dedicated drops —
   plus the player's loadout summary and the consumables they
   **choose to prepare**. By design it never shows a win chance,
   readiness %, or "what you need" readout: preparing is the
   strategic layer; verdicts are not computed for the player. (The
   older "Boss Prep V2" analysis below describes the proxy score
   model the sim uses internally — it is no longer surfaced as a
   prep verdict.)
2. Starting sends **one** `POST /api/verify-boss` attempt with the
   boss id, an idempotency nonce, the prepared consumable counts,
   the risk setting, and the loadout payload.
3. The Chef resolves and persists everything in one application
   (`processBossAttempt` → `cc_apply_chef_boss_attempt`): entry
   fee, policy-applied consumption of the prepared set only,
   outcome, loot, pity, unlocks. The client then plays the fight
   animation from the returned timeline and, on victory, presents
   the loot through the shared `LootMoment`; on defeat it shows
   the applied costs (entry fee + death fee) and banked pity.

**Entry fee.** Charged server-side from the boss def: `entryCost`
for a first attempt, `rematchCost` once the boss is defeated.
Balance-checked before resolution and folded into the attempt's
net credit delta (migration 0011's `_entry_fee` parameter).
Defeat `creditsLost` itemizes `deathFee + entryFee`.

**Rematch escalation (pacing-baseline tuning, 2026-10-30).** The
base fee doubles for every victory the player has already banked
against that boss on the current UTC day — fee = base ×
min(8, 2^(victories today)), resetting at 00:00 UTC. The Chef
counts today's victories from the verified action ledger (nonce
replays never double-count) and charges the escalated fee; the
attempt response reports the charged fee and the post-attempt
count, and the prep panel displays the escalated fee before the
player commits (its counts arrive via the profile read and the
attempt responses).

**Boss unlocks.** Server-side, from the existing
`profiles.boss_state` jsonb (`unlockedBossIds`, default
`["dune_tyrant"]`): a locked boss is rejected with 403; a victory
unlocks the next boss in region order (maintained by the
applier).

**Prepared consumables.** The route validates the requested
prepared set against DB-owned counts (unknown type, invalid
count, or preparing more than owned → 400) and hands exactly that
set to the sim. `getBossConsumableUsage` charges the
policy-applied subset of the PREPARED set only (see "Consumable
Consumption" below). The pre-Slice-1 behavior — discarding the
prep, substituting the whole inventory, burning full stacks — is
gone.

**Dedicated drops.** Boss defs declare `dedicatedDrops`
(legendary effect ids; the mechanics validator enforces
dedicated ⊆ drop table). On a victory, the guaranteed loot roll
has a 10% chance (Chef constant `BOSS_DEDICATED_DROP_CHANCE` in
`src/server/chef.ts` — the defs declare no rate of their own;
25% at launch, cut to the Borderlands-standard 10% by the
2026-10-30 pacing-baseline tuning) to
become the dedicated drop: a Legendary weapon forced to an
effect drawn from the boss's dedicated list intersected with the
effects eligible for BossDrop at the boss's tier. The dedicated
weapon generates at `max(boss.level, playerLevel)` — boss levels
stop at 75 while roaming legendaries scale to 100, so a
boss-level dedicated drop lost the power race for high-level
farmers; generic boss rolls still generate at `boss.level`. The
result reports `dedicatedDropAwarded`; the client announces it.

**Boss XP.** A victory awards `boss.level × 50` XP (raised from
× 20 by the pacing-baseline tuning, before the XP multipliers
from relic/class-mod affixes and skill bonuses); defeats award
none.

**Roster expansion (tiers 8–13, boss levels 50–75).** Six bosses
continue the ladder past Scrap Bishop in region order, each with
a bespoke sprite, a unique arena, and a signature mechanic that
asks a different build question: Widow-9, the Spinneret (L50,
ThrowTech web-yard), The Mnemosyne Mirror (L55, Prismatek
refraction hall), The Static Choir (L60, Redline broadcast
straight), The Verdant Maw (L65, Ironwood heartwood grove),
Sister Null, the Void Anchor (L70, HelixWorks void lab), and
Vaultkeeper Omega (L75, the First Cache vault in the Dustwaste).
All standing formulas apply unchanged (fees + escalation, XP =
level × 50, dedicated chance, dedicated level =
max(boss, player)). Two mechanics are new sim behavior, both
implemented in `bossSimulator.ts` in the pooled expected-value
style of the shield-behavior models:

- **Overclock Ramp** (`overclock_ramp` — Spinneret, Vaultkeeper
  Omega): boss damage scales with fight length. Past a 20s grace
  window the survival score is divided by
  `min(2, 1 + 0.02 × (timeToKill − 20))` (×1.20 at a 30s kill,
  ×1.50 at 45s, capped ×2.00). Kill speed is the counter; DPS and
  time-to-kill themselves stay physical.
- **Adaptive Plating** (`adaptive_plating` — Mnemosyne Mirror):
  the boss attunes to the PRIMARY weapon's element — it is struck
  from her weaknesses and read as resisted for every DPS-chain
  call (and for the Elemental Overclock keystone condition).
  Secondary/heavy slots are untouched; the def's listed profile
  remains the prep intel, the attunement applies on top.

Two more ride existing hooks: the Static Choir's Harmonic Shroud
and Sister Null's Rift Anchor are `requiredLoadoutTrait` mechanic
gates (staggerChance ≥ 0.20 / statusChance ≥ 0.15, the Mirage
Duster pattern — an unmet gate halves the mechanic score, and a
Jammer does NOT cancel them), and the Verdant Maw's Living Armor
is a declared armor-break check (threshold 1.5) over a 9,000
armor pool. Molten Core, Cryo Stasis, Phase Shifter, and Hot
Swapper gain their first dedicated-drop homes on the new bosses.

**Class mod.** The equipped class mod enters the sim (wired in
Slice 1; it was previously a dead input): its `bossDamageMod`
affix adds to the boss-damage multiplier, `weaponDamage` /
`critChance` affixes scale DPS with the relic's weighting, and
`survivalBoost` scales survival like the relic's. Its tree
`nodeBoosts` already flowed through `skillBonuses`.

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
Charged from the player's **prepared set only**, per each def's
consume policy (`getBossConsumableUsage`):
- `onAttempt` (e.g. AmmoPack): always charged
- `ifUsed` (e.g. MedKit, ShieldCell): charged when the attempt's
  survival score is below 1 (the sustain was actually needed)
- `onVictory` (e.g. LuckBooster, DataSkimmer): charged on a win
- `onDefeat` (e.g. InsuranceToken): charged on a loss
Nothing outside the prepared set is ever touched.

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
- Market: listing is free in cc_market_create. A completed sale in cc_accept_listing charges a **5% market fee** (migration 0017; `MARKET_FEE_RATE` in src/lib/market/marketFee.ts), destroyed — the buyer pays the listed price and the seller receives 95%. The seller's Scavenger fee-reduction nodes reduce the fee as their defs describe: Darknet Broker −5% of the fee per point (to −25%), and Market Manipulator a further −15% for items the seller personally found (find drop source, not acquired from another player). NPC-seeded listings (supply_mode `npc_market`) are exempt — the NPC payout is unchanged

### Cache Keys
- Start with 3
- 0.8% drop chance per farming tick (fragments; `FRAGMENT_CHANCE` in the Chef — 3% at launch, cut by the 2026-10-30 pacing-baseline tuning, which minted ~7 keys/hour)
- 5 fragments → 1 key
- Cache odds: Rare 60%, Epic 32%, Legendary 8%

### Offline Claim
- Credits: zone.idleCreditsPerMinute × offline minutes × (1 + offlineEarnings bonus)
- Scrap: zone.idleScrapPerMinute × offline minutes
- Workshop: queues complete in real time
- Cap: EARNED by player level (pacing-baseline tuning, 2026-10-30; migration 0015) — L<20 → 2h, L20 → 4h, L40 → 6h, L60 → 8h, L80 → 12h, plus the Scavenger keystone's +4h (`offlineCapBonus`, wired by the same pass — its first consumer). The Chef derives the effective cap from the player's level and server-rebuilt skill bonuses at settlement and ignores any larger stored preference; the old free Settings choice (2–12h from day 1) is gone — Settings now displays the earned cap and the next tier's unlock level. Tier table source of truth: `src/content/offlineCap.ts`.

---

## 12. Current Implementation Status

### ✅ Fully Wired
- Shield behaviors (see §6.1): Nova / Absorb / Amp / Turtle rolled at generation, resolved in the roaming damage contract and the boss pooled sim from the one `shieldBehaviors.ts` module; legacy shields read as Standard
- Death & resurrection (see §4.2): server-recorded deaths (claim sim → `profiles.death_state`/`death_log`), server-validated free timer, server-charged paid revive at the displayed price, nonce-idempotent `POST /api/resurrect`
- Legendary effects (14): glass_sun, ricochet_gospel, warranty_void, debt_collector, armor_eater (armor-break half), kickback, echo_chamber, bad_decision, hot_swapper, insurance_fraud_weapon — plus second_opinion, salvage_rights, market_crash and jackpot, which are implemented in the Chef / Postgres appliers rather than the simulator (see §1)
- All 19 consumable effects in boss simulator
- Ammo windows + signature mechanics for all 6 weapon types
- Workshop crafting with 3 benches + offline completion
- Boss progression (unlock chain, pity system)
- Salvage yields with all material/essence types

### ⚠️ Partially Wired / Needs Hookup
- **Scavenger economy bonuses**: `rareDropChance`, `lootQuantity`, `scrapYield`, `offlineEarnings` are applied by the Chef roaming claim (Phase 2d wired `lootQuantity`); the salvage bonuses (`salvageBonus`, `lowRarityScrapBonus`, `commonMaterialChance`) apply in `cc_recycle_item` (migration 0022) and its in-memory twins; `marketFeeReduction` / `foundItemFeeReduction` reduce the market sale fee in cc_accept_listing (0017, see §11). The one remaining unwired skill key is the SMALL node `cacheQuality` (Cache Optimizer) — cache generation does not read it; tracked as follow-up inventory in the Phase 2d PR.
- **DataSkimmer / LuckBooster extraLoot**: `executeBossAttempt()` returns an `extraLoot` flag; the Chef folds the bonus rolls into the attempt's awarded items and `BossEncounterPanel` presents the full loot set via `LootMoment`
- **Legendary sim proxies (10)**: the_accountant, thunder_receipt, borrowed_time, vampiric_ledger, overclocked, stable_loop, phase_shifter, chain_lightning, molten_core, cryo_stasis — plus void_bargain's drawback and armor_eater's anti-heal clause. Each is a labelled flat-multiplier approximation in the boss simulator; the described mechanics do not exist yet (see §1 for per-effect detail)
- **Auto-salvage**: no auto-salvage engine exists — the `autoSalvage*` settings in idleSlice are inert display state, and salvage happens only through the verified recycle path (which applies the skill bonuses above). Hoarder's Instinct was replaced with a direct salvage bonus in Phase 2d rather than wiring a system that isn't there.

### ❌ Not Yet Implemented
- Professions — **design-only, parked** (Phase 0 Slice 5): the `PROFESSION_TRACKS` corpus in `src/content/gameContent.ts` and the `player_professions` table exist as a design record, but no screen imports the corpus, nothing reads profession state, and profession XP has no mechanical effect. Kept as a future candidate; not a shipped system.
- Missions / Dispatch Board
- Weapon parts extraction/socketing
- Fusion Lab (component-level upgrades)
- New boss mechanics (ammo drain, reflect, adaptive resist, etc.)
- Manufacturer synergy detection in simulator
- Consumable rarity tiers (Standard/Refined/Hyperion)

## 13. Roaming Variance + Visual Language (overhaul slice, migration 0023)

Authoritative content lives in `src/content/roamingEvents.ts` (event
tables, elite law, essence homes, signature materials),
`src/content/hotArea.ts` (date-seeded hot area), and
`src/content/offlineCap.ts` (AFK cap law); the Chef
(`src/server/chef.ts`) is the only engine that resolves them.

- **Events**: per-tick roll (5% base, economy lever `eventChanceBase`,
  clamp 15%), 4 named events per area × 7 areas. Event payouts fold
  into the claim's existing channels; events never mint outside them.
  Expected event value per tick is budget-capped at 8% of a plain
  tick (`eventValuePerTick`/`plainTickValue`, test-asserted).
- **Elites**: the kill cycle's elite target escalates at 12% per spawn
  (its own `:elite` RNG stream) into the area's named elite — HP ×3,
  guaranteed drop floored at Epic, +1 cache fragment. An Elite Patrol
  event forces the next elite spawn.
- **Hot area**: one area per UTC day, seeded from the date at claim
  time (never stored, never cron). +20% material finds, +10% yield,
  ×1.15 danger.
- **Materials**: two tiers — the 5 base materials everywhere, 5
  essences weighted to home areas, and 7 Tier-2 signature materials
  (Siltglass, Nitrocell Gel, Heartwood Resin, Forgeheart Ingots, Prism
  Shards, Magnetite Cores, Myco-Steel Fiber) that substitute into
  material finds ONLY in their home area (10% of finds) and trade on
  the market like any material (migration 0023 extends
  `cc_market_create_material`).
- **Consumables**: Loot Beacon (+3% event chance), Data Skimmer (find
  re-weighting + next-event foreshadow), Salvage Contract (roaming
  scope + material-event yield) and Magnetized Payload (cache/convoy
  weight) have real engine functions via the roaming consumable mods.
- **AFK cap**: effective = min(earned tier + keystone bonus, user
  limiter, 24h). The limiter is set in Settings and enforced at
  settlement (`cc_set_offline_cap_limiter`, migration 0023).
- **Visual language**: every action renders in the shared grammar
  (`src/lib/pixel/grammar.ts`, G-1..G-6). Actors are segmented rigs
  (`src/lib/pixel/rig.ts`) animated by transform; renders derive from
  the actual item instance (compositor weapon at the hunter's grip
  anchor, belt consumables, shield/relic/class-mod reads, the equipped
  vehicle with its affixes and condition). Golden-image regression
  (`src/test/goldenImages.test.ts`) pins the key scenes; baselines
  regenerate with `npm run golden:update`.

## 14. Action Skills (migration 0030)

One signature charged ability per skill tree, fired inside boss
attempts and endless encounters (never in roaming claims). Content
owner: `src/content/actionSkills.ts`; all magnitudes and charge
rates are live levers (economy config) with the defaults below.

**Unlock + selection.** A tree's signature unlocks when the player
owns that tree's keystone at effective points ≥ 1 — derived
server-side from skill spends + the equipped class mod (node boosts
and tree bonus), never from a client claim. A player qualified in
several trees records ONE active signature
(`profiles.action_skill_selection`, changeable where respec happens,
`POST /api/action-skill/select`); a selection whose keystone is
respecced away stops resolving and cannot fire. No keystone = no
action skill.

**Charge.** One pool, 0–100 (`profiles.action_skill_charge`).
Accrues from verified server settlements only: +34 per boss attempt
and +20 per endless encounter (levers
`actionSkillChargePerBossAttempt` / `...PerEndlessEncounter`); a
Fixer-selected player also gains +3 per craft unit completed and
+0.2 per repair condition point restored (levers, Fixer brief §3.7).
Endless charge carries across encounters within a run and resets to
0 at any run end (bank, death, depth cap, abandon-settle). Firing
requires a full pool, is validated inside the same server-owned
resolution (the client sends only a boolean intent), zeroes the
pool, and grants no accrual for that resolution; nonce replays
return the stored result and never double-fire.

**The four signatures** (defaults; clamps in the lever registry):
- **Gunslinger — Deadeye Salvo.** Flat damage = 12% of the target's
  max health (`gunslingerBurstBossHpShare` 0.12, clamp [0, 0.35]),
  resolved inside the sim: it joins netBossHp (kill clock) and, via
  the burst-exposure fold, cuts the boss's total damage by the same
  share. Measured: TTK −12.5…−15.1% at every tier; win-chance
  +0.00…+0.06 median (max +0.11).
- **Demolition — Saturation Strike.** Flat damage = 7% of max
  health, plus break bonuses = 35% of the target's shield/armor
  pools added to the sim's break totals, plus a stagger window
  (50% uptime × 30% mitigation) folded into the existing stagger
  term — no parallel combat math. Measured: win-chance +0.10 median
  on strong builds, +0.24…+0.52 on under-geared builds, max +0.57,
  concentrated on break-gated fights.
- **Scavenger — Cache Surge.** No sim effect: on a victorious fired
  resolution, +2 extra weapon rolls (`scavengerSurgeBonusRolls`,
  clamp [0, 5]) through the shipped drop pipeline with surge rarity
  weights (Epic ×1.5, Legendary ×2 — `scavengerSurgeLegendaryWeightMult`
  hard-clamped [1, 3]). Never the dedicated boss roll; surge drops
  ride the normal loot arrays and drop meters.
- **Fixer — Overclock** (brief §3.7, one pool, two fires). Combat
  fire: the attempt's prepared consumables read at quality ×1.25
  (`overclockQualityMultiplier`, clamp [1.0, 1.5]). Workshop fire
  (its own server op): instantly completes the in-progress unit on
  every active bench through the normal craft settler — identical
  outputs, quality, and XP; it buys time, never output — and
  refuses (without spending) when no unit is in progress.

**Balance band** (generator par builds, bosses within ±6 levels):
a fire must never make a fight worse, a single fire's win-chance
delta stays ≤ +0.65, and a hopeless fight (no weapons) stays at the
0.02 floor — flat damage cannot fabricate a win. Firing mints and
destroys no currency; fires are metered per tree per day
(`action_skill_fires_*`).

## 15. Cache Rank (migration 0031)

A Badass-rank analogue: a SEPARATE token currency earned from LEVELS
and spent on tiny permanent bonuses. Content owner:
`src/content/cacheRank.ts`; every magnitude is a live lever (economy
config) with the defaults below. Cache Rank never touches the
skill-point budget (level − 1 points) and is never respec'd — tokens
are level-bound, bonuses are tiny and broad, so a misclick is cheap
by construction (deliberate non-goal: no respec; this is not an
achievement system — it pays for levels, not feats).

**Earning.** 1 token per level gained (`cacheRankTokensPerLevel`,
clamp [0, 3]) plus milestone bundles at levels 10 / 25 / 50 / 75 /
100 of +5 / +10 / +15 / +20 / +25 (bundle at milestone k =
`cacheRankMilestoneBundleBase` + step × (k − 1); both levers clamp
[0, 25]). Entitlement(L) = (L − 1) × perLevel + Σ bundles ≤ L:
L10 = 14, L25 = 39, L50 = 79, L75 = 124, L100 = 174 — **174 tokens
is everything a level-100 hunter can ever earn** at defaults.
Grants are SERVER-DERIVED and exactly-once: `profiles.cache_rank_grant_level`
is a watermark; a BEFORE UPDATE trigger on `player_level`, the
idempotent `cc_grant_cache_rank_tokens` RPC, and an inline grant
inside the spend RPC all advance it under the row lock, each paying
entitlement(level) − entitlement(watermark) and recording a
`cc_cache_rank_grant` ledger row keyed
`cache-rank-grant:{uid}:{from}:{to}`. A pre-existing profile
(watermark 0) is granted its full retroactive entitlement ONCE on
first touch, never again — replays, claims, and offline settlements
cannot double-grant because the watermark only moves forward and
the ledger key refuses a second insert. Guests earn identically;
nothing is account-gated.

**Spending.** `cc_spend_cache_rank` (nonce-idempotent via the
verified-action ledger): one rank of one track per call. Cost of the
next rank at r ranks = round(`cacheRankCostBase` + `cacheRankCostGrowth`
× floor(r / 2)) — at defaults 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 = **30
tokens per track, 210 for the whole menu > 174 earnable**, so full
completion is impossible and choices stay real. Each track caps at
10 ranks; per-rank effects and all-maxed totals:

| Track | Per rank | All-maxed (10 ranks) | Consumer |
|---|---|---|---|
| Greed (credits) | +1% earn rates | +10% | Chef claim/boss/endless rates, multiplied LAST |
| Fast Learner (XP) | +1% XP | +10% | Chef rates + craft/repair completion XP (both twins) |
| Salvage Hound (scrap) | +1% scrap | +10% | Chef claim/boss salvage/endless scrap |
| Heavy Hand (damage) | +0.5% damage | +5% | Chef derived DPS + boss sim seam |
| Thick Skin (max HP) | +1% max HP | +10% | Mechanics snapshot + boss sim (base HP only; shield HP unscaled) |
| Cache Optimizer (quality) | +0.02 cache quality | +0.20 | `cc_make_item` draw + TS twin — WIRES the dead `cacheQuality` skill effect (#216) into the same lane: non-minimum rarity tiers' weights × (1 + q) |
| Silver Tongue (market) | +0.5% of post-fee proceeds | +5% | `cc_accept_listing` + TS fee mirror — see order below |

**Market composition order** (documented, test-pinned): sale price
→ fee = rate × (1 − Darknet/Manipulator/House Brand reductions),
destroyed → Silver Tongue uplift = floor(post-fee proceeds ×
fraction), MINTED to the seller and metered inside
`credits_minted_other`. NPC listings are exempt from the fee branch
and therefore from the uplift. Earn multipliers compose LAST, after
gear, skill, activity, and hot-streak terms. All seven tracks are
registered in `CACHE_RANK_BONUS_CONSUMERS`
(`src/lib/skills/skillConsumers.ts`): a track whose consumer needle
disappears from its engine fails the Cache Rank structural test —
the #216 dead-bonus discipline.

**Meters.** `cache_rank_tokens_granted` (Σ `tokens_granted` over
`cc_cache_rank_grant`) and `cache_rank_tokens_spent` (Σ `cost` over
`cc_cache_rank_spend`) in the daily economy metrics + in-memory twin.

## 16. Dispatch + Courier Contracts (migration 0032)

Timed contracts for SPARE loadouts (foot) and SPARE vehicles
(courier), running PARALLEL to the personal action slot — roaming,
crafting, boss, and endless are never touched. Terms are computed
by the content owner (`src/content/dispatch.ts`) from server
records, snapshotted into `dispatch_missions` at departure, and
settled server-side from the row alone.

**Board.** Six date-seeded offers per UTC day (families by index:
foot, courier, foot, foot, courier, foot; area + duration
hash-picked). The server recomputes the board at departure — a
forged offer id never validates. Durations are 2h / 8h / 24h.

**Queue slots.** One shared pool for both families, sized by the
`dispatchQueueSlots` lever (default 2, clamp 1–8) — a subscription
may raise it later (convenience only; nothing built).

**Foot.** The player commits 1–8 spare gear items (available,
unequipped, non-vehicle). Strength = clamp(0.5–1.5, Σ(itemLevel ×
rarity weight) / (7 × area unlock × 1.15)). Payouts: credits =
round(hours × area credits/min × 60 × `dispatchCreditRate` 0.4 ×
strength); scrap likewise at `dispatchScrapRate` 0.4; materials =
floor(hours × (1 + unlock/20) × `dispatchMaterialRate` 1 ×
strength), the material seeded from the area's bias. At matched
strength 1.0, dispatch pays exactly 0.4× roaming's credits/hour —
a side faucet, never the best AFK income. No XP, no gear, no
legendaries, no cores.

**Courier.** Tiers gate on the assigned VEHICLE's class unlock
(2h ≥ 1, 8h ≥ 18, 24h ≥ 42) — never player level. routeTicks =
hours × `courierRouteTicksPerHour` (120). Fuel = routeTicks × the
shipped burn formula, debited in full at departure and refused at
shortfall (prep names the exact cell shortfall). Wear = routeTicks
× the shipped decay formula. BREAKDOWN (R10) is deterministic: iff
projected wear reaches departure condition, the vehicle fails at
fraction condition/wear — settled pro-rata, unflown fuel refunded,
vehicle home at 0 condition for the repair lane (#220). Prep shows
projected wear, return condition, and the breakdown point before
departure. Worked cases (High danger, 24h): Relay Skimmer — 5,760
fuel, 115.2 wear, breaks at 100/115.2; Armored Crawler — 4,320
fuel, 23.04 wear, returns at ~77. Credits = the foot line at
strength 1 × `courierPremiumMultiplier` 1.6; scrap unpremiated;
materials = foot units + floor(foot units × vehicle material
bonus) — the Cargo Hauler's second job (Leviathan Rig: 0.15).

**Settlement.** Lazy on dispatch reads/departures, IN FULL at term
(the AFK cap does not truncate dispatch). Recall settles at the
elapsed fraction, capped at the breakdown point. Pro-rata payouts
floor. Departure and recall are nonce-idempotent; a consumed start
nonce returns its stored departure even though the committed gear
is by then in_service.

**Escrow.** Committed instances are `in_service` + locked for the
duration: refused by dispatch re-assignment, recycle (0026),
reforge (0027), repair post/enqueue (0025), and — restated in
0032 — equip, market create, and the item lock toggle.

**Leviathan Rig (R11).** Seventh vehicle class: unlock 75, base
yield 1.50, burn 1.6/tick, decay ×0.50, material bonus 0.15.
Crossover vs the Skimmer: both average ~1.45 yield over 2,000
fueled Medium-danger ticks; the Rig pulls ahead by 5,000 ticks on
~20% less fuel (3,200 vs 4,000). Generator-gated below
areaUnlockLevel 20 (the Skimmer pattern).

**Meters.** Settle payouts fold into `credits_minted_dispatch`
(foot) and `credits_minted_courier` in the daily economy metrics,
both inside the minted total.

## 17. Extraction (migration 0033)

The gathering occupation: timed material production for the
crafter economy, occupying the PERSONAL action slot like crafting
(roam OR craft OR extract OR boss/endless — one at a time).
Content owner: `src/content/extraction.ts`; server state:
`public.extraction_state`; TS twin `src/server/writes/extractionEngine.ts`.

**Passes.** Work runs in 10-minute passes at one site (area +
method). A pass accrues ONLY while `extraction` is the active
action, under crafting's settlement window math verbatim (attended
time to the heartbeat + 300s grace, never truncated; the away tail
capped by min(earned offline tier, user limiter) in [1h, 24h];
offline settlement passes its keystone-inclusive cap in as an
explicit max-advance). Accrued ms carry across pauses; passes
complete back-to-back while the slot holds. Site/method changes
take effect at the NEXT pass boundary — a pass always settles on
the terms it started on (its `{index, areaId, method}` is stored
in `pending_passes` at completion).

**Settlement split.** Accrual is pure time accounting
(`cc_settle_extraction_time`, hooked into the restated
`cc_set_active_action` / `cc_clear_active_action` and called by
the Chef before rolls); the rolls are TypeScript (the find pool
and tick-RNG streams have no SQL twin) and finalize through
`cc_apply_extraction`, which re-validates the batch (sequential
indexes continuing the finalized count, each pass matching the
pending record, find keys inside the 20-material / 5-essence
whitelist, per-pass units ≤ 2× draws, draws ≤ 500) and prices XP
itself. Settles happen at activity transitions, state reads
(`GET /api/extraction/state` settles first), and offline
settlement at login (the recap gains an extraction section).

**Yield.** Each pass performs `round(32 × gearFactor ×
methodYield × masteryYield × hotAreaFactor)` draws against the
area's shipped pool (`rollAreaMaterialFind`: base materials at
weight 2, essences 3 at home / 0.75 as guest) — 192 draws/hour
Surface, 2× roaming's ~96 finds/hour byproduct rate. Material
finds in their home area substitute the Tier-2 signature at
`extractSignatureChance` 0.15 on the `extract:signature` stream
(roaming's own 0.10 is a separate constant). Scavenger
`lootQuantity` applies per find (+1 unit at the skill total).
Finds are materials and essences ONLY — no gear, credits, scrap,
fragments, or cores, and no events or elites. Roaming's activity
mods, roaming consumable find mods, and VEHICLES do not apply
(v1 boundary).

**XP.** `passXp = round(1/6 × benchmarkXpPerHour(level) ×
extractXpRate)` — the crafting peg (1200 ticks × the best
unlocked area's idleXpPerTick) at the 0.75 ruling, lever
hard-clamped [0.70, 0.85] in the accessor, the SQL applier, and
`cc_extract_pass_xp` (which delegates to `cc_craft_unit_xp` at
600000 ms so the twins cannot drift). Measured across the ladder:
0.750–0.7525 of roaming's hourly XP. Cache Rank's XP bonus
composes once per pass. Mastery: `gathering.extraction`, 20 XP
per completed pass; yield +0.5%/level past 1, capped +25%. No
location or weapon mastery is earned.

**Gear factor.** Priced at settlement from server records:
`clamp(pool / (pool + expectedPassDamage), extractGearFactorFloor
0.40, 1.00)` where pool is the one HP formula
(`computeHunterMaxHp`) + shield capacity, and expectedPassDamage
runs the area's roster through the shipped monster-damage path
(accuracy × attack power × element/shield mitigation) as an
expectation over the pass's 200 ticks. Gear swapped mid-pass
reprices the unfinished pass at completion — deliberately unlike
crafting's snapshot.

**Deep Delve.** Surface Sweep ×1.0 anywhere unlocked. Deep Delve
×`extractDeepYieldMult` 1.5 (288 draws/hour): selecting it
requires mastery ≥ 5 (refused at the op below that); each deep
pass ALSO requires the gear factor ≥ 0.80 at settlement — a pass
settling below pays as Surface and the UI says why. The factor
is never a selection gate, so gear swaps degrade gracefully
instead of erroring.

**Gates.** Starts ride `cc_set_active_action` (kind
`extraction`): verified accounts only (guests refused), no
standing death record, the area must exist and be unlocked.
Forged gear-factor/mastery/area claims are never read — every
input is a server record.

**Meters.** `extraction_passes`, `extraction_xp_awarded`, and
`materials_minted_extraction` (jsonb by material id — the mint
mirror of `materials_destroyed_crafting`) fold the
`cc_apply_extraction` ledger rows in `cc_compute_economy_metrics`
+ the in-memory twin. Levers: `extractXpRate` 0.75 [0.70, 0.85]
hard, `extractFindsPerHour` 192 [48, 480], `extractSignatureChance`
0.15 [0, 0.40], `extractDeepYieldMult` 1.5 [1.0, 2.5],
`extractGearFactorFloor` 0.40 [0, 1],
`extractMasteryYieldPerLevel` 0.005 [0, 0.02].
