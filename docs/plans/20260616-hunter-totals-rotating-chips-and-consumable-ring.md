# Hunter Totals: Rotating Chips + Consumable Ring + Bucketed Source Breakdown

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the Hunter Totals HUD inside the dashboard's `LiveTurfDiorama` from a static 4-chip "museum view" of the loadout into a context-aware readout that shows the active activity's primary modifiers at a glance, exposes loaded consumables as a glanceable pie/ring, and groups source contributions by bucket in the expand modal so the player can see permanent vs temporary modifiers.

**Architecture:**

1. The headline chip bar in `CharacterStatBar` re-derives its 4 metrics from the *current activity kind* instead of always showing Max HP / Effective HP / DPS / Shield Break. The metric registry lives in `src/lib/hud/headlineMetrics.ts` and is keyed by `ActivityKind`. Idle/standby falls back to a `universal` set so the HUD is never empty.
2. A new `ConsumableRing` component sits to the right of the chip bar. It reads the 3 consumable slots from `useLoadoutStore().consumables`, resolves each through `CONSUMABLES[id]` for its glyph and accent color, and renders a pie/ring of one slice per loaded slot. Empty = empty ring. Click → consumable ledger modal.
3. The existing source-breakdown modal in `CharacterStatBar` (`hunter-totals-breakdown`) re-groups the contribution list by `MechanicsContributionBucket` so the player sees "this metric is composed of base + gear + skill + activity + consumable" instead of a flat per-source list. Consumable contributions are visually distinct (e.g. amber pulse accent) so transience reads at a glance.
4. An activity override (subtle chevron in the chip-bar header) lets the player peek at a different activity's chip set. State is local to `CharacterStatBar` (`useState<ActivityKind | null>`); `null` = follow current activity. The override is purely a HUD read concern — it never mutates `useActivityStore`.

**Tech stack:** React 19, TypeScript, Zustand, Framer Motion, Lucide icons, existing `visualAssets` registry.

**Out of scope (explicit non-goals):**

- **In-flight consumable buff tracking with timers.** The current client has no active-buff store — consumable effects are static `baseEffects` data that the Chef (server) applies on trigger. This plan reads only the loaded-slot state, not transient effects. A future PR can add an `activeBuffs` slice and a `repairDurationSeconds`-based countdown; we leave a `useConsumableLedger` hook seam so the work is additive.
- **New `consumableMods` wiring into `buildCharacterMechanicsSnapshot`.** The snapshot already accepts a `consumableMods` parameter but the diorama never passes it. The bucketed source modal will continue to show only what the snapshot returns today. Adding a proper consumable-mod pipeline is a separate backend-coordination effort.
- **Changing the existing `ActivityModifierPanel`.** It already does its job for the *current* activity's gear modifiers. The chip bar now joins it as the at-a-glance layer.
- **Boss-relative DPS label changes.** The "vs Boss" / "Base DPS" label disambiguation from the prior PR stays as-is.
- **Any new gameplay math.** This is a read-side wiring change plus a new visual surface. No formulas change.

**Source-of-truth rules (from `AGENTS.md`):**

- HUD must consume `buildCharacterMechanicsSnapshot` (or a wrapper like `buildCharacterStatSummary`) — never recompute formulas locally.
- New visuals go through the existing `visualAssets` registry. Do not introduce ad-hoc icon imports.
- All `ActivityKind` references import from `@/types/activity`. No narrow local unions.
- Screens remain consumers; no new state mutations outside approved store paths.

---

## Task 1: Activity-keyed headline metric registry

**Goal:** Define a single registry that maps each `ActivityKind` (plus a `universal` fallback) to the 4 `StatMetric` keys the headline chip bar should display, in display order.

**File:** `src/lib/hud/headlineMetrics.ts` (new)

**Step 1: Write the test**

`src/test/headlineMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getHeadlineMetricKeys, HEADLINE_METRIC_KEYS } from '@/lib/hud/headlineMetrics';

describe('headlineMetrics', () => {
  it('returns 4 keys for every activity kind', () => {
    const kinds = ['none', 'idle_standby', 'roaming_loot', 'boss_prep', 'boss_fight', 'crafting', 'salvaging', 'workshop_service', 'market_listing'] as const;
    for (const kind of kinds) {
      expect(getHeadlineMetricKeys(kind)).toHaveLength(4);
    }
  });

  it('falls back to universal for unknown kinds', () => {
    // @ts-expect-error - intentionally bad input
    expect(getHeadlineMetricKeys('not_a_real_kind')).toEqual(HEADLINE_METRIC_KEYS.universal);
  });

  it('roaming activity surfaces economy stats first', () => {
    expect(getHeadlineMetricKeys('roaming_loot')).toEqual(['rareFind', 'scrap', 'offline', 'dps']);
  });

  it('crafting surfaces the four crafting-module primaries', () => {
    expect(getHeadlineMetricKeys('crafting')).toEqual(['craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance']);
  });

  it('idle_standby falls back to universal', () => {
    expect(getHeadlineMetricKeys('idle_standby')).toEqual(HEADLINE_METRIC_KEYS.universal);
  });

  it('every key in the registry is a key produced by buildCharacterStatSummary', () => {
    // Snapshot of the current `all` array keys in characterStats.ts.
    const knownKeys = new Set(['health', 'effectiveHp', 'dps', 'boss', 'shieldBreak', 'armorBreak', 'rareFind', 'offline', 'scrap', 'ordnance']);
    // Crafting / salvaging / market / workshop activity metrics are NOT yet in the
    // snapshot, so we expect the registry to flag them — assert they are NOT
    // referenced until Task 2 adds them.
    const registryKeys = Object.values(HEADLINE_METRIC_KEYS).flat();
    registryKeys.forEach((key) => {
      // @ts-expect-error - test against Set membership
      expect(knownKeys.has(key) || ['craftingSpeed','materialEfficiency','critCraftChance','burstCraftChance',
        'salvageYield','rareMaterialChance','essenceExtraction','explosiveSalvage',
        'marketFeeReduction','marketSaleBonus','listingDurationBonus','premiumPricingChance',
        'workshopSpeed','parallelQueueSlots','overclockChance','failureReduction',
        'creditsPerKill','cacheFragmentChance','materialFindChance','xpBoostMod',
        'offlineScrapMod','offlineXpMod','offlineMaterialMod'].includes(key)).toBe(true);
    });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /data/cybercache && npx vitest run src/test/headlineMetrics.test.ts`
