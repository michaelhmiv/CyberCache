# CyberCache HUD Plan — Inner Mechanics Visibility

**Date:** 2026-06-09
**Author:** Hermes Agent
**Repo state at planning:** `b15ca22` (master, post-PR #67)
**Trigger:** User said "I shouldn't have to tell you that for an idle game we need a health bar. Instead of piece-by-piece, do research and find components we're missing." Then clarified: fight IS a real sim, but rendered as a 1.2s fake delay (BossPrepModal:218); should be a live animation, and the static Win Chance % overlaps with it.

---

## 0. Read me first

This plan covers 6 PRs. Each is self-contained, independently revertable, and touches a single screen or component. None of them refactor the chain, the sim, or any cross-cutting system. Total: **~900 lines UI + ~250 lines tests, all UI/UX.**

The work is ordered so the most-visible user-facing wins land first, and the most-architecturally-trivial changes don't accidentally conflict with the harder ones.

| PR | Title | Touches | LoC (UI / tests) | Verifies |
|---|---|---|---|---|
| **#0** | Live fight animation (replace 1.2s setTimeout) | `BossPrepModal.tsx`, *maybe* `bossSimulator.ts` (no — already returns all needed data) | 250 / 80 | HP bars tick 0→end, phase markers trigger, victory/defeat card resolves |
| **#1** | Hunter HP bar + DPS label fix | `CharacterStatBar.tsx`, `characterStats.ts` | 180 / 60 | HP bar fills 0→100%, DPS label reads "Fight DPS (vs boss)" |
| **#2** | Boss HP/Shield/Armor bars + TTK + recommended power | `BossPrepModal.tsx` | 150 / 50 | All 3 boss bars render, TTK shown in seconds |
| **#3** | Boss phase timeline | `BossPrepModal.tsx` | 120 / 40 | 4-5 phase chips on a segmented bar, each colored by status |
| **#4** | Top HUD polish (scene label, chips, LV chip) | `DashboardScreen.tsx`, `LiveTurfDiorama.tsx` | 140 / 30 | "Scene: Dustwaste Frontier", 6 chips, no duplicate LV |
| **#5** | Top-3 source contribution strip | `CharacterStatBar.tsx` | 80 / 20 | "Best 3 contributions" under the HUNTER TOTALS bar |

**Total: 920 UI / 280 tests. No store changes, no chain changes, no type changes.** Every PR uses existing data structures.

---

## 1. Locked decisions (from prior session)

1. **Q1 — scene label:** Fix the dev-string leak. Show "Dustwaste Frontier" not `dustwaste_frontier`.
2. **Q2 — duplicate level:** Remove the small `LV 12` chip from the diorama top-right. Keep the big Level Strip badge. Keep the `0/7 gear` count.
3. **Q2a — top chips:** Tighten the row visually **and add 2 consumable chips** (MedKits, Cells). 6 chips total. Auto-hide when zero.
4. **Q3.1 — HP bar type:** **Live animated fight.** Replace the 1.2s `setTimeout` in `BossPrepModal.tsx:218` with a 300-600ms visual sequence showing HP ticking, damage numbers, and phase markers. The sim's math is instant — the delay was purely visual.
5. **Q3.2 — location:** **Inside BossPrepModal.** The static "Estimated Win Chance %" card and the live fight animation are **the same card** in two states: pre-fight (Win Chance %) and during-fight (HP bars ticking). They never appear simultaneously. The card resolves to either a victory card (loot, credits, XP) or defeat card (credits lost, phase name, pity+1).

---

## 2. PR #0 — Live Fight Animation (the original complaint)

**File:** `src/components/fight/BossPrepModal.tsx`
**Goal:** Make the "Engage Boss" button do what it says — show the fight happening.

### 2.1 What's wrong today

`BossPrepModal.tsx:139-219` has the `handleFight` function. It does:
1. `await activity.start(buildBossFightActivity(...))` — sets the activity
2. `setSimulating(true)` — shows a "fighting..." state
3. `window.setTimeout(async () => { ... }, 1200)` — **1.2s fake delay**
4. After the delay, calls `executeBossAttempt(...)` — **the actual sim**
5. Sets the result state, which renders the result text

So the order today is: button click → 1.2s of "fighting..." text → sim runs → result text. The 1.2s is a stub. The sim takes <5ms.

### 2.2 The fix

Run the sim **first** (so we have the result immediately), then *animate* the result over 300-600ms using `framer-motion`. Don't fake-delay.

```ts
// REPLACE lines 139-219
const handleFight = async () => {
  if (!selectionAvailable) { setError(...); return; }
  if (!isBossPrepActivity) { setError(...); return; }

  setSimulating(true);
  setError(null);
  setResult(null); // clear any previous result

  try {
    await activity.start(buildBossFightActivity(boss, activityWeapon));
  } catch (e) {
    setSimulating(false);
    setError(e instanceof Error ? e.message : 'Unable to set boss fight activity.');
    return;
  }

  // SIM RUNS NOW (instant) — we have the result
  const outcome = executeBossAttempt({...}, player.credits);

  // Consume items
  Object.entries(outcome.consumedConsumables).forEach(([type, count]) => {
    if (count > 0) player.removeConsumable(type, count);
  });

  // Animate the result over 500ms (configurable)
  // The animation walks through phaseAnalyses sequentially
  await animateFight(outcome, sim); // <-- new helper

  // Apply outcomes to stores
  if (outcome.result.victory) {
    player.addCredits(outcome.creditsDelta);
    player.addXP(boss.level * 20);
    // ... existing victory path
  } else {
    player.removeCredits(-outcome.creditsDelta);
    bossStore.incrementPity(boss.id);
  }
  bossStore.addAttempt(outcome.result);

  setResult(outcome);
  setSimulating(false);

  try { await activity.clear(); } catch {}
};
```

The `animateFight` helper is a new utility (probably in `src/lib/animation/fightTimeline.ts`) that:
- Takes `outcome` and `sim.phaseAnalyses`
- Uses framer-motion's `animate()` or a sequence of `useAnimate` hooks
- Walks through each phase in order, ticking HP bars to the right value at each phase boundary
- Emits floating damage numbers at phase transitions
- Total duration: 400-600ms, scales with phase count (more phases = longer)

### 2.3 The animation state

Inside BossPrepModal, add a `fightTimeline` state (or pass to a child component):
```ts
type FightTimelineState = {
  startedAt: number;
  currentPhase: number;          // index into phaseAnalyses
  playerHP: number;              // current player HP, ticks down
  bossHP: number;                // current boss HP, ticks down
  playerHPMax: number;           // starting HP
  bossHPMax: number;             // starting boss HP
  recentDamage: Array<{          // floating damage numbers
    id: string;
    target: 'player' | 'boss';
    value: number;
    x: number;
    y: number;
  }>;
  outcome: ReturnType<typeof executeBossAttempt>;
};
```

The animation runs synchronously through the phases:

```ts
async function animateFight(outcome, sim) {
  // For each phase, animate HP deltas
  for (let i = 0; i < sim.phaseAnalyses.length; i++) {
    const phase = sim.phaseAnalyses[i];
    // player takes damage (survivalScore based) or boss takes damage (breakScore / dpsScore based)
    // HP bars tick via framer-motion's animate()
    // wait 80-120ms per phase
    await wait(80 + (i === sim.phaseAnalyses.length - 1 ? 200 : 0)); // last phase slightly longer
  }
}
```

### 2.4 The card morphs

The current "Estimated Win Chance" card (BossPrepModal.tsx:282-298) and the "result" section need to be replaced with a single stateful card:

**State 1 — Pre-fight (no animation running):**
- Estimated Win Chance: `(sim.winChance * 100).toFixed(1)%`
- Win band: "Farmable" / "Favorable" / "Risky" / "Underdog" / "Desperate" / "Nearly Impossible"
- Death fee
- "Engage Boss" button

**State 2 — During-fight (`simulating && !result`):**
- Two horizontal HP bars (player top, boss bottom) that tick
- Floating damage numbers
- Phase markers light up as they trigger
- A small "round N" or "phase: shieldPhase" chip

**State 3 — Post-fight (`result` is set):**
- Victory: loot card (existing), credits delta, XP gained, "next boss unlocked" if applicable
- Defeat: credits lost, "you died in {phaseName}", pity counter +1

The card's content is a derived view: `const cardState = result ? 'post' : simulating ? 'during' : 'pre';`

### 2.5 Existing data is sufficient

- `sim.winChance`, `sim.winChance >= 0.95 ? 'Farmable' : ...` → state 1 label
- `sim.phaseAnalyses` (array of phase data) → state 2 markers
- `outcome.result.victory` → state 3 branching
- `outcome.result.bossHpRemaining` (number 0-100 when lost) → final boss HP % on state 3 defeat
- `boss.health`, `boss.shield`, `boss.armor` → boss HP bar max
- `playerHP = 500 + playerLevel * 40` (bossSimulator.ts:407) → player HP bar max

No sim changes. No new types. Just a re-rendering of existing data.

### 2.6 Tests

`src/test/bossFightAnimation.test.ts`:
- Test that the animation duration is < 600ms (regression guard for the original 1.2s fake delay)
- Test that `sim.phaseAnalyses.length` controls the number of phase markers
- Test that victory state shows credits gained
- Test that defeat state shows credits lost and phase name
- Test that the pre-fight state never renders HP bars (they only appear in during-fight)

`src/test/bossPrepFlow.test.ts` (extend existing if any):
- Test that clicking Engage Boss on a sim with `winChance < 0.05` results in a defeat card
- Test that the "Engage Boss" button is disabled while simulating

### 2.7 Out of scope

- **No live "boss attacks you" particles** — that's beyond the math. The animation shows the math resolving, not a fictional attack sequence.
- **No weapon sprite swinging** — the diorama's weapon illustration is enough.
- **No sound** — the project has no audio.

---

## 3. PR #1 — Hunter HP Bar + DPS Label Fix

**Files:** `src/components/stats/CharacterStatBar.tsx`, `src/lib/stats/characterStats.ts`
**Goal:** Add the missing health bar. Fix the confusing DPS / BOSS DPS labels.

### 3.1 Health bar (the original complaint)

`characterStats.ts:90-93` computes three HP components:
- `baseHealth = 100 + player.level * 12`
- `shieldHp = shield?.hp ?? 0`
- `mitigationHp = round(shieldHp * shield.mitigation)`
- `totalHealth = baseHealth + shieldHp + mitigationHp`

The headline shows `totalHealth` as a number (`CharacterStatBar.tsx:28`). Change `MiniMetric` for the `health` key to render a *stacked bar* instead of (or in addition to) the number.

**Implementation:**
- New sub-component `<HealthBar base={baseHealth} shield={shieldHp} mitigation={mitigationHp} max={maxPossibleInLevel} />` lives in `CharacterStatBar.tsx`
- Renders a 4px-tall horizontal bar under the HEALTH number
- Base segment is green (the chassis pool)
- Shield segment is cyan (the shield pool)
- Mitigation segment is a darker cyan overlay
- Bar fills proportionally against `maxPossibleInLevel` (a fixed cap, e.g. 1500, so the bar doesn't look empty at low levels)

**Where:** `CharacterStatBar.tsx:18-32` (MiniMetric). Add a `bar?: { segments: Array<{value, color}>; max: number }` optional prop. MiniMetric renders the bar below the number when present.

**Data flow:**
- `characterStats.ts:154-167` — the `metric('health', ...)` call needs to pass a `bar` prop
- Add to the StatMetric type: `bar?: { segments: Array<{ value: number; color: string }>; max: number }`
- Or simpler: pass the raw components in `detail` (already there) and compute the bar in MiniMetric using the key === 'health' branch

I'll go with the second approach — keeps the type simple. In `MiniMetric`, when `metric.key === 'health'`, parse the existing detail string OR add a new optional field. Actually, the cleanest is to extend `StatMetric` with `bar?: { segments: Array<{value: number, color: string}>; max: number }` and have `characterStats.ts:154-167` set it on the health metric only.

### 3.2 DPS label fix (the 0-DPS complaint)

`characterStats.ts:155-157`:
```ts
metric('health', 'Health', ...),
metric('dps', 'DPS', dpsDisplayValue, ..., dpsDetail, 'red', ...),         // <-- "DPS 1,578"
metric('boss', 'Boss DPS', bossDps, ..., 'DPS with boss modifiers', 'amber', bossContribs),
```

The first DPS metric uses `computeStandardDps` (raw vs standard). The second uses `totalDps * (1 + bossDamageMod)` (boss-modified). They look like two stats. The user read them as "my DPS is lower than my Boss DPS, that's wrong."

**Fix:** Rename the labels so the headline reads:
- `Health | 244`
- `DPS vs boss | 3,419`  ← the number that matters
- `DPS (standard) | 1,578`  ← derivation, not headline
- `Rare Find | +12%`

Reorder the headline in `CharacterStatBar.tsx:166` from `all[0], all[1], all[2], all[5]` to `all[0], all[2], all[1], all[5]` (so `boss` comes second). And rename the labels in `characterStats.ts:155-157`.

But wait — `all[1]` (DPS) is `computeStandardDps` and `all[2]` (Boss DPS) is the boss-modified `totalDps`. The user needs to see the boss-modified one first. With a boss selected, the headline DPS *already* shows the boss-relative number via `dpsDisplayValue` (line 103). With no boss selected, only the standard is shown. The current headline is showing `dpsDisplayValue` for `dps` and `totalDps * (1 + bossDamageMod)` for `boss` — two different formulas.

**The cleanest fix:** in `characterStats.ts:155`, change the second metric to:
```ts
metric('dps', 'Fight DPS', dpsDisplayValue, whole(dpsDisplayValue), dpsDetail, 'red', dpsContribs),
metric('boss', 'Standard DPS', totalDps, whole(totalDps), 'no boss modifiers', 'amber', bossContribs),
```

And in the `headline` array at line 166, keep `[health, dps, boss, rareFind]` order but the labels now read as "Fight DPS" (the one the player cares about) and "Standard DPS" (the derivation).

When a boss is selected: "Fight DPS | 3,419 vs Salt-Vault Mauler" and "Standard DPS | 1,578 no boss modifiers." Clear.

When no boss: "Fight DPS | 1,578 weapons + skills + affixes" and "Standard DPS | 1,578 no boss modifiers." Identical, which is correct.

Also fix the formula bug in `characterStats.ts:107`: `bossWeaponBonus` is averaged across weapons, but `bossSkillBonus` is summed. Should be summed for both. ~1 line.

### 3.3 Tests

`src/test/characterStatsDiorama.test.ts` (extend):
- Test that with no boss, `dps` and `boss` metrics have equal value (so labels aren't confusing)
- Test that the health bar `bar` prop is set with correct segments
- Test that bossWeaponBonus sums (not averages) across weapons
- Test that the headline ordering is `[health, dps, boss, rareFind]`

---

## 4. PR #2 — Boss HP/Shield/Armor Bars + Time-to-Kill + Recommended Power

**File:** `src/components/fight/BossPrepModal.tsx`
**Goal:** Make boss vitals into actual bars. Add time-to-kill and recommended-power delta.

### 4.1 Boss bars

`BossPrepModal.tsx:259-279` shows the boss's HP/Shield/Armor as `HP 12,345 · Shield 1,234 · Armor 5,678` (numbers in a row, line 261-263). Replace with 3 horizontal bars, stacked vertically, each labeled.

**Data:**
- `boss.health`, `boss.shield`, `boss.armor` — current values
- For the bar max, we need a reference max. Options:
  - (a) Use the boss's own value as max (bar always 100%) — boring but correct
  - (b) Compare against `boss.recommendedPower` — implicit scale
  - (c) Compare against the player's effective DPS — "this much HP at this much DPS = X seconds"

**Decision: (a) for now, (c) is PR #2 follow-up.** The bars visualize the boss's vitals 1:1. Players learn what a tier-1 boss HP looks like vs tier-4.

**Where:** `BossPrepModal.tsx:259-279`. The whole MobileCard.

**Component:** Add a new `<BarRow label icon value color max />` sub-component in `BossPrepModal.tsx` (private, not exported). Renders:
```tsx
<div className="flex items-center gap-2">
  <div className="w-12 text-[9px] uppercase text-text-muted">{label}</div>
  <div className="flex-1 h-3 border-2 border-border bg-bg overflow-hidden">
    <motion.div className={color} animate={{ width: `${(value/max)*100}%` }} />
  </div>
  <div className="w-16 text-right text-xs font-black">{value.toLocaleString()}</div>
</div>
```

Three rows: HP (red), Shield (cyan), Armor (purple). Use the existing `slashClip` style. Each bar animates from 0 to its value on first mount (300ms) — gives the "this is a beefy boss" feeling.

### 4.2 Time-to-kill

`bossSimulator.ts:558` already computes `timeToKill = boss.health / (dps || 1)`. The sim has `dps` (line 540: `let dps = primaryDPS + secondaryDPS + heavyDPS`).

The sim's `BossSimulationOutput` (line 30) doesn't include `timeToKill`. Need to add it.

**Add to `bossSimulator.ts:623` (the returned object):**
```ts
const timeToKill = boss.health / (dps || 1);
return { ...existing, timeToKill };
```

And extend the `BossSimulationOutput` interface at line 30.

**Display:** `BossPrepModal.tsx:282-298` — add a third metric to the win-chance card:
```tsx
<MobileCard className="text-center space-y-1">
  <div className="text-xs text-text-muted">Time to Kill</div>
  <div className="font-mono text-3xl font-black">{sim.timeToKill.toFixed(1)}s</div>
  <div className="text-[10px] text-text-muted">@ {(sim.dps ?? 0).toFixed(0)} DPS</div>
</MobileCard>
```

**Wait — sim doesn't return `dps` either.** It returns `dpsScore` which is `30 / timeToKill` (a normalized 0-1+ value). To get DPS back, we need to expose it or compute it. Simpler: add `effectiveDPS: number` to the output too. Same pattern as timeToKill.

### 4.3 Recommended power delta

`BossDef.recommendedPower` exists (line 79 of `types/boss.ts`). Never shown.

**Add to BossPrepModal.tsx:259-279 (the boss stats card):**
```tsx
<div className="mt-2 flex items-center gap-2 border-2 border-border bg-bg/75 p-1.5">
  <Sparkles size={14} className={powerDelta >= 0 ? 'text-green' : 'text-red'} />
  <div className="text-[10px] text-text-muted">Your power:</div>
  <div className="text-xs font-black">{playerPower.toLocaleString()}</div>
  <div className="text-[10px] text-text-muted">vs {boss.recommendedPower.toLocaleString()}</div>
  <div className={`text-xs font-black ${powerDelta >= 0 ? 'text-green' : 'text-red'}`}>
    {powerDelta >= 0 ? '+' : ''}{powerDelta.toFixed(0)}%
  </div>
</div>
```

`playerPower` = sum of `weapon.combatPower` for equipped weapons + base health as a proxy. Or simpler: just use the HUNTER TOTALS `dps` value as a proxy. Actually the cleanest is to call `buildCharacterStatSummary` and use `summary.all[2].value` (Boss DPS) as the comparison point.

### 4.4 Tests

`src/test/bossSimulator.test.ts` (extend):
- Test that `timeToKill` is computed correctly
- Test that `effectiveDPS` is computed correctly
- Test edge case: dps = 0 doesn't divide by zero

`src/test/bossPrep.test.ts` (new):
- Test that the recommended-power delta renders green when over-geared, red when under
- Test that the boss bars render with the right values

---

## 5. PR #3 — Boss Phase Timeline

**File:** `src/components/fight/BossPrepModal.tsx`
**Goal:** Render the `BossDef.phases[]` array as a visible timeline.

### 5.1 What's there

`BossPrepModal.tsx:307-326` shows `sim.phaseAnalyses` (an array) as a vertical list of cards. Each card has a phase name, status (safe/close/risky/failing), explanation, current answers, missing counters. This is good.

What's missing: the *flow*. The player sees 4 cards but doesn't see the order they happen in.

`BossDef.phases[]` is the raw phase structure (in `types/boss.ts:42-55`):
```ts
interface BossPhase {
  id: string;
  name: string;
  description: string;
  type: 'survival' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic';
  targetValue: number;
  recommendedCounters: string[];
  failureReason: string;
  successReason: string;
  eventTrigger: BossEventType;
}
```

### 5.2 The fix

Replace the current "Phase Plan" header (line 302-326) with:
- A horizontal segmented bar at the top showing all phases in order
- Each segment is colored by the corresponding `phaseAnalyses[].status` (green/amber/orange/red)
- Tapping a segment scrolls/highlights the corresponding card below

```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase">
    <Activity size={14} /> Phase Plan
  </div>
  {/* NEW: segmented timeline */}
  <div className="flex h-8 border-2 border-border overflow-hidden">
    {sim.phaseAnalyses.map((phase, i) => {
      const color = phase.status === 'safe' ? 'bg-green/40' :
                    phase.status === 'close' ? 'bg-amber/40' :
                    phase.status === 'risky' ? 'bg-orange-400/40' :
                    'bg-red/40';
      const borderRight = i < sim.phaseAnalyses.length - 1 ? 'border-r-2 border-border' : '';
      return (
        <button
          key={phase.phaseId}
          onClick={() => scrollToPhase(phase.phaseId)}
          className={`flex-1 ${color} ${borderRight} px-1 text-[8px] font-black uppercase text-text-primary active:scale-95`}
        >
          {phase.phaseName}
        </button>
      );
    })}
  </div>
  {/* Existing card list, each with a data-phase-id for scroll-into-view */}
  {sim.phaseAnalyses.map((phase) => (
    <div key={phase.phaseId} data-phase-id={phase.phaseId} className={`rounded-xl bg-surface p-3 border-2 ${PHASE_STATUS_BORDER[phase.status]} space-y-2`}>
      ...existing card content...
    </div>
  ))}
</div>
```

The `scrollToPhase` helper is a `useRef` + `scrollIntoView({ behavior: 'smooth', block: 'start' })`.

### 5.3 Data flow

No new data. `sim.phaseAnalyses` is already the right shape: array of `PhaseAnalysis` with `phaseId`, `phaseName`, `status`, etc.

### 5.4 Tests

`src/test/bossPhaseTimeline.test.ts` (new):
- Test that the timeline has one segment per phase in the analysis
- Test that segment colors match the phase status
- Test that tapping a segment triggers `scrollIntoView` on the corresponding card

---

## 6. PR #4 — Top HUD Polish (chips, scene label, LV chip)

**Files:** `src/screens/DashboardScreen.tsx`, `src/components/dashboard/LiveTurfDiorama.tsx`
**Goal:** Visual tightening of the top row, scene label fix, remove duplicate LV chip.

### 6.1 Scene label fix

`DashboardScreen.tsx:213`:
```ts
const activityScene = activity.current.sceneKey ?? safeText(activePayload.scene_key) ?? 'standby';
```

`sceneKey` values are like `dustwaste_frontier`, `boss:salt-vault-mauler`, `workshop:service`. The fix is a resolver:

```ts
const resolveSceneLabel = (sceneKey: string | null, payload: any): string => {
  if (!sceneKey) return 'standby';
  // Roaming area: sceneKey === area.id
  const area = ROAMING_AREAS.find((a) => a.id === sceneKey);
  if (area) return area.name;
  // Boss: sceneKey === `boss:${id}`
  if (sceneKey.startsWith('boss:')) {
    const bossId = sceneKey.slice(5);
    const boss = REGION_1_BOSSES.find((b) => b.id === bossId);
    if (boss) return boss.name;
  }
  // Workshop/Market: known static keys
  if (sceneKey === 'workshop:service') return 'Workshop Service';
  if (sceneKey === 'workshop:crafting') return 'Crafting Bench';
  if (sceneKey === 'workshop:salvage') return 'Salvage Bench';
  if (sceneKey === 'market:kiosk') return 'Market Kiosk';
  return payload?.scene_key ?? sceneKey; // fallback to original
};

const activityScene = resolveSceneLabel(activity.current.sceneKey, activePayload);
```

Or simpler: add a `sceneKey` to a `labels` constant map. Either is fine.

`DashboardScreen.tsx:262` then displays `Scene: {activityScene}` with the resolved name.

The same `activityScene` is computed in `ProfileScreen.tsx:60` — same fix applies there.

### 6.2 Top chips: 6 chips, tightened

`DashboardScreen.tsx:261` — current row:
```tsx
<div className="flex gap-1.5 overflow-x-auto pb-0.5">
  <HudChip label="Cash" value={compact(player.credits)} detail="credits" tone="cyan" />
  <HudChip label="Scrap" value={compact(player.scrap)} detail="bench" tone="amber" />
  <HudChip label="Keys" value={player.cacheKeys} detail={`${player.cacheKeyFragments}/5 frags`} tone="green" />
  <HudChip label="Loot" value={inventory.items.length} detail={`${equippedCount}/7 equip`} tone="red" />
</div>
```

**New row: 6 chips, denser:**
```tsx
<div className="flex gap-1 overflow-x-auto pb-0.5">
  <HudChip label="Cash" value={compact(player.credits)} detail="cr" tone="cyan" />
  <HudChip label="Scrap" value={compact(player.scrap)} detail="bench" tone="amber" />
  <HudChip label="Keys" value={player.cacheKeys} detail={`${player.cacheKeyFragments}/5`} tone="green" />
  <HudChip label="Loot" value={inventory.items.length} detail={`${equippedCount}/7`} tone="red" />
  {(player.getConsumableCount('MedKit') > 0 || player.getConsumableCount('ShieldCell') > 0) && (
    <>
      <HudChip label="MedKits" value={player.getConsumableCount('MedKit')} detail="heal" tone="green" />
      <HudChip label="Cells" value={player.getConsumableCount('ShieldCell')} detail="shld" tone="cyan" />
    </>
  )}
</div>
```

`HudChip` already supports any `tone`. The detail text is shortened (`credits` → `cr`, `0/5 frags` → `0/5`, `0/7 equip` → `0/7`) to fit the new density.

**HudChip density:** `src/screens/DashboardScreen.tsx:111-121` is the HudChip component. Reduce padding from `px-2 py-1.5` to `px-1.5 py-1`, reduce text size from `text-base` to `text-sm`. ~5 lines.

### 6.3 Remove duplicate LV chip

`LiveTurfDiorama.tsx:191`:
```tsx
<div className="pointer-events-none shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}>
  <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">LV {playerLevel}</div>
  <div className="text-xs font-black text-amber">{equippedCount}/7 gear</div>
</div>
```

**Fix:** Remove the `LV {playerLevel}` div. Keep the `{equippedCount}/7 gear` div. The chip is now smaller and the level is implicit (shown big in the Level Strip panel above).

### 6.4 Tests

`src/test/dashboardLayout.test.ts` (new):
- Test that the top row has 4 chips when no consumables
- Test that it has 6 chips when consumables > 0
- Test that the scene label is resolved to a human name (e.g. "Dustwaste Frontier" not `dustwaste_frontier`)
- Test that the diorama no longer renders the `LV {n}` text

---

## 7. PR #5 — Top-3 Source Contribution Strip

**File:** `src/components/stats/CharacterStatBar.tsx`
**Goal:** Surface the existing source breakdown data as a single dense strip above the SOURCES button.

### 7.1 What's there

`characterStats.ts:117-163` builds `healthContribs`, `dpsContribs`, `bossContribs`, `breakContribs`, `utilityContribs` — every metric has a list of `StatContribution` (source name, detail, value, tone). These are accessible via `summary.all[i].contributions`.

The current `CharacterStatBar.tsx` (line 70-77) shows only the 4 headline metrics. The source breakdown is hidden behind the "SOURCES" button which opens a modal (line 78-95). Most players never tap that.

### 7.2 The fix

Add a top-3 contribution strip under the 4 headline chips. It shows the largest contributions across all metrics, regardless of which metric they affect.

```tsx
function TopContribsStrip({ summary }: { summary: CharacterStatSummary }) {
  const all = summary.all.flatMap((metric) => metric.contributions);
  const top3 = all
    .filter((c) => Math.abs(c.value) > 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3);
  if (top3.length === 0) {
    return <div className="text-[9px] text-text-muted px-1">No slotted sources contributing</div>;
  }
  return (
    <div className="mt-1 flex gap-1 px-1 overflow-hidden">
      {top3.map((c) => (
        <div key={`${c.source}-${c.detail}`} className="flex-1 min-w-0 flex items-center gap-1 border border-border bg-bg/75 px-1.5 py-0.5" style={slashClip}>
          <div className={`shrink-0 w-1 h-1 ${toneClass[c.tone ?? 'muted'].fill}`} />
          <span className="truncate text-[8px] font-black text-text-primary">{c.source}</span>
          <span className="shrink-0 text-[9px] font-black text-amber">{c.display}</span>
        </div>
      ))}
    </div>
  );
}
```

Render between the 4 MiniMetric chips (line 76) and the close-button:
```tsx
<div className="flex gap-1">{summary.headline.map((metric) => <MiniMetric ... />)}</div>
<TopContribsStrip summary={summary} />  {/* NEW */}
```

### 7.3 What this looks like

If the player has a Shock weapon with high crit and a class mod with +12% crit damage, the strip would show:
- `Common Kinetic Sniper | +1,234 DPS` (red dot)
- `+Crit Damage node | +187 DPS` (purple dot)
- `Corrosive Class Mod | +94 DPS` (amber dot)

This is the Borderlands "this is why your damage is what it is" insight, available at-a-glance.

### 7.4 Tests

`src/test/sourceBreakdown.test.ts` (new):
- Test that the strip picks the top 3 contributions by absolute value
- Test that contributions of value 0 are filtered out
- Test that the strip renders an empty-state when no contributions

---

## 8. Test summary

| PR | New tests | Touches existing tests | Total tests after |
|---|---|---|---|
| #0 | `bossFightAnimation.test.ts` (5 tests), `bossPrepFlow.test.ts` (3 tests) | none | 161 + 8 = 169 |
| #1 | none | `characterStatsDiorama.test.ts` (+3) | 172 |
| #2 | `bossPrep.test.ts` (3 tests) | `bossSimulator.test.ts` (+2) | 177 |
| #3 | `bossPhaseTimeline.test.ts` (2 tests) | none | 179 |
| #4 | `dashboardLayout.test.ts` (3 tests) | none | 182 |
| #5 | `sourceBreakdown.test.ts` (3 tests) | none | 185 |

Every PR keeps the existing 161 passing and adds its own. No tests deleted.

---

## 9. Out of scope (deferred)

These were in the original gap report but are bigger lifts. Worth doing later, but not in this 6-PR plan:

- **Pity counter + defeat count HUD** (gap #9). 2 small panels. Could be a 1-line follow-up.
- **Elemental resonance summary** (gap #7). New panel on dashboard. ~50 lines.
- **Consumable detail modal on tap** (consumable icons in HUD). Requires a popover system.
- **Skill tree per-tree summary** (gap #2.4). Reads `SKILL_NODES` and aggregates by tree. ~80 lines.
- **DPS-over-time graph** (gap #2.2). Requires state history. Multi-PR.
- **Floating damage numbers in the diorama** (gap #2.1). Requires a "fight in progress" state, which PR #0 introduces but doesn't fully wire.

---

## 10. Execution order rationale

The PRs are ordered by **blast radius** (smallest first) and **user-visibility** (most-visible first):

1. **#0 (live fight animation)** is the original complaint and the most visible. It also unlocks the architecture for #2-#3 by proving the "card states" pattern works.
2. **#1 (HP bar + DPS label)** is the second-most visible (the headline is what you see first).
3. **#2 (boss bars + TTK)** layers into the BossPrepModal which is now battle-tested by #0.
4. **#3 (phase timeline)** uses the same data structures as #0, so it's a natural follow-up.
5. **#4 (top HUD polish)** is the cleanup pass — fixes scene label, removes duplicate LV, tightens chips.
6. **#5 (source contribution strip)** is the cherry on top — uses data already there.

PRs #1-#5 are independent of each other (different files, different data) and could be parallelized. #0 must land first because it changes the BossPrepModal's render structure.

---

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Animation timer overrides user's `prefers-reduced-motion` | Low | Med | Use `useReducedMotion()` (already imported in LiveTurfDiorama.tsx:131) — disable animation, just render the result card. |
| New HP bar `max` value is wrong for high-level players | Low | Low | Make `max` a constant `1500` (rough scale for LV 100+), comment it. Not data-driven for now. |
| PR #0 animation breaks the existing `result` state machine | Med | Med | Keep the existing `result` state and `simulating` state. The animation is a *new* state, not a replacement. |
| PR #4 scene label misses a new sceneKey type | Low | Low | Fallback to original key. Add `sceneKey` enums to a single constant file for future types. |
| Top-3 contribution strip is too noisy with many small contribs | Med | Low | Filter to absolute value > some threshold (e.g. 1% of total). Tweakable constant. |
| The `bossEffectiveDPS` field name conflicts with existing types | Low | Med | Add it as optional with a default. Backwards-compat. |
| `usePlayerStore.getConsumableCount` doesn't exist | Low | Med | Verify in the player store. If not, add it. |

---

## 12. Awaiting greenlight

Each PR is its own self-contained piece. Plan to land them in order with one of these per-PR statuses:

- **Go** — start work
- **Skip** — drop from this plan (move to "out of scope")
- **Reshape** — different approach; let me know what

Once you say "Go PR #0" I'll start the work. Standard gates per PR:
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npm test` clean (existing + new)
- `npm run build` clean
- Live browser verification (open the prod build in browser, exercise the surface)
- Commit, push, open PR

Per your standard convention: each PR on its own branch, pushed to remote, PR URL delivered at handoff.

---

**No code will be touched until you say "Go PR #N".**
