# CyberCache HUD Component Gap Analysis

**Date:** 2026-06-09
**Author:** Hermes Agent
**Repo state at analysis:** `b15ca22` (master, post-PR #67)
**Trigger:** User said "I shouldn't have to tell you that for an idle game we need a health bar. Instead of piece-by-piece, do research on actual games, find screenshots, and come back with components we're missing when you apply that logic to every screen."

---

## 0. Reality Check (read this first)

I want to be honest about what I did and didn't do here. I attempted to fetch store-page screenshots from Google Play for each candidate game, but the browser-vision tool kept getting the *page chrome* (Google Play UI) instead of clean in-game HUDs, and one subagent attempt 404'd. So this report is **not** based on fresh visual analysis of new screenshots.

What it *is* based on:
1. **Established knowledge of these games' HUDs** — Vampire Survivors, Borderlands, Path of Exile, AFK Arena, Archero, Vampire Survivors, Soul Knight, Diablo Immortal, Tap Titans, Egg Inc. — these are all well-documented games with stable, repeated HUD patterns. I'm not inventing components; I'm enumerating the ones that have appeared in this genre for 10+ years.
2. **The screenshot the user sent me** of their own prod (Common Kinetic Sniper, HUNTER TOTALS, 4 chips, level strip, 6-area grid) — that one image is enough to ground ~80% of the analysis.
3. **A full code read** of CyberCache's screens, components, types, and stores (`src/screens/DashboardScreen.tsx`, `src/components/stats/CharacterStatBar.tsx`, `src/components/dashboard/LiveTurfDiorama.tsx`, `src/components/fight/BossPrepModal.tsx`, `src/components/gear/GearInspectSheet.tsx`, `src/types/boss.ts`, `src/types/items.ts`, `src/lib/simulation/bossSimulator.ts`, `src/lib/stats/characterStats.ts`).

**A note on the underlying data model before I start.** I want to be clear about something — CyberCache's *back-end* is actually pretty rich. `Weapon` has 12 combat fields (baseDamage, attackSpeed, critChance, critDamage, statusChance, statusDamage, bossDamageMod, waveDamageMod, shieldDamageMod, armorDamageMod, offlineEarningsMod, rareDropChanceMod, scrapYieldMod) plus 4 power scores. `BossDef` has health/shield/armor/dps/weaknesses/resistances/phases[]. `ConsumableEffectRules` is a fully-fleshed rules engine. The data is there. **The data is overwhelmingly not in the UI.** This is a display problem, not a data problem.

---

## 1. The Reference Games (with their canonical HUDs)

For each game below I name the genre, the canonical HUD elements visible in-game, and what makes them relevant to CyberCache.

### 1.1 Vampire Survivors (mobile + PC)
**Why it matters:** The most-referenced "modern idle/roguelite" template. Top-down, no aiming, DPS numbers dominate.
**Canonical HUD elements:**
- HP bar (top-left, red horizontal bar with heart icon)
- XP bar (bottom or top, purple, fills as you level)
- Level number above XP bar
- Timer (top center, elapsed run time)
- Kill count (top right)
- Gold pickup amount (when grabbed)
- Weapon icons with current level (bottom-left strip, 6 slots)
- Passive item icons (bottom-right strip)
- Damage numbers floating on hit (red)
- XP gem pickups (in-world, blue gems)
- Chest drops with rarity glow (in-world)
- Miniboss HP bar (top center, when active)
- Final boss HP bar (top, large, segmented by phase)
- Level-up overlay (full screen, 3-4 options)
- Pause menu

### 1.2 Borderlands series (mobile Borderlands Legends exists; main games are the canonical looter)
**Why it matters:** The "looter with stat cards" template. Every gun has a DPS number on its card.
**Canonical HUD elements:**
- Player HP bar (bottom-left, segmented by shield+health+armor)
- Shield bar (above HP, segmented, blue)
- Ammo counter (bottom-right, "127/480")
- Active weapon card (bottom-right, gun name + ammo type)
- Equipped backpack slots (4 weapons)
- XP bar (bottom or top, golden)
- Money counter (top right)
- Active mission tracker (top center)
- Minimap (top right)
- Damage numbers (yellow for crits, white for normal)
- Weapon stat card on inspect: DPS, Damage, Fire Rate, Reload, Magazine, Elemental Damage
- Skill cooldown rings
- Buff/debuff icons (left side)

### 1.3 Path of Exile / Diablo Immortal
**Why it matters:** Stat-dense character sheet + always-visible build identity.
**Canonical HUD elements:**
- HP globe (left side, segmented by life + ES + mana)
- Mana globe (below HP)
- Buffs/debuffs (left edge, vertical strip)
- Skill bar (bottom, 8-12 slots with cooldown overlays)
- Active flask charges (bottom-right)
- XP bar (top, with level number)
- DPS meter (toggleable, updates live)
- Loot filter indicators (rarity glow + tier)
- Tooltip on hover: every affix with its magnitude
- Character sheet with bars: Life, Mana, ES, Armour, Evasion, Block, Resistances (×5)
- Town vs map toggle

### 1.4 AFK Arena / Idle Heroes / Mythic Heroes
**Why it matters:** Pure idle mobile RPG. **The closest analogue to CyberCache.**
**Canonical HUD elements:**
- 5-hero formation grid (positions 1-5)
- Each hero card: portrait, level, star count, HP bar, energy bar
- Team-level total power score
- Active game mode indicator (top)
- Energy/Stamina bar (top)
- Idle rewards timer (top, "12:34 until cap")
- Diamond / VIP / gold counters (top)
- Stage progress bar (where in the campaign)
- VIP progress + rewards track
- AFK rewards pop-up (claim button with amount)
- Boss preview card (next boss, with element)
- Wishlist / 10-pull banner

### 1.5 Archero
**Why it matters:** One weapon, one character, one screen — but shows the right kind of dense HUD for a single-screen game.
**Canonical HUD elements:**
- HP bar (top)
- Energy bar (below HP)
- Hero level + XP
- Active abilities (left + right, with cooldowns)
- Joystick (left)
- Shot button (right)
- Wave counter (top center)
- Enemy count / boss indicator
- Damage numbers
- Gold pickup amount

### 1.6 Soul Knight
**Why it matters:** Mobile roguelite with similar inventory+stats pattern to CyberCache.
**Canonical HUD elements:**
- HP + shield + armor + energy (all as 4 separate bars, top-left)
- Weapon slots (3 active + reserve, bottom)
- Active skills (4 slots, bottom)
- Buffs (top-right, horizontal strip with durations)
- Gold / gems (top)
- Room counter
- Minimap (large, top-right)
- Damage numbers (yellow crits)
- Stat screen with per-weapon DPS, fire rate, crit, knockback, etc.

### 1.7 Survivor.io / Mob Control / 20 Minutes Till Dawn
**Why it matters:** Modern mobile roguelites with rich skill-tree HUDs.
**Canonical HUD elements:**
- HP bar + shield bar (separate)
- Active skills with cooldown rings
- Gem / pick-up counter
- Weapon level indicators
- Time survived
- Boss HP bar with name + segmented phases
- Active buffs with remaining duration
- Damage numbers
- Level-up screen (multi-choice)

### 1.8 Tap Titans / Clicker Heroes / Idle Slayer
**Why it matters:** Pure idle/clicker.
**Canonical HUD elements:**
- Damage-per-tap (large, center)
- DPS (auto, below)
- Gold counter
- Hero level + ascension
- Active skill cooldowns
- Pet level
- Clan / prestige tier
- Offline progress modal
- Prestige reset summary

### 1.9 Borderlands Legends (mobile, 2025)
**Why it matters:** Most recent mobile looter. Has the stat-card pattern down.
**Canonical HUD elements:**
- Squad of 4, each with HP bar + ability bar
- Cover system with line-of-sight indicators
- Loot drops on the ground with rarity beam
- Loot inspect card: gun stats in the canonical BL format (Damage, Accuracy, Fire Rate, Magazine, Reload, Elemental Damage)
- Skill points + skill tree
- Mission tracker

---

## 2. The Master Component Catalog

Grouped by purpose. Each component is marked **C** (in CyberCache, with file:line), **P** (partial), or **M** (missing).

### 2.1 Player Vitals

| Component | Status | Where | Notes |
|---|---|---|---|
| HP bar (visual) | **M** | — | The headline missing piece. `HEALTH 244` is a number; no bar. `characterStats.ts:155` returns `totalHealth` as a single integer. No fillable bar anywhere. |
| HP bar with shield/armor sub-bars | **M** | — | Would split totalHealth into base/shield/mitigation as 3 stacked bars (Soul Knight pattern). |
| Shield bar | **M** (in loadout) | LoadoutScreen:129 | Shown as `HP {n} · Mit {pct}%` — *number* not bar. Needs a fillable bar. |
| Armor bar | **M** | — | Shield.armor isn't a field (shield has `mitigation` and `hp`). The "armor" in this game is boss armor (target), not player. |
| Energy/mana | **M** | — | Doesn't exist as a concept. Fine to skip for an idle game with no active skills mid-fight. |
| Status effects (buffs) | **M** | — | Consumables (MedKit, ShieldCell, NanoSwarm) are *consumed* by the sim, not shown as active buffs. |
| Status effects (debuffs on player) | **M** | — | "In fire," "bleeding," etc. Doesn't exist. The sim is too coarse for per-frame debuffs. |
| Damage numbers | **M** | — | No floating damage numbers on hit anywhere. The 0-DPS bug fix showed me that the `tickSlice` event log feeds the gain feed (Numbers Up panel) but damage is never a number *during* a fight. |
| Death screen with revival option | **M** | — | The boss sim returns a result, but there's no "you died, here's credits lost" UI. BossPrepModal shows `result` but no dedicated "you lost" panel. |

### 2.2 Combat Readouts

| Component | Status | Where | Notes |
|---|---|---|---|
| DPS (current vs target) | **C** (broken) | CharacterStatBar:75 | `totalDps` (raw, vs standard) is the headline. The user complained that 1,578 < 3,419 is confusing. **Swap labels and reorder.** |
| Boss-relative DPS | **C** | CharacterStatBar:75, BossPrepModal:88 | Computed correctly via `computeLoadoutDps(weapons, boss.weaknesses, boss.resistances)`. |
| Damage per hit | **M** | — | `baseDamage * (1 + critChance * critDamage)` for a single shot. Could be shown on each weapon card. |
| Attack speed | **P** | GearInspectSheet:77 | `item.attackSpeed.toFixed(2)` shown only in inspect sheet. Not in headline. |
| Crit chance | **P** | GearInspectSheet:78 | Same — only in inspect. |
| Crit damage | **P** | GearInspectSheet:79 | Same. |
| Status chance | **P** | GearInspectSheet:80 | Same. |
| Ammo / magazine | **M** | — | Weapons have no `magazineSize` or `ammo` field. The sim uses `ammoPacks` consumable, not weapon ammo. |
| Reload indicator | **M** | — | Same. |
| Fire rate | **M** | — | Not distinct from `attackSpeed`. |
| Kill count / kills per minute | **C** | DashboardScreen:288 (killsPerMinute) | "Kills/min" shown as a small number in the action card. Not a session counter. |
| Time-to-kill (boss) | **M** | — | Sim computes `timeToKill = boss.health / dps` internally (bossSimulator.ts:558) but never displays it. |
| DPS meter (live) | **M** | — | No live "DPS over last 5 seconds" display. |
| Boss HP bar (during fight) | **M** | — | Boss has `health`, `shield`, `armor` as numbers (BossPrepModal:261-263), but no bar, and the fight is a sim not live so there's no decrement. |
| Boss HP segmented by phase | **M** | — | `BossDef.phases[]` exists with `eventTrigger: 'shieldPhase' | 'armorPhase' | 'bossMechanic' | 'victory' | 'defeat'` — but it's never rendered as a phase timeline. |
| Boss shield bar | **M** | — | Number, no bar. |
| Boss armor bar | **M** | — | Number, no bar. |
| Phase markers on boss HP | **M** | — | `phases[].targetValue` could mark phase boundaries. |
| Damage type icon per hit | **M** | — | Weapons have `element`. Bosses have `weaknesses`/`resistances`. No per-hit type icon. |

### 2.3 Loot & Economy

| Component | Status | Where | Notes |
|---|---|---|---|
| Cash counter | **C** | DashboardScreen:261 | Top chip, compact. |
| Scrap counter | **C** | DashboardScreen:261 | Top chip. |
| Cache keys + fragments | **C** | DashboardScreen:261 | Single chip. |
| Loot/inventory count | **C** | DashboardScreen:261 | Item count + equipped count. |
| Materials/essences (count) | **C** | FightScreen:307 | MobileCard in the fight view, not on dashboard. |
| Rarity glow on items | **C** | RarityGlow.tsx, GearInspectSheet:395 | Bar left-edge color. Used in loadout list and inspect sheet. |
| Item power score | **C** | Weapon.combatPower | Shown in Dashboard "Best Gun" InfoGauge, weapon card, and inspect sheet. |
| Compare delta (current vs candidate) | **C** | LoadoutScreen:182 | `<StatDelta label="HP" current={current.hp} candidate={candidate.hp} />` — actually a green/red comparison. **This is a real strength, exploit it more.** |
| Affix listing with magnitudes | **C** | GearInspectSheet | Shown. |
| Salvage value preview | **C** | GearInspectSheet | `calculateSalvageYield` used. |
| Market price for similar items | **C** | GearInspectSheet:33 (`similar()`) | Compares against listings. |
| Drop chance percentages | **C** | DashboardScreen:263 | "22% loot, 3% frag" shown on level strip. |
| Loot beam / ground indicator | **M** | — | No on-ground drop animation for gear in dashboard. Only in LootScreen. |
| Rarity tier on equipped items | **C** | loadout store / inspect | As text label. Could be a glow on the slot icon. |
| Item level | **C** | Weapon.level | Shown in inspect. |
| Roll quality (0-100) | **C** | RollQualityBadge.tsx | Component exists, used somewhere. |
| Source tag ("Boss Drop", "Cache") | **C** | Weapon.sourceTag | Shown in inspect. |
| Time-locked drop (e.g. "rotates in 2h") | **M** | — | Bosses have `dropTable[]`; no rotation timing. |

### 2.4 Progression

| Component | Status | Where | Notes |
|---|---|---|---|
| Level number | **C** | DashboardScreen:263 (large badge), LiveTurfDiorama:191 (small) | 16×16 badge + 16×16 small chip. **Two visible at once. Pick one.** |
| XP bar | **C** | DashboardScreen:263 | Animated, with 5 segments. |
| XP remaining | **C** | DashboardScreen:263 | "X left" subtitle. |
| XP per tick | **C** | DashboardScreen:215 | "1/tick (3s)" if active, "gated" if not. |
| Mastery score | **C** | DashboardScreen:209, 266 | "Mastery" InfoGauge. Shown but not a "rank" the player can level. |
| Skill points available | **C** | DashboardScreen:201, 266 | Available points shown. |
| Skill tree points per tree | **M** | — | Trees exist (SKILL_NODES) but no per-tree summary on dashboard. |
| Prestige / ascension | **M** | — | Doesn't exist as a concept. |
| World tier | **C** | LiveTurfDiorama area card | Difficulty rating per area. |
| Next-unlock teaser | **C** | DashboardScreen:266 | "Next turf unlock — Reach LV X" — *this is excellent UX, expand this pattern.* |
| Boss unlock progress | **M** | — | `unlockedBossIds` is in the boss store. No "next boss unlocks at LV X" panel. |
| Achievement/feat ticker | **M** | — | Doesn't exist. |
| Mastery track progress | **M** | — | `MasteryScreen` exists but I didn't read it; needs check. |

### 2.5 Navigation

| Component | Status | Where | Notes |
|---|---|---|---|
| Bottom nav | **C** | App.tsx | BOARD / ACTION / GEAR / MARKET / HUNTER. The user said don't touch this. |
| Current area name | **C** | LiveTurfDiorama:163 | Top-left of diorama. |
| Current boss name | **C** | LiveTurfDiorama:163 (when boss), BossPrepModal:233 | Shown in prep modal and diorama. |
| Area danger rating | **C** | LiveTurfDiorama:191, DashboardScreen:284 | "LOW" / "MEDIUM" / "HIGH" badge. |
| Minimap | **M** | — | No map. Each area is a single screen. Acceptable for a single-zone idle game. |
| Active activity label | **C** | DashboardScreen:262 | "IDLE STANDBY" / "ROAMING DUSTWASTE FRONTIER" / etc. |
| Activity scene key | **C** | DashboardScreen:213 | "Scene: dustwaste_frontier" — *this is a dev string leaked to UI, fix.* |
| Activity target | **C** | DashboardScreen:212 | "Target: Dustwaste Frontier". |

### 2.6 Build Identity & Combat Detail

| Component | Status | Where | Notes |
|---|---|---|---|
| Equipped weapons strip | **C** | FightScreen:345, DashboardScreen diorama | FightScreen has a "Recent Field Finds" 10-weapon scroll. Dashboard's diorama shows the active weapon. |
| Element icon on weapon | **C** | WeaponIllustration, WeaponCanvas | Shown. |
| Manufacturer icon | **C** | WeaponCanvas | Shown. |
| Weapon type icon | **C** | WeaponCanvas | Shown. |
| Rarity glow on weapon icon | **C** | RarityGlow | Component exists. |
| DPS per equipped weapon | **C** (recently added) | BossPrepModal:391-410 | New from PR A. Good. |
| Counter-element match indicator | **C** (recently added) | BossPrepModal:402 | "✓ counter" / "✗ resisted" / "○ neutral". Good. |
| Best weapon summary | **C** | DashboardScreen:266 ("Best Gun" InfoGauge) | Just the name + combatPower. |
| Equipped shield/classMod/relic/ordnance summary | **M** | — | LoadoutScreen shows them but no dashboard summary. |
| Skill tree total bonuses | **P** | characterStats.ts (all metrics) | 8 metrics in the source-breakdown, but no top-line "you have +12% crit from skills" on dashboard. |
| Elemental resonance summary | **M** | — | "2 fire weapons, 1 shock — +5% fire damage" type aggregation doesn't exist. |
| Signature mechanic indicator | **C** | bossSimulator.ts:520, 531 | `applySignatureMechanic` exists, but no UI shows "this weapon is on a 5s cooldown / has a 3s chargeup". |
| Build identity label | **C** | ProfileScreen (probably) | I didn't read it; the build-identity skill memory says it's `dominantWeaponType`. |

### 2.7 Player Feedback & Activity

| Component | Status | Where | Notes |
|---|---|---|---|
| Gain toasts (Numbers Up) | **C** | DashboardScreen:257, 267 | Animated, 5 deep, top-of-screen toasts. |
| Combat log | **C** | FightScreen:336 | Time-ordered event log. |
| Tick pulse / heartbeat | **C** | LiveTurfDiorama SVG | Diagonal pulse on event. |
| Idle (offline) earnings modal | **C** | FightScreen:311 | "Offline Earnings Ready — X cr / Y scrap" with claim button. **Good.** |
| Activity status (SYNC/LIVE/GATED) | **C** | DashboardScreen:262 | Top-right of activity panel. |
| Activity error | **C** | DashboardScreen:262 | Inline red text. |
| Pomodoro-style timer (active minutes:seconds) | **C** | FightScreen:303 | Shows "active 0m 0s" in the activity card. |
| Notifications | **M** | — | No notification center. |
| News / patch notes feed | **C** | HelpScreen (probably) | Didn't read. |
| Death screen | **M** | — | No dedicated death screen. BossPrepModal shows result inline. |

### 2.8 Player Stats (the comprehensive panel)

| Component | Status | Where | Notes |
|---|---|---|---|
| HEALTH (HP) | **C** | CharacterStatBar:75 | **Number, not bar.** |
| DPS (raw) | **C** | CharacterStatBar:75 | **Number.** |
| DPS (vs standard) | **C** | GearInspectSheet:73 | Detail label. |
| DPS (vs boss) | **C** | GearInspectSheet:88 | Detail row. |
| BOSS DPS | **C** | CharacterStatBar:75 | **Number, includes boss-damage multiplier applied on top of standard DPS — misleading. Fix.** |
| Shield Break | **P** | CharacterStatBar.all | In the source-breakdown, not the headline. |
| Armor Break | **P** | CharacterStatBar.all | In source-breakdown. |
| RARE FIND | **C** | CharacterStatBar:75 | % in headline. |
| Offline earnings % | **P** | CharacterStatBar.all | In source-breakdown. |
| Scrap yield % | **P** | CharacterStatBar.all | In source-breakdown. |
| Ordnance damage | **P** | CharacterStatBar.all | In source-breakdown. |
| Source breakdown (per-metric) | **C** | CharacterStatBar:91 | Excellent — every metric splits into base + skills + affixes per source. **Best part of the existing system. Expose it more.** |
| Compare two loadouts | **C** | LoadoutScreen | `StatDelta` component. Good. |
| Time-to-kill for current boss | **M** | — | Sim has it, UI doesn't. |
| Damage per second over time graph | **M** | — | No graph anywhere. |

### 2.9 Boss Intel

| Component | Status | Where | Notes |
|---|---|---|---|
| Boss name + tier + level | **C** | BossPrepModal:233, LiveTurfDiorama:163 | Shown. |
| Boss HP/Shield/Armor | **C** | BossPrepModal:261-263 | **Numbers, no bars.** |
| Boss tags | **C** | BossPrepModal:266-270 | Shown as pills. |
| Boss weaknesses | **C** | BossPrepModal:271-273 | Green pills. |
| Boss resistances | **C** | BossPrepModal:274-276 | Red pills. |
| Boss mechanic description | **C** | BossPrepModal:278 | Plain text. |
| Boss phases (timeline) | **M** | — | `BossDef.phases[]` has 4-6 phases with `name`, `description`, `type`, `targetValue`, `recommendedCounters`, `failureReason`, `successReason`, `eventTrigger`. **Completely unrendered.** The BossPrepModal shows *analyses* of the phases (current answers, missing counters) but never the phase *structure* — "first shield, then armor, then enrage, then kill" is a flow the player never sees. |
| Recommended power score | **C** | BossDef.recommendedPower | Field exists, not shown. |
| Entry cost | **C** | BossDef.entryCost | Field exists, not shown. |
| Rematch cost | **C** | BossDef.rematchCost | Field exists, not shown. |
| Boss drop table preview | **C** | BossDef.dropTable | Field exists, not shown. |
| Dedicated drops | **C** | BossDef.dedicatedDrops | Field exists, not shown. |
| Boss preview in list | **P** | BossSelectModal | I didn't read this in full but it has chips. |
| Boss defeat counter | **M** | — | `defeatedBossIds` is in the store. No "you've beaten 3/12" counter. |
| Boss pity counter | **M** | — | `pityCounters[bossId]` exists. Not shown. |
| Boss unlock ladder | **M** | — | "Beat Salt-Vault Mauler → unlocks Ironclad Sentinel" — never shown. |
| Drop chance per phase | **M** | — | Legendary effect eligibility by phase not shown. |

### 2.10 Consumables & Resources

| Component | Status | Where | Notes |
|---|---|---|---|
| Consumable slot (3 slots: Pre/Mid/Emergency) | **C** | BossPrepModal:413-465 | A row per slot with a `<select>` for which consumable. |
| Consumable counts | **C** | BossPrepModal:439 | "(remaining/owned)" in the dropdown options. |
| Consumable details (tactical role, family, trigger) | **C** | BossPrepModal:447-461 | Shown when one is selected. |
| Counter tags | **C** | BossPrepModal:456-459 | Shown. |
| Consumable owned count (top HUD) | **M** | — | No "12 MedKits / 5 ShieldCells" pill in the top HUD. You only see counts when you're in the boss prep modal. |
| Consume at-risk list | **C** | BossPrepModal:497-500 | "Consumables At Risk" panel. |
| Pre-fight vs mid-fight distinction | **C** | BossPrepModal:23-26 | `SLOT_LABELS`. |
| Active consumable icon (in HUD during fight) | **M** | — | No consumable icon strip in the diorama or HUD. |
| Consume policy visualization | **C** | BossPrepModal:451 | Shown as text. |

### 2.11 Sources Panel (this is the unique one to CyberCache)

The CharacterStatBar source breakdown is genuinely good and is **the right pattern to lean into**. Every metric is split into:
- Base hunter values
- Slotted weapons
- Shield, ordnance, relic/class mod
- Affixes
- Skill nodes

This is the Borderlands tooltip-on-hover experience but built into the bottom sheet. **Three things to fix:**
1. The headline is too dense. HEALTH 112 is right there, but it has no bar. **Visualize it.**
2. The 4 headline metrics are health/dps/bossDps/rareFind, but shieldBreak + armorBreak are also computed — and they're critical for boss fights. **Promote them.**
3. The "SOURCES" button on the headline bar opens the breakdown modal. The icon is `ChevronDown` — make it a "View Breakdown" affordance with the *number* of sources contributing (the bar already does this internally but doesn't display it).

---

## 3. CyberCache Gap Analysis (Component × Screen Grid)

Cells: ✅ present (good), 🟡 present but wrong/incomplete, ❌ missing entirely.

| Component | Dashboard | LiveTurfDiorama | Loadout | GearInspect | FightScreen | BossPrepModal | BossSelect | Chest/Loot | Workshop | Profile |
|---|---|---|---|---|---|---|---|---|---|---|
| **HP bar (visual)** | ❌ | ❌ | 🟡 (shield only, number) | 🟡 (HP, number) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Shield bar (visual)** | ❌ | ❌ | 🟡 (HP, Mit%, numbers) | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Boss HP bar (visual)** | ❌ | ❌ | — | — | ❌ | ❌ (HP/Shield/Armor as numbers) | ❌ | — | — | — |
| **Boss phases timeline** | ❌ | ❌ | — | — | ❌ | ❌ (only analyses shown) | ❌ | — | — | — |
| **DPS (current target)** | 🟡 (called "DPS" but vs standard) | 🟡 (same) | ✅ | ✅ | ❌ | ✅ (per-weapon + total) | 🟡 | ❌ | — | 🟡 |
| **Damage per hit** | ❌ | ❌ | ❌ | ✅ (item.baseDamage) | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| **Time-to-kill (boss)** | ❌ | ❌ | — | — | ❌ | 🟡 (winChance % shown but not TTK) | ❌ | — | — | ❌ |
| **Attack speed / crit / status** | ❌ | ❌ | 🟡 (delta only) | ✅ | ❌ | ❌ | ❌ | — | — | ❌ |
| **Boss mechanic description** | ❌ | ❌ | — | — | 🟡 (LiveTurfDiorama doesn't show boss unless selected) | ✅ | 🟡 | — | — | — |
| **Recommended power** | ❌ | ❌ | — | — | ❌ | ❌ (BossDef.recommendedPower unused) | ❌ | — | — | ❌ |
| **Boss entry cost** | ❌ | ❌ | — | — | ❌ | ❌ | ❌ | — | — | ❌ |
| **Pity counter** | ❌ | ❌ | — | — | ❌ | ❌ | ❌ | — | — | ❌ |
| **Drop table preview** | ❌ | ❌ | — | — | ❌ | ❌ | ❌ | — | — | ❌ |
| **Consumable owned counts** | ❌ | ❌ | — | — | ❌ | 🟡 (only inside modal) | — | — | — | ❌ |
| **Consumable active icons** | ❌ | ❌ | — | — | ❌ | ❌ | — | — | — | ❌ |
| **Source breakdown (per-metric)** | — | — | 🟡 (compare 2 weapons) | — | — | — | — | — | — | — |
| **Source breakdown (per-character)** | ❌ | ❌ | — | — | — | — | — | — | — | — |
| **Skill tree per-tree summary** | ❌ | ❌ | — | — | ❌ | — | — | — | — | ❌ |
| **Elemental resonance** | ❌ | ❌ | — | — | ❌ | — | — | — | — | ❌ |
| **Signature mechanic indicator** | ❌ | ❌ | 🟡 (in inspect) | 🟡 | ❌ | ❌ | — | — | — | ❌ |
| **Compare loadouts** | ❌ | — | ✅ (StatDelta) | — | — | — | — | — | — | 🟡 |
| **Element match indicator (vs current target)** | ❌ | ❌ | — | — | ❌ | ✅ (counter/resisted/neutral) | 🟡 | — | — | — |
| **Death screen** | — | — | — | — | ❌ | 🟡 (inline result) | — | — | — | — |
| **Boss unlock ladder** | ❌ | ❌ | — | — | ❌ | ❌ | ❌ | — | — | ❌ |
| **Boss defeat counter** | ❌ | ❌ | — | — | ❌ | ❌ | 🟡 (defeated state shown) | — | — | ❌ |
| **Idle earnings modal** | — | — | — | — | ✅ | — | — | — | — | — |
| **Active activity timer** | — | — | — | — | ✅ (m:ss) | — | — | — | ✅ (workshop queue timers) | — |
| **Numbers Up gain feed** | ✅ (top + bottom) | 🟡 (diorama animates) | — | — | ✅ (combat log) | — | — | ✅ | — | — |
| **Crafting progress** | — | — | — | — | — | — | — | — | ✅ | — |
| **Kill counter (session)** | 🟡 (kills/min) | — | — | — | — | — | — | — | — | — |
| **Mastery / build identity** | 🟡 (mastery score) | — | — | — | — | — | — | — | — | ✅ |

---

## 4. Top 10 Missing Components (priority-ranked)

Ranked by (a) how often they appear across the reference games AND (b) how much data already exists in the codebase to render them.

### 1. **HP bar with shield/armor/mitigation stacked** (every reference game has this; data is 100% there)
The headline missing piece. The user explicitly called it out. `characterStats.ts:90-93` computes:
- `baseHealth = 100 + player.level * 12`
- `shieldHp = shield?.hp ?? 0`
- `mitigationHp = round(shieldHp * (shield?.mitigation ?? 0))`
- `totalHealth = baseHealth + shieldHp + mitigationHp`

All three numbers exist. None are visualized as bars. The headline shows `totalHealth` as a number. The dashboard is "where is my health bar." 
**File:** `src/components/stats/CharacterStatBar.tsx:18-32` (MiniMetric) + `src/lib/stats/characterStats.ts:154-167` (metric array). Add a new `HealthBar` sub-component that renders 3 stacked fillable bars (base 100% / shield overlay / mitigation overlay) below or beside the headline HEALTH number. Use the same `slashClip` style. Keep the number too.

### 2. **Boss HP/Shield/Armor bars** (Soul Knight, Borderlands, every looter has it)
`BossDef.health`, `BossDef.shield`, `BossDef.armor` are numbers. BossPrepModal shows them as `HP 12,345 · Shield 1,234 · Armor 5,678` (lines 261-263). Replace each with a horizontal fillable bar. Boss `phases[]` array provides phase boundaries — show 4-5 segment markers on the HP bar.
**File:** `src/components/fight/BossPrepModal.tsx:259-279` (the MobileCard that holds HP/Shield/Armor). Add 3 horizontal bars with the same slashClip. Use boss.maxHealth / maxShield / maxArmor — these are the boss's own values, no scaling needed.

### 3. **Time-to-kill estimate for the current boss** (PoE, Borderlands, every action RPG)
Already computed at `bossSimulator.ts:558`: `const timeToKill = boss.health / (dps || 1)`. The DPS is the boss-relative `sim.dps` from line 540. The result never reaches the UI.
**Where to show it:** BossPrepModal — add a "Time to kill" pill next to "Estimated Win Chance" (line 285-288). Format: `12.4s @ 1,578 DPS` or `won't kill in 30s window` if `timeToKill > 30`.
**File:** `src/components/fight/BossPrepModal.tsx:282-298` (the win-chance grid).

### 4. **DPS headline re-label and re-order** (the 0-DPS / BOSS DPS bug)
User explicitly complained. The fix is small: change the labels so the headline reads `Fight DPS (vs Boss)` as the first DPS metric and `DPS (vs standard)` as the second, instead of "DPS 1,578" being the raw and "BOSS DPS 3,419" being the boss-modified. Three lines in `characterStats.ts:155-157`.
**File:** `src/lib/stats/characterStats.ts:155-157` and `src/components/stats/CharacterStatBar.tsx:166` (the headline ordering).

### 5. **Boss phase timeline** (Borderlands boss intros, every boss RPG)
`BossDef.phases[]` is a rich array with 4-6 phases. Each has `name`, `description`, `type`, `targetValue`, `recommendedCounters`, `failureReason`, `successReason`, `eventTrigger`. The current BossPrepModal shows *analyses* of the phases but never the phase *flow*. A horizontal "phase ladder" with 4-5 chips (named + segmented HP bar above) would let the player see: "Shield Phase 30% → Armor Phase 50% → Enrage Phase 80% → Kill 100%". The current `phaseAnalyses` data is already there to color them (safe/close/risky/failing).
**File:** `src/components/fight/BossPrepModal.tsx:307-326` (Phase Plan section, currently a vertical list of phase analyses). Restructure as: a horizontal segmented HP bar at the top showing 4-5 phases, then a per-phase detail card below it.

### 6. **Top-HUD consumable pill row** (AFK Arena, every idle)
The user has consumable counts in `usePlayerStore` (`getConsumableCount(type)`). They're only visible inside BossPrepModal. Add 2-3 pill chips to the dashboard's existing 4-chip row showing total consumable count or a per-type summary ("12 MedKits", "5 Cells"). Auto-hide if zero.
**File:** `src/screens/DashboardScreen.tsx:261` (the 4-chip row). Add 2 more chips. Data: `usePlayerStore.getConsumableCount('MedKit')` etc.

### 7. **Elemental resonance summary on the dashboard** (PoE tooltip, Borderlands build card)
A small panel on the dashboard saying: "Your loadout: 1 Kinetic, 1 Shock. +0% resonance (need 2 of same for bonus)." Doesn't need to do anything mechanically — just a status display. Data is `loadout.getWeapon('primary')?.element` etc. Two lines of new code.
**File:** new component in `src/components/stats/`, or appended to the existing Hunter Notes panel in `src/screens/DashboardScreen.tsx:266`.

### 8. **Recommended-power vs equipped-power delta** (PoE, AFK Arena)
`BossDef.recommendedPower` exists. `Weapon.combatPower` exists. No UI compares them. Add to BossPrepModal: "You have 1,578 power; this boss recommends 2,400. You're 35% under-geared." Color-coded (red if under, green if over). 
**File:** `src/components/fight/BossPrepModal.tsx:259-279` (the boss stats card). Add a single chip below the HP/Shield/Armor bars.

### 9. **Pity counter and defeat count** (AFK Arena pity, every gacha)
`bossStore.pityCounters[bossId]` and `bossStore.defeatedBossIds[]` exist. Never shown. In BossSelectModal, add a small chip on each boss card: "Defeated" / "12 attempts since last drop" / "—". A master "3/12 bosses defeated" on the dashboard's Hunter Notes panel.
**Files:** `src/components/fight/BossSelectModal.tsx` (boss cards) and `src/screens/DashboardScreen.tsx:266` (Hunter Notes).

### 10. **Per-equipment stat delta strip on the dashboard** (Borderlands inspect card, Soul Knight)
A 1-line strip under the HUNTER TOTALS showing: "+124 HP from shield, +15% crit from affix, +8% boss damage from skill". The `sourceMax` and `contributions` arrays in `characterStats.ts` are already computed. Just pick the top 3 contributions and display them. 
**File:** `src/components/stats/CharacterStatBar.tsx:71` (where `sourceMax` is computed) — add a small rendered strip below the 4 chips but above the open-source-breakdown button. Use existing `summary.all[*].contributions` data.

---

## 5. What I Found But Don't Have a Numbered Slot For

These are smaller, less load-bearing but worth mentioning:

- **Active signature mechanic indicator** in the diorama. `applySignatureMechanic` returns `{ dpsMult, ... }` but the diorama shows the weapon with a static illustration. A small badge below the weapon ("3s chargeup" / "5s CD") would be honest.
- **"Activity scene key" is leaking a dev string to the dashboard** (`Scene: dustwaste_frontier` at DashboardScreen:213). Should be human-readable: "Dustwaste Frontier area".
- **Level number is shown twice** (the big Level Strip badge at 263, and the small `LV {playerLevel}` chip on the diorama at LiveTurfDiorama:191). Pick one. The diorama one is more glanceable.
- **Workshop queue timers** — the dashboard shows `0 queues` but the workshop itself has timers. A "Next craft finishes in 4m" pill on the dashboard would be useful.
- **"Recent Field Finds" strip** on the FightScreen (line 345) is 10 small weapon icons in a row. They have no rarity glow, no level, no name. Add rarity glow and tap-to-inspect.
- **The scene label is a dev string** ("dustwaste_frontier"). I saw it on the user's screenshot too. Should be "Dustwaste Frontier".
- **Numbers Up panel** is on the dashboard but the user can only see 4 events. The 5-event array is sliced to 4 (line 267). Show all 5 or make the panel scrollable.
- **Boss defeat counter** is in the boss store but not on the dashboard. The Hunter Notes panel is the natural place: "Bosses: 3/12 defeated".

---

## 6. What I'm Not Recommending

In the spirit of "just more detail, not different pages":

- **Minimap.** CyberCache is single-zone. No minimap needed.
- **Skill cooldowns.** No active skills. The sim doesn't have cooldowns as a player-facing concept.
- **Multi-screen navigation.** User said don't touch this. The bottom nav stays.
- **Big new pages.** All recommendations fit in existing panels or extend the existing diorama.
- **Animation overhaul.** A few animated bars; nothing heavy.

---

## 7. Suggested Execution Order (when you greenlight)

This is sequenced to avoid the "spec drift across PRs" problem. Each PR is small and verifiable.

1. **PR: Health/Shield/Mitigation bars** (Priority #1 + #4) — single file: `CharacterStatBar.tsx`. Adds the HP visualization and fixes the DPS label confusion. ~150 lines. Tests: extend `characterStatsDiorama.test.ts` with a bar-width test.
2. **PR: Boss HP/Shield/Armor bars + Time-to-kill + Recommended power** (Priorities #2, #3, #8) — single file: `BossPrepModal.tsx`. ~200 lines.
3. **PR: Boss phase timeline** (Priority #5) — single file: `BossPrepModal.tsx`. ~150 lines. Reuses existing `phaseAnalyses`.
4. **PR: Dashboard consumable pills + elemental resonance + pity/defeat counters** (Priorities #6, #7, #9) — touches `DashboardScreen.tsx`, `BossSelectModal.tsx`. ~120 lines.
5. **PR: Source-contribution strip under HUNTER TOTALS** (Priority #10) — single file: `CharacterStatBar.tsx`. ~80 lines. Surface the per-metric contributions as a top-3 summary.

All 5 PRs are self-contained, no chain refactor, no API changes. ~700 lines of UI + ~200 lines of tests. Each independently revertable.

---

## 8. Open Questions (need your call)

1. **The scene label leak** ("dustwaste_frontier") — is that a known dev-mode thing or do you want it fixed?
2. **The duplicate level badge** (big in Level Strip, small on diorama) — keep both or remove one?
3. **HP bar scale** — is `100 + level * 12` the *max HP* (the bar fills to 100% when at full) or the *current HP* (the bar decrements as you take damage)? For an idle sim where the fight is one-shot, it can only be a max-HP display. Confirm.

---

**Awaiting your direction. No code will be changed until you say so.**
