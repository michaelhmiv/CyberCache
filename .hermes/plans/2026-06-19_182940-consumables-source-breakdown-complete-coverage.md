# Complete Consumable Source Breakdown Coverage Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. This is a code implementation plan only; do not implement until the user explicitly says to proceed.

**Goal:** Source Breakdown must show every contributor to every character stat, including consumables that are active, armed, loaded, inventory-backed, or server-authoritative.

**Architecture:** Create a canonical consumable contribution pipeline that derives stat sources from both server state and available player consumable inventory. `buildCharacterStatSummary()` should not guess from UI slot labels only and should not depend solely on already-synced `activeBuffs`. Consumable stat sources should be first-class `StatSource` rows, and any composition/stacked bar should derive from the same rows.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Vite, CyberCache Chef server, Supabase-backed profile consumables.

---

## Current context

The latest merged source-breakdown refactor fixed the previous inconsistency where `medKitBuffer` could appear in stacked HP but not in `contributions`. However, the new screenshot shows a deeper contract gap:

- Player has **12 Med Kits** available/equipped.
- Source Breakdown shows **Max HP 3,100 / 1 source / Chassis 100%**.
- Expected Med Kit contribution is `12 × 150 = 1,800` HP buffer.
- Expected Max HP display should include or explicitly account for this consumable HP contribution.

The issue is upstream of rendering:

| File | Current behavior |
|---|---|
| `src/lib/stats/characterStats.ts` | Shows MedKit only when `activeBuffs` has survival contribution or `medKitBuffer > 0`. |
| `src/screens/DashboardScreen.tsx` | Passes `medKitBuffer: survivalMedKitBuffer`, but does not pass player consumable inventory to stat summary. |
| `src/lib/buffs/consumableModsAdapter.ts` | Maps loadout consumables to a few economy modifiers only; does not produce survival/HP sources. |
| `src/store/slices/loadoutSlice.ts` | Consumable slots store assignment only, not quantity; slots are UI-only under the current architecture. |
| `src/server/chef.ts` | Chef activates from `profile.consumables`, not loadout slots; server returns buffer after claim/tick. |

## Contract to enforce

> If anything contributes to a character stat in any way, it must appear in Source Breakdown.

This includes:

| Source class | Include? | Examples |
|---|---:|---|
| Base stats | Yes | Hunter chassis HP |
| Gear | Yes | Shield HP, weapon DPS, relic affix |
| Skills | Yes | Calibrated Iron DPS |
| Activity modules | Yes | Roaming loot modifiers |
| Active consumables | Yes | Ammo Pack DPS buff |
| Armed consumables | Yes | Adrenaline armed, Shield Cell resistance |
| Inventory-backed consumables | Yes | MedKit count → HP buffer |
| Server-authoritative runtime state | Yes | Chef `survival.medKitBuffer`, remaining Nano Swarm ticks |

---

## Proposed approach

Add a canonical module:

`src/lib/stats/consumableStatSources.ts`

This module will convert player consumable inventory + active buffs + server survival state into typed stat-source contributions.

`buildCharacterStatSummary()` will receive a new optional `consumableInventory?: Record<string, number>` and use `buildConsumableStatSources()` to produce source rows for HP, DPS, economy, and utility metrics.

The summary should merge source rows with the following precedence:

1. **Server-authoritative active state wins for remaining amount** when available. Example: Chef says MedKit buffer has 1,650 HP remaining after damage; show 1,650, not original inventory potential 1,800.
2. **Inventory-backed potential/armed state fills gaps** when the server state has not yet hydrated or no claim has run. Example: 12 Med Kits in profile, no active buffer yet; show MedKit ×12 +1,800.
3. **Never double-count active + inventory** for the same consumable effect. One MedKit source row should exist, with the best known value.

---

## Phase 0 — Baseline and branch hygiene

### Task 0.1: Create implementation branch

**Objective:** Isolate this work from `master`.

**Files:** none

**Steps:**

```bash
git checkout master
git pull --ff-only origin master
git checkout -b fix/complete-consumable-source-breakdown
```

**Verification:**