Expected: FAIL — module `@/lib/hud/headlineMetrics` not found.

**Step 3: Write the implementation**

`src/lib/hud/headlineMetrics.ts`:

```ts
import type { ActivityKind } from '@/types/activity';

/**
 * Keys into `CharacterStatSummary.all` (or, in a follow-up,
 * `CharacterMechanicsSnapshot`) that the headline chip bar should display
 * for a given activity. Order matters — leftmost is the most decision-
 * relevant stat for that activity.
 *
 * `universal` is the fallback for any activity without a custom roster
 * (currently `idle_standby` and `none`).
 *
 * IMPORTANT: the keys listed here MUST exist on `CharacterStatSummary.all`
 * OR be added to it as part of this plan. See Task 2 for the new activity-
 * specific metrics that extend the summary.
 */
export const HEADLINE_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  none: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  idle_standby: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  roaming_loot: ['rareFind', 'scrap', 'offline', 'dps'],
  boss_prep: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  boss_fight: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  crafting: ['craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance'],
  salvaging: ['salvageYield', 'rareMaterialChance', 'essenceExtraction', 'explosiveSalvage'],
  workshop_service: ['workshopSpeed', 'parallelQueueSlots', 'overclockChance', 'failureReduction'],
  market_listing: ['marketFeeReduction', 'marketSaleBonus', 'listingDurationBonus', 'premiumPricingChance'],
} as const;

export function getHeadlineMetricKeys(kind: ActivityKind | string | undefined): readonly string[] {
  if (!kind) return HEADLINE_METRIC_KEYS.universal;
  // @ts-expect-error - narrow at runtime
  return HEADLINE_METRIC_KEYS[kind] ?? HEADLINE_METRIC_KEYS.universal;
}
```

**Step 4: Run the test to verify it passes**

Run: `cd /data/cybercache && npx vitest run src/test/headlineMetrics.test.ts`
Expected: PASS — 5 tests pass.

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/lib/hud/headlineMetrics.ts src/test/headlineMetrics.test.ts
git commit -m "feat(hud): add activity-keyed headline metric registry"
```

---

## Task 2: Extend CharacterStatSummary with activity-module metrics

**Goal:** Add the 19 new activity-module metrics to `buildCharacterStatSummary` so the headline registry keys from Task 1 have real `StatMetric` rows in `summary.all` to render. Use the existing `sumActivityModifier` path — no new math.

**File:** `src/lib/stats/characterStats.ts`

**Step 1: Write the failing test**

Append to `src/test/characterStatsDiorama.test.ts`:

```ts
import { sumAllActivityModifiers } from '@/lib/stats/activityModifiers';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';