```bash
git status --short
git branch --show-current
```

Expected:

- clean working tree
- branch is `fix/complete-consumable-source-breakdown`

---

## Phase 1 — RED tests for the missing MedKit coverage

### Task 1.1: Add inventory-backed MedKit source test

**Objective:** Prove that `buildCharacterStatSummary()` currently misses MedKit when the player has inventory but `medKitBuffer` is not hydrated.

**Files:**
- Modify: `src/test/characterStatsSourceConsistency.test.ts`

**Test to add:**

```ts
it('exposes inventory-backed Med Kits as Max HP sources before server buffer hydrates', () => {
  const summary = buildCharacterStatSummary({
    player,
    weapons: [],
    spentSkills: {},
    consumableInventory: { MedKit: 12 },
  });

  const health = summary.all.find((metric) => metric.key === 'health');
  expect(health).toBeDefined();

  expect(health!.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'Med Kit ×12',
        value: 1800,
        display: '1,800',
        bucket: 'consumable',
      }),
    ]),
  );

  expect(health!.stacked).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: 'Med Kit ×12',
        value: 1800,
        display: '1,800',
      }),
    ]),
  );
});
```

**Run:**

```bash
npm test -- --run src/test/characterStatsSourceConsistency.test.ts
```

**Expected:** FAIL because `consumableInventory` is not yet accepted by `buildCharacterStatSummary()` and/or no row is generated.

### Task 1.2: Add server-state precedence test

**Objective:** Ensure a partially depleted server buffer overrides full inventory potential and prevents double counting.

**Files:**
- Modify: `src/test/characterStatsSourceConsistency.test.ts`

**Test to add:**

```ts
it('prefers server-authoritative Med Kit buffer over full inventory potential', () => {
  const summary = buildCharacterStatSummary({
    player,
    weapons: [],
    spentSkills: {},
    consumableInventory: { MedKit: 12 },
    medKitBuffer: 1650,
  });

  const health = summary.all.find((metric) => metric.key === 'health');
  expect(health).toBeDefined();

  const medKitRows = health!.contributions.filter((source) => source.source.startsWith('Med Kit'));
  expect(medKitRows).toHaveLength(1);
  expect(medKitRows[0]).toEqual(expect.objectContaining({
    source: 'Med Kit ×12',
    value: 1650,
    display: '1,650',
    bucket: 'consumable',
  }));
});
```

**Run:**

```bash
npm test -- --run src/test/characterStatsSourceConsistency.test.ts
```

**Expected:** FAIL until precedence is implemented.

---

## Phase 2 — Canonical consumable stat source builder

### Task 2.1: Create `consumableStatSources.ts`

**Objective:** Centralize consumable stat-source derivation so Dashboard, stat summary, and future surfaces do not each invent their own mappings.

**Files:**
- Create: `src/lib/stats/consumableStatSources.ts`
- Test: `src/test/consumableStatSources.test.ts`

**Implementation shape:**

```ts
import { CONSUMABLES } from '@/constants/consumables';
import { computeMedKitBuffer } from '@/lib/combat/damageContract';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import type { StatSource } from '@/lib/stats/statSources';
import { formatMultiplierOrWhole, formatWhole, formatSignedPct } from '@/lib/stats/formatStat';

export type ConsumableStatSourceBuckets = {
  health: StatSource[];
  effectiveHp: StatSource[];
  dps: StatSource[];
  rareFind: StatSource[];
  scrap: StatSource[];
  offline: StatSource[];
};

export type BuildConsumableStatSourcesInput = {
  consumableInventory?: Record<string, number>;
  activeBuffs?: ActiveBuff[];
  medKitBuffer?: number;
};

const emptyBuckets = (): ConsumableStatSourceBuckets => ({
  health: [],
  effectiveHp: [],
  dps: [],
  rareFind: [],
  scrap: [],
  offline: [],
});

export function buildConsumableStatSources(input: BuildConsumableStatSourcesInput): ConsumableStatSourceBuckets {
  const buckets = emptyBuckets();
  const inventory = input.consumableInventory ?? {};
  const activeBuffs = input.activeBuffs ?? [];

  const medKitCount = inventory.MedKit ?? 0;
  const activeMedKitValue = activeBuffs
    .filter((buff) => buff.consumableId === 'MedKit')
    .reduce((sum, buff) => sum + (buff.value ?? 0), 0);
  const inventoryMedKitPotential = medKitCount > 0 ? medKitCount * computeMedKitBuffer('MedKit') : 0;
  const medKitValue = input.medKitBuffer && input.medKitBuffer > 0
    ? input.medKitBuffer
    : activeMedKitValue > 0
      ? activeMedKitValue
      : inventoryMedKitPotential;

  if (medKitValue > 0) {
    buckets.health.push({
      source: medKitCount > 0 ? `Med Kit ×${medKitCount}` : 'Med Kit',
      segmentLabel: medKitCount > 0 ? `Med Kit ×${medKitCount}` : 'Med Kit',
      detail: input.medKitBuffer && input.medKitBuffer > 0
        ? 'Server-authoritative survival buffer'
        : 'Inventory-backed survival buffer',
      value: medKitValue,
      display: formatWhole(medKitValue),
      tone: 'amber',
      bucket: 'consumable',
    });
  }

  // Additional consumables should be mapped here in later tasks.
  return buckets;
}
```

**Important:** This initial code is intentionally MedKit-focused. Later tasks add economy/DPS mappings using the same module. Do not put this logic directly in `DashboardScreen.tsx`.

### Task 2.2: Add unit tests for the builder

**Files:**
- Create: `src/test/consumableStatSources.test.ts`

**Tests:**

```ts
import { describe, expect, it } from 'vitest';
import { buildConsumableStatSources } from '@/lib/stats/consumableStatSources';

describe('buildConsumableStatSources', () => {
  it('derives Med Kit HP buffer from inventory count', () => {
    const sources = buildConsumableStatSources({ consumableInventory: { MedKit: 12 } });
    expect(sources.health).toEqual([
      expect.objectContaining({
        source: 'Med Kit ×12',
        value: 1800,
        display: '1,800',
        bucket: 'consumable',
      }),
    ]);
  });

  it('uses server buffer instead of full inventory potential when present', () => {
    const sources = buildConsumableStatSources({
      consumableInventory: { MedKit: 12 },
      medKitBuffer: 1650,
    });
    expect(sources.health).toHaveLength(1);
    expect(sources.health[0]).toEqual(expect.objectContaining({
      source: 'Med Kit ×12',
      value: 1650,
      display: '1,650',
    }));
  });
});
```

**Run:**

```bash
npm test -- --run src/test/consumableStatSources.test.ts
```

**Expected:** PASS after Task 2.1.

---

## Phase 3 — Wire builder into character stat summary

### Task 3.1: Extend stat summary input

**Objective:** Allow `buildCharacterStatSummary()` to receive consumable inventory directly.

**Files:**
- Modify: `src/lib/stats/characterStats.ts`

**Change:**

```ts
type Input = {
  // existing fields...
  consumableInventory?: Record<string, number>;
};
```

Destructure it:

```ts
const {
  player,
  weapons,
  shield,
  classMod,
  relic,
  ordnance,
  spentSkills,
  boss,
  activeBuffs = [],
  medKitBuffer: survivalStoreBuffer = 0,
  consumableInventory,
} = input;
```

### Task 3.2: Replace local MedKit fallback with canonical consumable sources

**Objective:** `healthContribs` should use the canonical builder, not a local MedKit one-off.

**Files:**
- Modify: `src/lib/stats/characterStats.ts`

**Add import:**

```ts
import { buildConsumableStatSources } from '@/lib/stats/consumableStatSources';
```

**Add before health contribs:**

```ts
const consumableSources = buildConsumableStatSources({
  consumableInventory,
  activeBuffs,
  medKitBuffer: survivalStoreBuffer,
});
```

**Replace survival buffer math to use canonical health consumables:**

```ts
const survivalContribBuffer = consumableSources.health.reduce((sum, source) => sum + source.value, 0);
const totalHealth = mechanics.maxHp.value + survivalContribBuffer;
```