describe('buildCharacterStatSummary — activity module metrics (PR #2)', () => {
  it('exposes crafting-module subStats as StatMetric rows when a crafting module is equipped', () => {
    // Build a relic with a crafting activity module affix.
    const craftingMod = ACTIVITY_MODULE_DEFS.crafting;
    const relic: Relic = {
      id: 'r1', name: 'Test Relic', level: 50, rarity: 'Epic' as any,
      affixes: [{
        id: 'craft-mod', category: 'activity', stat: 'craftingModule',
        value: 1, displayText: 'Crafting Module',
        subStats: { craftingSpeed: 0.2, materialEfficiency: 0.1, critCraftChance: 0.05, burstCraftChance: 0.04 },
      }],
      sourceTag: 'crafted' as any, isLocked: false,
    };
    const summary = buildCharacterStatSummary({
      player, weapons: [], relic, spentSkills: {},
    });
    const speed = summary.all.find((m) => m.key === 'craftingSpeed');
    expect(speed).toBeDefined();
    expect(speed!.value).toBeCloseTo(0.2, 5);
  });

  it('every activity sub-stat key in ACTIVITY_MODULE_DEFS is represented as a StatMetric', () => {
    const summary = buildCharacterStatSummary({ player, weapons: [], spentSkills: {} });
    const allKeys = new Set(summary.all.map((m) => m.key));
    const moduleKeys = Object.values(ACTIVITY_MODULE_DEFS).flatMap((def) => def.subStats.map((s) => s.key));
    // Module keys are only present as zero-valued metrics when no module is equipped.
    // (The snapshot still creates the row so the HUD can show "no module" instead of nothing.)
    // Skip this assertion if implementation chooses not to seed zero rows.
    moduleKeys.forEach((key) => {
      // Either the key is present OR a future task chose to omit zero rows.
      // We require presence for parity with existing metrics.
      expect(allKeys.has(key)).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatsDiorama.test.ts -t "activity module metrics"`
Expected: FAIL — `summary.all` does not contain keys like `craftingSpeed`.

**Step 3: Extend `buildCharacterStatSummary`**

Open `src/lib/stats/characterStats.ts`. After the existing `metric('ordnance', ...)` row and before the `return`, append the activity-module metrics. Use a single helper that reads `sumActivityModifier` over the gear list (callable from inside `buildCharacterStatSummary`):

```ts
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';

// Inside the function, after the ordnance metric:
const gearForMods = [...liveWeapons, shield, classMod, relic, ordnance].filter((g): g is NonNullable<typeof g> => Boolean(g));
const activityModTotals = {
  crafting: sumActivityModifier(gearForMods, 'crafting'),
  salvaging: sumActivityModifier(gearForMods, 'salvaging'),
  market_listing: sumActivityModifier(gearForMods, 'market_listing'),
  workshop_service: sumActivityModifier(gearForMods, 'workshop_service'),
  roaming_loot: sumActivityModifier(gearForMods, 'roaming_loot'),
  idle_standby: sumActivityModifier(gearForMods, 'idle_standby'),
};

const activityModuleMetrics: StatMetric[] = Object.values(ACTIVITY_MODULE_DEFS).flatMap((def) =>
  def.subStats.map((sub) => {
    const value = activityModTotals[def.activityKind][sub.key] ?? 0;
    return metric(
      sub.key,
      sub.label,
      value,
      signedPct(value),
      `${def.name} · sub-stat`,
      'amber',
      value > 0
        ? gearForMods
            .filter((g) => 'affixes' in g && Array.isArray(g.affixes))
            .flatMap((g) => (g.affixes as any[])
              .filter((a) => a.category === 'activity' && a.stat === `${def.activityKind}Module` && a.subStats?.[sub.key])
              .map((a) => ({
                source: (g as any).name ?? 'Gear',
                detail: a.displayText ?? sub.label,
                value: a.subStats[sub.key],
                display: signedPct(a.subStats[sub.key]),
                tone: 'amber' as StatTone,
              })))
        : [],
    );
  }),
);

return { headline: [all[0], all[1], all[2], all[5]], all: [...all, ...activityModuleMetrics] };
```

**Step 4: Run test to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatsDiorama.test.ts -t "activity module metrics"`
Expected: PASS.

**Step 5: Run the full test suite to check for regressions**

Run: `cd /data/cybercache && npm test`
Expected: All previously-passing tests still pass. The headline test in `characterStatsDiorama.test.ts` still passes because the original `headline` selector (`[all[0], all[1], all[2], all[5]]`) still points at the original 4 metrics.

**Step 6: Commit**

```bash
cd /data/cybercache
git add src/lib/stats/characterStats.ts src/test/characterStatsDiorama.test.ts
git commit -m "feat(hud): expose activity-module sub-stats as StatMetric rows"
```

---

## Task 3: Wire the rotating chip selector in CharacterStatBar

**Goal:** Make the headline chip bar in `CharacterStatBar` render the 4 metrics from the current activity's roster, with a subtle activity override affordance.

**File:** `src/components/stats/CharacterStatBar.tsx`

**Step 1: Write the failing test**

`src/test/characterStatBarRotating.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CharacterStatBar } from '@/components/stats/CharacterStatBar';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
    { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
    { key: 'craftingSpeed', label: 'Craft Speed', value: 0.2, display: '+20%', detail: '', tone: 'amber', contributions: [] },
    { key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: '', tone: 'amber', contributions: [] },
  ],
};

describe('CharacterStatBar rotating chips', () => {
  it('renders the 4 universal chips when activityKind is undefined', () => {
    render(<CharacterStatBar summary={summary} activityKind={undefined} />);
    expect(screen.getByTestId('hud-metric-health')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-dps')).toBeInTheDocument();
  });

  it('renders crafting chips when activityKind is "crafting"', () => {
    render(<CharacterStatBar summary={summary} activityKind="crafting" />);
    // Universal chips are NOT shown — crafting's roster is shown instead.
    expect(screen.queryByTestId('hud-metric-health')).toBeNull();
    expect(screen.getByTestId('hud-metric-craftingSpeed')).toBeInTheDocument();
  });

  it('shows an activity override indicator when overrideActivity is set', () => {
    render(<CharacterStatBar summary={summary} activityKind="roaming_loot" overrideActivity="crafting" />);
    // The override indicator reads "viewing: Crafting" or similar.
    expect(screen.getByTestId('hud-activity-override')).toHaveTextContent(/crafting/i);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatBarRotating.test.tsx`
Expected: FAIL — `CharacterStatBar` props `activityKind` / `overrideActivity` do not exist yet.

**Step 3: Modify `CharacterStatBar`**

Edit `src/components/stats/CharacterStatBar.tsx`. Replace the existing `export const CharacterStatBar` declaration with:

```tsx
import { getHeadlineMetricKeys } from '@/lib/hud/headlineMetrics';
import type { ActivityKind } from '@/types/activity';

export const CharacterStatBar = memo(function CharacterStatBar({
  summary,
  currentHp,
  maxHp,
  activityKind,
  overrideActivity,
  onChangeOverride,
}: {
  summary: CharacterStatSummary;
  currentHp?: number;
  maxHp?: number;
  activityKind?: ActivityKind;
  /** When set, the chip bar shows this activity's roster instead of `activityKind`. */
  overrideActivity?: ActivityKind | null;
  onChangeOverride?: (next: ActivityKind | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const effectiveKind = overrideActivity ?? activityKind;
  const keys = getHeadlineMetricKeys(effectiveKind);
  const headline = keys
    .map((k) => summary.all.find((m) => m.key === k))
    .filter((m): m is StatMetric => Boolean(m));
  const sourceMax = useMemo(() => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))), [summary]);
  const showOverride = Boolean(overrideActivity) && onChangeOverride;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 will-change-transform border-2 border-border bg-surface/95 p-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]" style={panelClip} aria-label="Open hunter totals source breakdown" aria-expanded={open} aria-controls="hunter-totals-breakdown">
        <div className="mb-1 flex items-center justify-between px-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">
          <span>Hunter Totals</span>
          {showOverride ? (
            <button
              type="button"
              data-testid="hud-activity-override"
              onClick={(e) => { e.stopPropagation(); onChangeOverride?.(null); }}
              className="flex items-center gap-1 text-amber"
            >
              <span>viewing: {effectiveKind}</span>
              <X size={10} />
            </button>
          ) : (
            <span className="flex items-center gap-1 text-amber">sources <ChevronDown size={10} /></span>
          )}
        </div>
        <div className="flex gap-1">{headline.map((metric) => <MiniMetric key={metric.key} metric={metric} currentHp={metric.key === 'health' ? currentHp : undefined} maxHp={metric.key === 'health' ? maxHp : undefined} data-testid={`hud-metric-${metric.key}`} />)}</div>
        <TopContribsStrip summary={summary} n={3} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div id="hunter-totals-breakdown" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]" style={panelClip} onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Character Math</div>
                  <div className="bl-title text-3xl leading-none text-text-primary">Source Breakdown</div>
                  <div className="mt-1 text-[10px] text-text-muted">Every total below is split by base hunter values, slotted weapons, shield, ordnance, relic/class mod affixes, and skill nodes.</div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
              </div>
              <div className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber" style={slashClip}>This is a presentation HUD for the current loadout. It makes hidden modifiers visible without replacing server-verified combat math.</div>
              <div className="space-y-2">{summary.all.map((metric) => <SourceRow key={metric.key} metric={metric} max={sourceMax} />)}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
```

**Step 4: Run the test to verify it passes**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatBarRotating.test.tsx`
Expected: PASS — 3 tests pass.

**Step 5: Verify the existing tests still pass**

Run: `cd /data/cybercache && npm test`
Expected: All existing tests still pass. The `TopContribsStrip` and `MiniMetric` prop signatures are unchanged, so prior tests are unaffected. The `CharacterStatBar` `headline` prop is no longer used by callers — see Task 5 for the LiveTurfDiorama update that stops passing it.

**Step 6: Commit**

```bash
cd /data/cybercache
git add src/components/stats/CharacterStatBar.tsx src/test/characterStatBarRotating.test.tsx
git commit -m "feat(hud): rotate headline chips to current activity with override"
```

---

## Task 4: Build the ConsumableRing component

**Goal:** Render a pie/ring of one slice per loaded consumable slot. Glyph + accent from `visualAssets`. Empty = empty ring. Tap → `onClick` callback (the ledger modal in Task 6).

**File:** `src/components/stats/ConsumableRing.tsx` (new)

**Step 1: Write the failing test**

`src/test/ConsumableRing.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConsumableRing } from '@/components/stats/ConsumableRing';

describe('ConsumableRing', () => {
  it('renders an empty ring with no slices when no consumables are loaded', () => {
    const { container } = render(
      <ConsumableRing consumables={{ PreFight: null, MidFight: null, Emergency: null }} onClick={() => {}} />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(0);
    expect(container.querySelector('[data-consumable-empty]')).toBeInTheDocument();
  });

  it('renders one slice per loaded consumable', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'medKit', MidFight: 'ammoPack', Emergency: null }}
        onClick={() => {}}
      />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(2);
  });

  it('invokes onClick when the ring is tapped', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'medKit', MidFight: null, Emergency: null }}
        onClick={onClick}
      />
    );
    fireEvent.click(container.querySelector('[data-consumable-ring]')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd /data/cybercache && npx vitest run src/test/ConsumableRing.test.tsx`
Expected: FAIL — module not found.

**Step 3: Implement the component**

`src/components/stats/ConsumableRing.tsx`:

```tsx
import React from 'react';
import { CONSUMABLES } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

const accentClass: Record<string, string> = {
  green: '#7CFC00', red: '#FF4B5C', orange: '#FF9000', cyan: '#00E5FF',
  amber: '#FFB300', purple: '#B66BFF', blue: '#5AA7FF',
};

export const ConsumableRing: React.FC<{
  consumables: LoadoutConsumables;
  onClick: () => void;
  size?: number;
}> = ({ consumables, onClick, size = 56 }) => {
  const loaded = SLOT_ORDER
    .map((slot) => {
      const id = consumables[slot];
      if (!id) return null;
      const def = CONSUMABLES[id];
      if (!def) return null;
      return { slot, def };
    })
    .filter((entry): entry is { slot: keyof LoadoutConsumables; def: typeof CONSUMABLES[string] } => Boolean(entry));

  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 4;
  const innerR = r - 8;

  if (loaded.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-consumable-ring
        data-consumable-empty
        aria-label="No consumables loaded. Tap to manage."
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2A2F3A" strokeWidth="2" />
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#2A2F3A" strokeWidth="1" />
        </svg>
      </button>
    );
  }

  // Pie slices: each loaded slot gets an equal slice (120deg), starting at top.
  const sliceAngle = 360 / loaded.length;
  let cursor = -90; // start at 12 o'clock

  return (
    <button
      type="button"
      onClick={onClick}
      data-consumable-ring
      aria-label={`${loaded.length} consumable${loaded.length === 1 ? '' : 's'} loaded. Tap to manage.`}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {loaded.map(({ slot, def }) => {
          const startRad = (cursor * Math.PI) / 180;
          const endRad = ((cursor + sliceAngle) * Math.PI) / 180;
          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          const x3 = cx + innerR * Math.cos(endRad);
          const y3 = cy + innerR * Math.sin(endRad);
          const x4 = cx + innerR * Math.cos(startRad);
          const y4 = cy + innerR * Math.sin(startRad);
          const largeArc = sliceAngle > 180 ? 1 : 0;
          const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
          cursor += sliceAngle;
          const color = accentClass[def.visual.accent] ?? '#FF9000';
          return (
            <path
              key={slot}
              d={d}
              fill={color}
              fillOpacity="0.78"
              stroke="#000"
              strokeWidth="1.5"
              data-consumable-slice={slot}
              data-consumable-id={def.id}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={innerR - 2} fill="#050608" />
        <text x={cx} y={cy + 3} textAnchor="middle" fill="#FF9000" fontSize={size * 0.22} fontWeight="900">
          {loaded.length}
        </text>
      </svg>
    </button>
  );
};
```

**Step 4: Run test to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/ConsumableRing.test.tsx`
Expected: PASS — 3 tests pass.

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/components/stats/ConsumableRing.tsx src/test/ConsumableRing.test.tsx
git commit -m "feat(hud): add consumable ring component"
```

---

## Task 5: Mount the ring and pass activityKind into CharacterStatBar

**Goal:** Wire the new ring next to the chip bar and pass `activityKind` from `LiveTurfDiorama` down to `CharacterStatBar`. Implement the activity-override state.

**File:** `src/components/dashboard/LiveTurfDiorama.tsx`

**Step 1: Write the failing test**

`src/test/LiveTurfDioramaRing.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { getRoamingArea } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';

const weapon = { id: 'w1', name: 'Test Gun' } as unknown as Weapon;
const area = getRoamingArea('wastes');

describe('LiveTurfDiorama consumable ring + activity binding', () => {
  it('renders the consumable ring', () => {
    render(
      <LiveTurfDiorama
        area={area}
        weapon={weapon}
        playerLevel={5}
        equippedCount={3}
        cacheKeys={0}
        activityKind="roaming_loot"
        onFight={() => {}}
        onSecondary={() => {}}
      />
    );
    expect(screen.getByTestId('hud-consumable-ring')).toBeInTheDocument();
  });

  it('passes activityKind down to CharacterStatBar for rotating chips', () => {
    render(
      <LiveTurfDiorama
        area={area}
        weapon={weapon}
        playerLevel={5}
        equippedCount={3}
        cacheKeys={0}
        activityKind="crafting"
        onFight={() => {}}
        onSecondary={() => {}}
      />
    );
    // crafting → craftingSpeed is in the headline
    expect(screen.getByTestId('hud-metric-craftingSpeed')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd /data/cybercache && npx vitest run src/test/LiveTurfDioramaRing.test.tsx`
Expected: FAIL — `hud-consumable-ring` test id missing.

**Step 3: Modify LiveTurfDiorama**

In `src/components/dashboard/LiveTurfDiorama.tsx`:

1. Add imports:
```tsx
import { ConsumableRing } from '@/components/stats/ConsumableRing';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger'; // Task 6
```

2. Add state for the consumable ledger modal and the activity override:
```tsx
const [ledgerOpen, setLedgerOpen] = useState(false);
const [overrideActivity, setOverrideActivity] = useState<ActivityKind | null>(null);
const loadout = useLoadoutStore();
```

3. Update the `<CharacterStatBar ...>` JSX (currently at the bottom of the diorama) to pass the new props and sit the ring alongside it:
```tsx
<div className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 flex items-stretch gap-1.5" data-testid="hunter-totals-bar">
  <button
    type="button"
    onClick={() => setOpen(true)}
    className="min-w-0 flex-1 border-2 border-border bg-surface/95 p-1 text-left shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]"
    style={panelClip}
    aria-label="Open hunter totals source breakdown"
  >
    {/* Same contents as before — move CharacterStatBar's body into here, but skip its own outer button */}
    <CharacterStatBarBody summary={computedStats} currentHp={hunterCurrentHp} maxHp={hunterMaxHp} activityKind={activityKind} overrideActivity={overrideActivity} onChangeOverride={setOverrideActivity} setOpen={setOpen} />
  </button>
  <div data-testid="hud-consumable-ring" className="flex shrink-0 items-center">
    <ConsumableRing consumables={loadout.consumables} onClick={() => setLedgerOpen(true)} />
  </div>
</div>
{ledgerOpen && <ConsumableLedger consumables={loadout.consumables} onClose={() => setLedgerOpen(false)} />}
```

Because `CharacterStatBar` is currently a self-contained button + modal, the cleanest path is to **split it into two pieces**: extract the *body* (the chip bar) into a `CharacterStatBarBody` that takes the same props but renders only the chips + top contribs strip, and keep `CharacterStatBar` as the wrapper that adds the button + modal. The new LiveTurfDiorama layout uses the body directly and adds its own button. Existing callers (other screens that mount the whole bar) still get the wrapper. This keeps Task 3's tests for the full wrapper passing.

Concretely, in `src/components/stats/CharacterStatBar.tsx`, refactor:

```tsx
export const CharacterStatBarBody = memo(function CharacterStatBarBody({
  summary, currentHp, maxHp, activityKind, overrideActivity, onChangeOverride,
}: {
  summary: CharacterStatSummary;
  currentHp?: number;
  maxHp?: number;
  activityKind?: ActivityKind;
  overrideActivity?: ActivityKind | null;
  onChangeOverride?: (next: ActivityKind | null) => void;
}) {
  const effectiveKind = overrideActivity ?? activityKind;
  const keys = getHeadlineMetricKeys(effectiveKind);
  const headline = keys
    .map((k) => summary.all.find((m) => m.key === k))
    .filter((m): m is StatMetric => Boolean(m));
  return (
    <>
      <div className="mb-1 flex items-center justify-between px-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">
        <span>Hunter Totals</span>
        {overrideActivity && onChangeOverride ? (
          <button
            type="button"
            data-testid="hud-activity-override"
            onClick={(e) => { e.stopPropagation(); onChangeOverride(null); }}
            className="flex items-center gap-1 text-amber"
          >
            <span>viewing: {effectiveKind}</span>
            <X size={10} />
          </button>
        ) : (
          <span className="flex items-center gap-1 text-amber">sources <ChevronDown size={10} /></span>
        )}
      </div>
      <div className="flex gap-1">{headline.map((metric) => <MiniMetric key={metric.key} metric={metric} currentHp={metric.key === 'health' ? currentHp : undefined} maxHp={metric.key === 'health' ? maxHp : undefined} data-testid={`hud-metric-${metric.key}`} />)}</div>
      <TopContribsStrip summary={summary} n={3} />
    </>
  );
});

// The original CharacterStatBar wrapper becomes:
export const CharacterStatBar = memo(function CharacterStatBar(props: React.ComponentProps<typeof CharacterStatBarBody> & { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const sourceMax = useMemo(() => Math.max(1, ...props.summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))), [props.summary]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 will-change-transform border-2 border-border bg-surface/95 p-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]" style={panelClip} aria-label="Open hunter totals source breakdown" aria-expanded={open} aria-controls="hunter-totals-breakdown">
        <CharacterStatBarBody {...props} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div id="hunter-totals-breakdown" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]" style={panelClip} onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Character Math</div>
                  <div className="bl-title text-3xl leading-none text-text-primary">Source Breakdown</div>
                  <div className="mt-1 text-[10px] text-text-muted">Every total below is split by base hunter values, slotted weapons, shield, ordnance, relic/class mod affixes, and skill nodes.</div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
              </div>
              <div className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber" style={slashClip}>This is a presentation HUD for the current loadout. It makes hidden modifiers visible without replacing server-verified combat math.</div>
              <div className="space-y-2">{props.summary.all.map((metric) => <SourceRow key={metric.key} metric={metric} max={sourceMax} />)}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
```

**Step 4: Run tests to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/LiveTurfDioramaRing.test.tsx src/test/characterStatBarRotating.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/components/dashboard/LiveTurfDiorama.tsx src/components/stats/CharacterStatBar.tsx src/test/LiveTurfDioramaRing.test.tsx
git commit -m "feat(hud): mount consumable ring + activity binding in diorama"
```

---

## Task 6: Consumable ledger modal

**Goal:** When the ring is tapped, show a modal listing each loaded consumable with its slot, name, glyph, quality tier, and the qualitative effect (from `runtime.ledgerText`). Empty slots show a "tap to load" prompt.

**File:** `src/components/stats/ConsumableLedger.tsx` (new)

**Step 1: Write the failing test**

`src/test/ConsumableLedger.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger';

describe('ConsumableLedger', () => {
  it('renders one row per slot, even when empty', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: null, MidFight: 'medKit', Emergency: null }}
        onClose={() => {}}
      />
    );
    expect(screen.getAllByTestId('consumable-ledger-row')).toHaveLength(3);
  });

  it('shows the consumable name and effect for loaded slots', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: 'medKit', MidFight: null, Emergency: null }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/Med Kit/i)).toBeInTheDocument();
  });

  it('invokes onClose when the close button is tapped', () => {
    const onClose = vi.fn();
    render(
      <ConsumableLedger
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText('Close consumable ledger'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd /data/cybercache && npx vitest run src/test/ConsumableLedger.test.tsx`
Expected: FAIL — module not found.

**Step 3: Implement the component**

`src/components/stats/ConsumableLedger.tsx`:

```tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PackageOpen } from 'lucide-react';
import { CONSUMABLES } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useNavigate } from '@/store'; // or however navigation is wired in this project — see existing screens for the pattern

const SLOT_LABELS: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Pre-Fight',
  MidFight: 'Mid-Fight',
  Emergency: 'Emergency',
};

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

const accentClass: Record<string, string> = {
  green: 'text-green border-green/50 bg-green/10',
  red: 'text-red border-red/55 bg-red/10',
  orange: 'text-amber border-amber/55 bg-amber/10',
  cyan: 'text-cyan border-cyan/45 bg-cyan/10',
  amber: 'text-amber border-amber/55 bg-amber/10',
  purple: 'text-purple border-purple/50 bg-purple/10',
  blue: 'text-blue border-blue/45 bg-blue/10',
};

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

export const ConsumableLedger: React.FC<{
  consumables: LoadoutConsumables;
  onClose: () => void;
}> = ({ consumables, onClose }) => {
  // Future: when the project gains an active-buff store, replace the static
  // "loaded" rows with "active" rows that show time-to-expire.
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[80vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]" style={panelClip} onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Combat Pharmacy</div>
              <div className="bl-title text-3xl leading-none text-text-primary">Consumable Ledger</div>
              <div className="mt-1 text-[10px] text-text-muted">What you have loaded. Effects apply on trigger (Pre-Fight on encounter start, Mid-Fight on ammo interval, Emergency on HP/shield threshold).</div>
            </div>
            <button type="button" aria-label="Close consumable ledger" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
          </div>
          <div className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber" style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}>This shows loaded consumables only. In-flight buffs and their expiry are not yet tracked client-side — that data lives on the server. Future PR will add live timer pills here.</div>
          <div className="space-y-2">
            {SLOT_ORDER.map((slot) => {
              const id = consumables[slot];
              const def = id ? CONSUMABLES[id] : null;
              const tone = def ? (accentClass[def.visual.accent] ?? 'text-text-primary border-border bg-bg/80') : 'text-text-muted border-border bg-bg/60';
              return (
                <div
                  key={slot}
                  data-testid="consumable-ledger-row"
                  data-slot={slot}
                  className={`relative flex items-center gap-3 border-2 p-2 ${tone}`}
                  style={panelClip}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border bg-bg/80 text-lg">
                    {def ? <span aria-hidden="true">{def.visual.glyph}</span> : <PackageOpen size={18} className="text-text-muted" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{SLOT_LABELS[slot]}</div>
                    {def ? (
                      <>
                        <div className="truncate text-sm font-black text-text-primary">{def.name}</div>
                        <div className="truncate text-[9px] text-text-muted">{def.runtime.ledgerText}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-black text-text-muted">Empty</div>
                        <div className="truncate text-[9px] text-text-muted">Tap to load — open Inventory or Cache to slot a consumable here.</div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
```

**Step 4: Run test to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/ConsumableLedger.test.tsx`
Expected: PASS — 3 tests pass.

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/components/stats/ConsumableLedger.tsx src/test/ConsumableLedger.test.tsx
git commit -m "feat(hud): add consumable ledger modal"
```

---

## Task 7: Group source contributions by bucket in the breakdown modal

**Goal:** Inside the existing source-breakdown modal, group `metric.contributions` by their `MechanicsContributionBucket` so the player can see permanent vs temporary modifiers at a glance. Render bucket headers; consumable-bucket rows get an amber pulse accent.

**File:** `src/components/stats/CharacterStatBar.tsx`

**Step 1: Write the failing test**

`src/test/sourceBreakdownBuckets.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceRow } from '@/components/stats/CharacterStatBar';
import type { StatMetric } from '@/lib/stats/characterStats';

const metric: StatMetric = {
  key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: '', tone: 'amber',
  contributions: [
    { source: 'Weapon A', detail: 'rareDropChanceMod', value: 0.05, display: '+5%', tone: 'amber', bucket: 'weapon' as any },
    { source: 'Skill Tree', detail: 'rareDropChance', value: 0.04, display: '+4%', tone: 'purple', bucket: 'skill' as any },
    { source: 'Med Kit', detail: 'bonusLootChance', value: 0.09, display: '+9%', tone: 'amber', bucket: 'consumable' as any },
  ],
};

describe('SourceRow bucket grouping', () => {
  it('renders one section per bucket that has contributions', () => {
    render(<SourceRow metric={metric} max={0.1} groupByBucket />);
    expect(screen.getByTestId('source-bucket-weapon')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-skill')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-consumable')).toBeInTheDocument();
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<SourceRow metric={metric} max={0.1} groupByBucket />);
    const consumableRow = screen.getByTestId('source-row-Med Kit-bonusLootChance');
    expect(consumableRow.dataset.transient).toBe('true');
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd /data/cybercache && npx vitest run src/test/sourceBreakdownBuckets.test.tsx`
Expected: FAIL — `groupByBucket` prop and `bucket` field on `StatContribution` are not present.

**Step 3: Extend the types and component**

In `src/lib/stats/characterStats.ts`, add `bucket` to `StatContribution`:

```ts
export type StatContribution = {
  source: string;
  detail: string;
  value: number;
  display: string;
  tone?: StatTone;
  bucket?: 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime';
};
```

Update every `StatContribution` literal in the file to include the appropriate `bucket` (base for chassis, gear for shield/affixes, weapon for weapon-derived, skill for skillContribs, activity for activity module contribs added in Task 2, consumable for the (currently zero) consumable rows).

In `src/components/stats/CharacterStatBar.tsx`, update `SourceRow`:

```tsx
const BUCKET_ORDER = ['base', 'gear', 'weapon', 'skill', 'activity', 'consumable', 'server', 'runtime'] as const;
const BUCKET_LABEL: Record<typeof BUCKET_ORDER[number], string> = {
  base: 'Base chassis',
  gear: 'Gear (shield / ordnance / relic / class mod)',
  weapon: 'Weapons',
  skill: 'Skill tree',
  activity: 'Activity modules',
  consumable: 'Consumables (transient)',
  server: 'Server override',
  runtime: 'Runtime modifier',
};

const SourceRow = memo(function SourceRow({ metric, max, groupByBucket = false }: { metric: StatMetric; max: number; groupByBucket?: boolean }) {
  const tone = toneClass[metric.tone];
  if (!groupByBucket) {
    // Existing flat rendering — preserved for any non-HUD callers.
    return /* ... existing JSX ... */;
  }
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: metric.contributions.filter((c) => (c.bucket ?? 'gear') === bucket),
  })).filter((g) => g.rows.length > 0);
  return (
    <div className="border-2 border-border bg-bg/80 p-2" style={panelClip}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`text-sm font-black uppercase tracking-wide ${tone.text}`}>{metric.label} {metric.display}</div>
          <div className="text-[9px] text-text-muted">{metric.detail}</div>
        </div>
        <div className="text-[9px] font-black uppercase text-text-muted">{metric.contributions.length} sources</div>
      </div>
      <div className="mt-2 space-y-2">
        {grouped.length === 0 && <div className="border border-border bg-surface/80 p-2 text-[10px] text-text-muted">No slotted source is currently contributing to this metric.</div>}
        {grouped.map(({ bucket, rows }) => (
          <div key={bucket} data-testid={`source-bucket-${bucket}`}>
            <div className={`mb-1 text-[8px] font-black uppercase tracking-[0.18em] ${bucket === 'consumable' ? 'text-amber' : 'text-text-muted'}`}>
              {BUCKET_LABEL[bucket]}
            </div>
            <div className="space-y-1">
              {rows.map((source) => {
                const sourceTone = toneClass[source.tone ?? metric.tone];
                const width = Math.max(4, Math.min(100, Math.abs(source.value) / Math.max(1, max) * 100));
                const transient = bucket === 'consumable';
                return (
                  <div
                    key={`${metric.key}-${source.source}-${source.detail}`}
                    data-testid={`source-row-${source.source}-${source.detail}`}
                    data-transient={transient ? 'true' : 'false'}
                    className={`relative overflow-hidden border bg-surface/80 p-2 ${transient ? 'border-amber/60 animate-pulse' : 'border-border'}`}
                    style={slashClip}
                  >
                    <div className={`absolute bottom-0 left-0 h-1 ${sourceTone.rail}`} style={{ width: `${width}%` }} />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-black text-text-primary">{source.source}</div>
                        <div className="text-[9px] text-text-muted">{source.detail}</div>
                      </div>
                      <div className={`shrink-0 text-xs font-black ${sourceTone.text}`}>{source.display}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
```

In the same file, change the modal's `<SourceRow ... />` mapping to pass `groupByBucket`:

```tsx
<div className="space-y-2">{props.summary.all.map((metric) => <SourceRow key={metric.key} metric={metric} max={sourceMax} groupByBucket />)}</div>
```

**Step 4: Run tests to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/sourceBreakdownBuckets.test.tsx`
Expected: PASS — 2 tests pass.

**Step 5: Run the full test suite**

Run: `cd /data/cybercache && npm test`
Expected: All tests pass. (No other test asserts a specific source-row shape inside the modal.)

**Step 6: Commit**

```bash
cd /data/cybercache
git add src/components/stats/CharacterStatBar.tsx src/lib/stats/characterStats.ts src/test/sourceBreakdownBuckets.test.tsx
git commit -m "feat(hud): group source breakdown by bucket; mark consumable rows transient"
```

---

## Task 8: Wire activity-override affordance and final wiring

**Goal:** In `LiveTurfDiorama`, surface the activity-override so the player can tap the chip bar's title to switch the displayed activity. Also: pass the correct `loadout.consumables` from the loadout store.

**File:** `src/components/dashboard/LiveTurfDiorama.tsx`

**Step 1: Verify the wiring from Task 5 is complete**

The previous task already added the override state (`overrideActivity`, `setOverrideActivity`) and the `onChangeOverride` prop on `CharacterStatBarBody`. This task adds the user-facing affordance: a tap on the chip bar's title area cycles through `['roaming_loot', 'crafting', 'salvaging', 'market_listing', 'workshop_service', 'idle_standby']` and sets `overrideActivity`. The X-button next to "viewing: X" resets to `null` (follow current activity).

**Step 2: Add the cycle handler**

In `LiveTurfDiorama`:

```tsx
// Manual cycle: only the activities a player *chooses* to switch into.
// `boss_prep` and `boss_fight` auto-bind the chip bar when the player is
// in those activities (no manual cycle target) — prep is a transitional
// state the player doesn't consciously "switch to."
const ACTIVITY_CYCLE: ActivityKind[] = ['roaming_loot', 'crafting', 'salvaging', 'market_listing', 'workshop_service'];
const cycleOverride = useCallback(() => {
  setOverrideActivity((current) => {
    const idx = current ? ACTIVITY_CYCLE.indexOf(current) : -1;
    return ACTIVITY_CYCLE[(idx + 1) % ACTIVITY_CYCLE.length];
  });
}, []);
```

Pass `cycleOverride` down to the body via a new prop `onCycleActivity` and wire it to the title row's onClick. Specifically, in the body header where "Hunter Totals" is rendered, wrap it in a button that calls `onCycleActivity` when an override handler is present.

**Step 3: Add a test for the cycle behavior**

`src/test/characterStatBarOverride.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';

describe('CharacterStatBarBody activity override', () => {
  it('fires onCycleActivity when the title row is clicked while an override is active', () => {
    const onCycle = vi.fn();
    const { container } = render(
      <CharacterStatBarBody
        summary={{ headline: [], all: [{ key: 'craftingSpeed', label: 'Craft Speed', value: 0.2, display: '+20%', detail: '', tone: 'amber', contributions: [] }] }}
        activityKind="roaming_loot"
        overrideActivity="crafting"
        onChangeOverride={() => {}}
        onCycleActivity={onCycle}
      />
    );
    fireEvent.click(container.querySelector('[data-testid="hunter-totals-title"]')!);
    expect(onCycle).toHaveBeenCalledTimes(1);
  });
});
```

**Step 4: Run the test to verify pass**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatBarOverride.test.tsx`
Expected: PASS.

**Step 5: Run the full test suite**

Run: `cd /data/cybercache && npm test`
Expected: All tests pass.

**Step 6: Run the build to catch type errors**

Run: `cd /data/cybercache && npx tsc --noEmit`
Expected: No new type errors. (Existing test fixtures that don't pass `bucket` will be unaffected because the field is optional.)

**Step 7: Commit**

```bash
cd /data/cybercache
git add src/components/dashboard/LiveTurfDiorama.tsx src/components/stats/CharacterStatBar.tsx src/test/characterStatBarOverride.test.tsx
git commit -m "feat(hud): add tap-to-cycle activity override on chip bar title"
```

---

## Task 9: Mechanic observation notes (not code)

**Goal:** Before designing any in-flight buff tracker, capture what the running game actually does on consumable triggers. This produces a *design input document*, not code.

**Why this is a task in this PR:** A future buff-tracker PR (separate, post-merge) needs a factual basis. Today, no one has watched the chef apply consumable effects in practice and written down what happens. The risk of designing a tracker against assumptions is that the assumptions are wrong. Idle games in particular have edge cases (offline settlement, batched ticks, server-authoritative timing) that don't show up until you watch the loop run.

**File:** `docs/plans/20260616-consumable-buff-mechanic-observations.md` (new)

**Step 1: Build the game and run a session with each consumable family**

For each of the six families (`survival`, `ammo`, `ordnance`, `tactical`, `economy`, `corrupted`), at minimum one consumable per family:

1. Slot the consumable into the right loadout slot.
2. Start a roaming run (covers most `ammoInterval` and `hpBelowThreshold` triggers).
3. Trigger a boss prep + boss fight (covers `fightStart`, `bossMechanic`).
4. Watch the tick feed and the survival store.

**Step 2: For each trigger observed, write down:**

- What event in `useTickFeedStore` fires.
- Whether the chef's response is observable client-side (e.g. a damage number, a heal popup) or invisible (the DPS just went up and you can't tell).
- The duration in seconds (use a stopwatch, not the buff UI).
- Whether the buff can stack with itself or other consumables in the same family.
- Whether the buff persists across the activity transition (e.g. does an Adrenaline Shot fired in a boss fight continue into the post-fight roaming tick?).
- Whether offline settlement is affected (does the buff apply retroactively?).

**Step 3: Cross-reference against the consumable data**

Open `src/constants/consumables.ts` and for each consumable you tested, note which fields in `baseEffects` and `qualityScaling` actually fired and which were declared but inert. Idle-game economy often has declared mechanics that haven't been hooked up to any code path. We need to know which is which.

**Step 4: Commit the doc and the runtime logs**

```bash
cd /data/cybercache
git add docs/plans/20260616-consumable-buff-mechanic-observations.md
git commit -m "docs(mechanics): capture consumable trigger observations for future buff tracker"
```

The doc becomes the input for the next planning conversation. It is **not** an implementation task — it is research.

---

## Task 10: Documentation, final verification, and PR

**Goal:** Update the cybercache-dev skill with the new HUD architecture, run the full verification suite, and open a PR.

**Step 1: Update the cybercache-dev skill**

Add a new reference file `references/hunter-totals-hud.md` under the skill directory. Content outline:

- Purpose: Hunter Totals HUD = `CharacterStatBar` inside `LiveTurfDiorama`.
- Data flow: `LiveTurfDiorama` → `buildCharacterStatSummary` → `buildCharacterMechanicsSnapshot` (existing) + activity module metrics from `sumActivityModifier` (new).
- Headline chip selection: driven by `getHeadlineMetricKeys(activityKind)` in `src/lib/hud/headlineMetrics.ts`. Override state lives in `LiveTurfDiorama` and is local to the HUD read.
- Consumable ring: `ConsumableRing` reads `useLoadoutStore().consumables` (loaded slots only). Click → `ConsumableLedger` modal. **In-flight buffs are not yet tracked client-side** — see `docs/plans/20260616-consumable-buff-mechanic-observations.md` for the runtime observations that will inform the next PR.
- Source breakdown modal: groups `metric.contributions` by `bucket`. Consumable bucket rows are visually transient.
- Boss prep / boss fight: auto-bind the chip bar when the player is in those activities. Manual override cycle excludes them (transition states, not user-selected).
- Out of scope (for this PR): in-flight buff tracking with timers.

Then trim `SKILL.md` if it has grown past the 100k cap and add a pointer in the trigger list: `hunter totals`, `consumable ring`, `character stat bar`, `live turf diorama HUD`.

**Step 2: Run the full verification suite**

```bash
cd /data/cybercache
npm test
npm run build
npm run lint
npx tsc --noEmit
bash scripts/guard-architecture.sh
```

Expected: All five commands succeed. If any fail, report whether pre-existing or introduced.

**Step 3: Visual smoke test on the diorama**

Boot the dev server (`npm run dev`), open the dashboard in a browser, and verify:
1. The chip bar shows activity-specific chips when an activity is active (e.g. start a crafting action — chips should show crafting metrics).
2. The consumable ring shows 0–3 slices depending on what's in the loadout.
3. Tapping the chip bar opens the source breakdown modal, with contributions grouped by bucket.
4. Tapping the ring opens the consumable ledger.
5. Tapping the "Hunter Totals" title (when no override is set) cycles through `roaming → crafting → salvaging → market → workshop` and shows the override indicator.
6. Boss prep and boss fight auto-bind the chip bar (no manual cycle) and the X-button resets to follow-current.

**Step 4: Open a PR**

```bash
cd /data/cybercache
git checkout -b feat/hunter-totals-rotating-chips-and-consumable-ring
git push -u origin feat/hunter-totals-rotating-chips-and-consumable-ring
gh pr create --title "feat(hud): rotating chips + consumable ring + bucketed source breakdown" --body "..."
```

**Step 5: Commit docs and report**

```bash
cd /data/cybercache
git add references/hunter-totals-hud.md SKILL.md
git commit -m "docs(skill): document Hunter Totals HUD architecture"
git push
```

Report to the user: PR URL, what was verified, any gaps, and that the mechanic-observation doc is the input for the next consumable-buff-tracker PR.

---

## Acceptance criteria

- Headline chip bar always shows 4 metrics that are decision-relevant to the *current activity* (or the universal combat set when idle/standby).
- Subtle affordance to cycle through activity chip sets; override indicator with an X to return to follow-current.
- Consumable ring shows 0–3 slices matching the loaded slot state, with per-slot color/glyph from `visualAssets`. Click opens a ledger.
- Ledger lists all 3 slots, showing the loaded consumable's name and effect ledger text, or an "Empty / tap to load" hint.
- Source breakdown modal groups contributions by `bucket`. Consumable-bucket rows are visually transient (amber pulse).
- No new gameplay math, no new server calls, no new state mutation paths.
- All new components are tested, the existing test suite is green, `tsc --noEmit` is clean, `guard-architecture.sh` is clean.
- CyberCache cybercache-dev skill has a new `references/hunter-totals-hud.md` documenting the architecture.