**Replace `survivalStoreMedKitContrib` and `survivalConsumableContribs` in `healthContribs` with:**

```ts
const healthContribs: StatContribution[] = [
  { source: 'Hunter chassis', segmentLabel: 'Chassis', detail: `Base + level ${player.level}`, value: baseHealth, display: whole(baseHealth), tone: 'muted', bucket: 'base' },
  shield ? { source: shield.name, segmentLabel: 'Shield', detail: 'Shield HP pool', value: shieldHp, display: whole(shieldHp), tone: 'cyan', bucket: 'gear' } : undefined,
  ...consumableSources.health,
].filter(Boolean) as StatContribution[];
```

**Preserve:**

```ts
const healthStacked = sourcesToSegments(healthContribs, 'green');
```

**Run:**

```bash
npm test -- --run src/test/characterStatsSourceConsistency.test.ts src/test/consumableStatSources.test.ts src/test/characterStatsDiorama.test.ts
```

**Expected:** PASS.

---

## Phase 4 — Pass consumable inventory from Dashboard

### Task 4.1: Wire player consumables into stat summary

**Objective:** Source Breakdown on Dashboard must know the player’s actual consumable inventory count.

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`

**Change in `buildCharacterStatSummary()` call:**

```ts
const computedStats = useMemo(
  () => buildCharacterStatSummary({
    player,
    weapons: statWeapons,
    shield: loadout.getShield(),
    classMod: loadout.getClassMod(),
    relic: loadout.getRelic(),
    ordnance: loadout.getOrdnance(),
    spentSkills: skills.spent,
    boss: currentBoss ?? undefined,
    activeBuffs,
    consumableMods,
    consumableInventory: player.consumables,
    medKitBuffer: survivalMedKitBuffer,
  }),
  [player, statWeapons, loadout, skills.spent, currentBoss, activeBuffs, consumableMods, survivalMedKitBuffer],
);
```

**Note:** `player` already appears in the dependency list, so this does not need an additional dependency.

**Run:**

```bash
npm test -- --run src/test/dashboardPanelSourcesButton.test.tsx src/test/characterStatBreakdownModal.test.tsx src/test/characterStatsSourceConsistency.test.ts
```

**Expected:** PASS.

### Task 4.2: Add Dashboard integration test for consumable inventory

**Objective:** Prevent a future regression where Dashboard forgets to pass inventory to stat summary.

**Files:**
- Add or modify a focused test, likely `src/test/dashboardPanelSourcesButton.test.tsx` or a new `src/test/dashboardConsumableSourceBreakdown.test.tsx`.

**Preferred approach:** If existing store setup helpers are heavy, keep this as a stat-summary integration test first. If Dashboard test wiring is already available, render Dashboard with player consumables `{ MedKit: 12 }`, open Sources, and assert `Med Kit ×12` appears.

**Assertion target:**

```ts
expect(screen.getByText(/Med Kit ×12/)).toBeInTheDocument();
expect(screen.getByText(/1,800/)).toBeInTheDocument();
```

**Run:**

```bash
npm test -- --run src/test/dashboardConsumableSourceBreakdown.test.tsx
```

**Expected:** PASS.

---

## Phase 5 — Expand beyond MedKit to all consumable stat contributors

### Task 5.1: Map economy consumables into canonical source buckets

**Objective:** Luck/economy consumables should show in Rare Find/Scrap/Offline/etc. if they contribute.

**Files:**
- Modify: `src/lib/stats/consumableStatSources.ts`
- Test: `src/test/consumableStatSources.test.ts`

**Implementation guidance:** Iterate `Object.entries(consumableInventory)` and inspect `CONSUMABLES[id]?.runtime.baseEffects`.

Mappings:

| Runtime effect | Metric bucket | Display |
|---|---|---|
| `bonusLootChance` | `rareFind` | signed percent |
| `extraLootRollChance` | `rareFind` or `lootQuantity` if metric exists later | signed percent |
| `rareMaterialChance` | `rareFind` | signed percent |
| `yieldMultiplier` | `scrap` | signed percent delta (`value - 1` if stored as multiplier) |
| `dpsMultiplier` | `dps` | multiplier or percent |
| `shieldBreakMultiplier` | `shieldBreak` future extension | percent/multiplier |
| `armorBreakMultiplier` | `armorBreak` future extension | percent/multiplier |

**Be careful:** Do not display inert zero-value effects.

**Test example:**

```ts
it('maps economy consumables into stat source buckets', () => {
  const sources = buildConsumableStatSources({ consumableInventory: { LuckBooster: 2 } });
  expect(sources.rareFind.length).toBeGreaterThan(0);
  expect(sources.rareFind[0]).toEqual(expect.objectContaining({
    bucket: 'consumable',
  }));
});
```

**Run:**

```bash
npm test -- --run src/test/consumableStatSources.test.ts
```

### Task 5.2: Add those buckets to `characterStats.ts`

**Objective:** Use canonical consumable source buckets in existing metric contributions.

**Files:**
- Modify: `src/lib/stats/characterStats.ts`

Examples:

```ts
metric('rareFind', 'Rare Find', rareFind, signedPct(rareFind), 'drop chance modifiers', 'amber', [
  ...utilityContribs(['rareDropChanceMod', 'rareDropChance', 'postBossDropChance']),
  ...economyConsumableContribs.filter((entry) => entry.value !== 0),
  ...consumableSources.rareFind,
]),
```

For `scrap`:

```ts
metric('scrap', 'Scrap Yield', scrap, signedPct(scrap), 'salvage and scrap modifiers', 'cyan', [
  ...utilityContribs(['scrapYieldMod', 'scrapYield', 'autoSalvageBonus', 'lowRarityScrapBonus']),
  ...consumableSources.scrap,
]),
```

**Run:**

```bash
npm test -- --run src/test/sourceBreakdownBuckets.test.tsx src/test/characterStatBreakdownModal.test.tsx src/test/consumableStatSources.test.ts
```

**Expected:** PASS.

---

## Phase 6 — Server/client contract cleanup

### Task 6.1: Align `ChefClaimRequest` comments/types with current slotless architecture

**Objective:** Remove stale slot-based language from client Chef request types and avoid future implementers thinking loadout slots drive server consumable activation.

**Files:**
- Modify: `src/lib/chef/chefClient.ts`
- Modify: `src/server/chef.ts` only if needed for comments/types

**Current issue:** `ChefClaimRequest` still documents `loadoutConsumables` as “Loadout consumable slot assignments,” while `ClaimRequest` server side marks it deprecated and Chef activates from inventory.

**Change:** Mark client `loadoutConsumables` deprecated or remove if no call sites use it.

Run search before removing:

```bash
grep -R "loadoutConsumables" -n src
```

If no runtime callers exist, remove from client type. If tests reference it, update tests to use `consumableInventory`/server profile model.

**Run:**

```bash
npx tsc --noEmit
npm test -- --run src/test/chefClientBase.test.ts src/test/roamingChefAuthority.test.ts src/test/idleTickerSurvival.test.ts
```

---

## Phase 7 — UI acceptance behavior

### Task 7.1: Ensure Source Breakdown label communicates inventory-backed vs active

**Objective:** A player should understand why MedKit appears before damage is taken or before Chef has synced.

**Files:**
- Likely Modify: `src/lib/stats/consumableStatSources.ts`

**Recommended row text:**

| State | Source | Detail |
|---|---|---|
| Inventory/potential | `Med Kit ×12` | `Inventory-backed survival buffer` |
| Server active remaining | `Med Kit ×12` | `Server-authoritative survival buffer` |
| Active buff no count known | `Med Kit` | `Active survival buffer` |

Do **not** use slot labels (`PreFight`, `MidFight`, `Emergency`) in source rows. Slots are UI-only and the user explicitly rejected slot-centric consumable mechanics.

### Task 7.2: Verify screenshot scenario manually

**Objective:** Confirm the exact reported case is fixed in browser.

**Manual verification steps:**

1. Run dev server:

```bash
npm run dev -- --host 0.0.0.0
```

2. Open app in browser.
3. Ensure player has MedKit inventory count, ideally 12.
4. Open Dashboard → Hunter Totals → Sources.
5. Confirm:
   - Max HP includes consumable source row.
   - Row says `Med Kit ×12`.
   - Value is `1,800` for basic MedKit count 12.
   - Card source count is greater than chassis-only.
   - Composition bar contains a Med Kit segment.
6. Check browser console for runtime errors.

If local account setup cannot reproduce the real player inventory, use a controlled store seed/test harness and document that limitation.

---

## Phase 8 — Validation, PR, merge

### Task 8.1: Full local validation

Run:

```bash
npx tsc --noEmit
npm run lint
npm test -- --run
npm run build
```

Expected:

- Typecheck passes.
- Lint passes.
- Full Vitest suite passes.
- Build passes.

### Task 8.2: Commit and PR

```bash
git status --short
git add src
ngit commit -m "fix(stats): include consumable inventory in source breakdown"
git push -u origin fix/complete-consumable-source-breakdown
gh pr create --base master --head fix/complete-consumable-source-breakdown \
  --title "Include consumable inventory in source breakdown" \
  --body "## Summary
- derive consumable stat sources from inventory, active buffs, and server survival state
- show Med Kit inventory-backed HP buffer in Max HP source breakdown
- prevent active/server/inventory consumable double-counting
- add regression tests for Med Kit ×12 and consumable source coverage

## Validation
- npx tsc --noEmit
- npm run lint
- npm test -- --run
- npm run build"
```

**Note:** Fix the typo `ngit` to `git` before executing. It is intentionally called out here as a review trap: implementation should not blindly copy commands without reading them.

### Task 8.3: Wait for checks and merge

```bash
gh pr checks <PR_NUMBER> --watch --interval 10
gh pr merge <PR_NUMBER> --squash --delete-branch
```

Only merge if checks pass.

---

## Acceptance criteria

- [ ] With `consumableInventory: { MedKit: 12 }` and no active buffs/server buffer, Max HP Source Breakdown includes `Med Kit ×12` worth `1,800`.
- [ ] With `consumableInventory: { MedKit: 12 }` and `medKitBuffer: 1650`, Max HP includes one MedKit row worth `1,650`, not two rows totaling `3,450`.
- [ ] Max HP stacked/composition bar derives from the same rows as Source Breakdown.
- [ ] Active buff consumables still appear while active/recent.
- [ ] Economy consumables with stat effects appear under the relevant stat metric, not only in Active Buffs pills.
- [ ] No source row uses removed slot labels as mechanics labels.
- [ ] Full validation passes.

---

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| Double-counting MedKit from active buff + inventory + server buffer | Builder precedence: server buffer > active buff > inventory potential. Tests assert one row. |
| Showing potential consumables as if already consumed | Use detail text `Inventory-backed survival buffer` until server state exists. |
| Server and client disagree on count after consumption | Server buffer wins once Chef response hydrates. |
| Reintroducing slot-centric mental model | Do not mention PreFight/MidFight/Emergency in source labels. Slots are UI-only. |
| Existing `consumableMods` duplicates new source logic | Keep `consumableMods` for mechanics totals short-term, but use canonical source builder for rows. Longer-term refactor mechanics totals to consume the same source data. |

---

## Open questions

1. Should Source Breakdown include **all owned consumables** or only consumables relevant to the current activity? Current recommendation: include only stat-relevant contributors for the displayed metric/context.
2. Should MedKit potential be shown in both `Max HP` and `Effective HP`, or should `Effective HP` keep a single `Max HP` aggregate row? Current recommendation: `Max HP` shows MedKit detail; `Effective HP` can show `Max HP` aggregate plus mitigation unless the user wants full nested expansion.
3. Should refined MedKits (`MedKitRefined`) be grouped with MedKit or shown separately? Current recommendation: separate rows if both exist because they have different per-item buffer values.

---

## Implementation note

The important architectural shift is not “add a MedKit fallback again.” The fix is to make consumables first-class stat sources from the beginning of the summary pipeline, so Source Breakdown is a complete accounting surface rather than a view of only already-active buffs.
