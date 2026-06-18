# Hunter Totals — Sources button + `boss_prep` collapse (combined PR)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Each task is a self-contained unit with a failing test, the implementation, and a commit. Pause after Task 4 (modal extraction) so the user can confirm the affordance on the live dashboard before continuing with the boss-phase collapse.

**Two changes in one PR:**

1. **Wire the existing source-breakdown modal to a visible `Sources` button** in the Hunter Totals panel header. The modal code already exists (`CharacterStatBar` lines 329-347) but is unreachable because the dashboard mounts `CharacterStatBarBody` (no click handler) instead of `CharacterStatBar` (the wrapper with the modal). The fix is to extract the modal into a standalone component and add an explicit `Sources` button to the panel header.

2. **Collapse `boss_prep` into `boss_fight` with a `bossPhase` payload field.** The two `ActivityKind` values are conceptually one boss encounter; prep is the sub-state between picking a boss and clicking "Start Fight". A single `kind: 'boss_fight'` activity carries `bossPhase: 'prep' | 'fight'`, and the "Start Fight" button flips the phase on the *same* activity instead of starting a new one.

**Architecture (locked):**

- **Sources affordance** is a discrete button on the panel header. The chips stay passive (read-only). Tapping the title text still cycles activity overrides (unchanged). Tapping `Sources` opens the modal. No gesture collisions.
- **Boss phase** is a typed field on the active activity's payload (`ActiveActivity.bossPhase: 'prep' | 'fight'`), defaulting to `'prep'`. The `setBossPhase(phase)` action is a sibling of `setActiveActivity` on the activity store. The boss prep modal's "Start Fight" button calls `setBossPhase('fight')` on the active activity.
- **Backwards compatibility** for old serialised state: `bossPhase` is missing from pre-collapse saves. The activity store back-fills `'prep'` on read when `kind === 'boss_fight' && bossPhase == null`. The collapse PR ships a one-time migration that any `kind: 'boss_prep'` row is renamed to `kind: 'boss_fight', bossPhase: 'prep'`.

**Tech stack:** React 19, TypeScript, Zustand, Framer Motion, Lucide icons, existing `visualAssets` registry. No new dependencies. No new gameplay math.

**Out of scope (explicit non-goals):**

- The consumable ring's pie-slice geometry, the bucketed source breakdown visual treatment, the active-buff data model, the chef → store delivery pipeline — all already shipped.
- The boss prep modal's internal layout, phase analysis, or DPS simulation — only its data-source wiring changes.
- Any changes to `ActivityWorkspace`, `ActivityModifierPanel`, or other workspace components that key off `kind === 'boss_prep'`.
- The `diorama` mode merging prep and fight visuals into one backdrop — task 5 keeps the visual switch but reads it from `bossPhase` instead of `kind`.

**Source-of-truth rules (from `AGENTS.md`):**

- HUD must consume `buildCharacterStatSummary` (or its wrapper) — never recompute formulas locally.
- New visuals go through the existing `visualAssets` registry. No ad-hoc icon imports.
- `ActivityKind` references import from `@/types/activity`. No narrow local unions.
- Screens remain consumers; no new state mutations outside approved store paths.

---

## Task 1: Add `headerActions` slot to `Panel`

**Goal:** Let a panel consumer add trailing affordances to the label row without rebuilding the panel component.

**File:** `src/screens/DashboardScreen.tsx`

**Step 1: Update the `Panel` component**

In `DashboardScreen.tsx` (around line 109), change the `Panel` type and render:

```tsx
const Panel: React.FC<React.PropsWithChildren<{
  label?: string;
  className?: string;
  /** Trailing affordance slot — rendered inside the label row, right-aligned. */
  headerActions?: React.ReactNode;
}>> = ({ label, className = '', headerActions, children }) => (
  <section className={`relative overflow-hidden border-2 border-border bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)] ${className}`} style={panelClip}>
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,144,0,0.12)_0,transparent_34%,rgba(255,75,92,0.08)_100%)]" />
    <div className="pointer-events-none absolute -left-10 top-3 h-3 w-32 -rotate-12 bg-amber/20" />
    {label && (
      <div className="relative mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span>{label}</span>
        {headerActions && <span className="flex shrink-0 items-center gap-1.5">{headerActions}</span>}
        <span className="h-px flex-1 bg-border-light" />
      </div>
    )}
    <div className="relative">{children}</div>
  </section>
);
```

**Step 2: Verify other Panel consumers don't break**

Three other screens use the same `Panel` (`ProfileScreen.tsx`, `LeaderboardsScreen.tsx`, `ActionScreenContextual.tsx`) — they likely have their own local copy. `headerActions` is optional; existing call sites are unaffected.

**Step 3: Run the full test suite**

Run: `cd /data/cybercache && npx vitest run`
Expected: 717/717 still pass (no test exercises the panel header directly today).

**Step 4: Commit**

```bash
cd /data/cybercache
git add src/screens/DashboardScreen.tsx
git commit -m "feat(dashboard): add headerActions slot to Panel for trailing affordances"
```

---

## Task 2: Extract `CharacterStatBreakdownModal`

**Goal:** Move the source-breakdown modal out of `CharacterStatBar` (which is a bar wrapper) into a standalone component that any screen can mount independently.

**File:** `src/components/stats/CharacterStatBar.tsx` (extract) and `src/components/stats/CharacterStatBreakdownModal.tsx` (new)

**Step 1: Write the failing test for the new component**

`src/test/characterStatBreakdownModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    { key: 'dps', label: 'DPS', value: 50, display: '50', detail: 'weapons + skills', tone: 'red', contributions: [
      { source: 'Weapon A', detail: 'base', value: 40, display: '40', tone: 'red', bucket: 'weapon' },
      { source: 'Skill Tree', detail: 'weaponDamage', value: 10, display: '10', tone: 'purple', bucket: 'skill' },
      { source: 'Med Kit', detail: 'dpsMultiplier', value: 5, display: '5', tone: 'amber', bucket: 'consumable' },
    ] },
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
  ],
};

describe('CharacterStatBreakdownModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <CharacterStatBreakdownModal summary={summary} open={false} onClose={() => {}} />,
    );
    expect(container.querySelector('#hunter-totals-breakdown')).toBeNull();
  });

  it('renders the modal with bucketed contributions when open is true', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Character Math')).toBeInTheDocument();
  });

  it('groups contributions by bucket (weapon / skill / consumable visible)', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('source-bucket-weapon')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-skill')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-consumable')).toBeInTheDocument();
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    const consumableRow = screen.getByTestId('source-row-Med Kit-dpsMultiplier');
    expect(consumableRow.dataset.transient).toBe('true');
  });

  it('invokes onClose when the X button is tapped', () => {
    const onClose = vi.fn();
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close source breakdown'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CharacterStatBreakdownModal summary={summary} open={true} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-testid="hunter-totals-breakdown-modal"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatBreakdownModal.test.tsx`
Expected: FAIL — module `@/components/stats/CharacterStatBreakdownModal` not found.

**Step 3: Create the new component**

`src/components/stats/CharacterStatBreakdownModal.tsx`:

```tsx
import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric } from '@/lib/stats/characterStats';
import { SourceRow } from './CharacterStatBar';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

/**
 * The full source-breakdown modal: lists every StatMetric in the summary
 * with its contributions grouped by `bucket`. Extracted from
 * `CharacterStatBar` so the dashboard can mount it from a panel
 * `headerActions` button without dragging in the bar wrapper.
 *
 * Mounts at z-80 to match the existing bar variant. The `open` prop
 * drives AnimatePresence; when `false` the modal is unmounted entirely
 * (no DOM, no backdrop).
 */
export const CharacterStatBreakdownModal: React.FC<{
  summary: CharacterStatSummary;
  open: boolean;
  onClose: () => void;
}> = ({ summary, open, onClose }) => {
  const sourceMax = useMemo(
    () => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))),
    [summary],
  );
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="hunter-totals-breakdown-modal"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            id="hunter-totals-breakdown"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]"
            style={panelClip}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Character Math</div>
                <div className="bl-title text-3xl leading-none text-text-primary">Source Breakdown</div>
                <div className="mt-1 text-[10px] text-text-muted">
                  Every total below is split by base hunter values, slotted weapons, shield, ordnance, relic/class mod affixes, and skill nodes.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close source breakdown"
                onClick={onClose}
                className="bl-secondary shrink-0 p-2 text-text-muted"
              >
                <X size={15} />
              </button>
            </div>
            <div
              className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber"
              style={slashClip}
            >
              This is a presentation HUD for the current loadout. It makes hidden modifiers visible without replacing server-verified combat math.
            </div>
            <div className="space-y-2">
              {summary.all.map((metric) => (
                <SourceRow key={metric.key} metric={metric} max={sourceMax} groupByBucket />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CharacterStatBreakdownModal;
```

**Step 4: Export `SourceRow` from `CharacterStatBar.tsx`**

In `src/components/stats/CharacterStatBar.tsx`, change the `SourceRow` declaration from `const SourceRow = memo(...)` to `export const SourceRow = memo(...)`. The component is already in the file; only its visibility changes. (Confirm by `grep -n 'const SourceRow\|export const SourceRow' src/components/stats/CharacterStatBar.tsx`.)

**Step 5: Slim the `CharacterStatBar` wrapper**

Replace the inline modal JSX in `CharacterStatBar` (lines 329-347) with a call to the new extracted component:

```tsx
import { CharacterStatBreakdownModal } from './CharacterStatBreakdownModal';
// ...
export const CharacterStatBar = memo(function CharacterStatBar({ ... }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="..." aria-label="Open hunter totals source breakdown" ...>
        <CharacterStatBarBody summary={summary} ... />
      </button>
      <CharacterStatBreakdownModal summary={summary} open={open} onClose={() => setOpen(false)} />
    </>
  );
});
```

The `useMemo` for `sourceMax` is removed from the bar (the modal computes it itself now).

**Step 6: Run the new test to verify it passes**

Run: `cd /data/cybercache && npx vitest run src/test/characterStatBreakdownModal.test.tsx`
Expected: PASS — 6 tests pass.

**Step 7: Run the full test suite**

Run: `cd /data/cybercache && npx vitest run`
Expected: 717/717 (or 723/723 with the 6 new tests) pass. The existing `characterStatBarRotating.test.tsx` and `sourceBreakdownBuckets.test.tsx` tests still pass because the bar wrapper still renders identically and `SourceRow` still works as before.

**Step 8: Commit**

```bash
cd /data/cybercache
git add src/components/stats/CharacterStatBar.tsx src/components/stats/CharacterStatBreakdownModal.tsx src/test/characterStatBreakdownModal.test.tsx
git commit -m "refactor(hud): extract CharacterStatBreakdownModal for external mounting"
```

---

## Task 3: Wire the `Sources` button in the Hunter Totals panel

**Goal:** Add a `Sources` button to the Hunter Totals panel header that opens the new modal.

**File:** `src/screens/DashboardScreen.tsx`

**Step 1: Write the failing test**

`src/test/dashboardPanelSourcesButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useActivityStore } from '@/store/slices/activitySlice';

describe('Dashboard Hunter Totals panel — Sources button', () => {
  beforeEach(() => {
    useLoadoutStore.setState({ slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null }, consumables: { PreFight: null, MidFight: null, Emergency: null } });
    usePlayerStore.setState({ player: { id: 'test', handle: 'tester', level: 5, xp: 0, scrap: 0, credits: 0, cacheKeys: 0, freeRewind: 0, createdAt: '', updatedAt: '' } as any });
    useInventoryStore.setState({ items: [], getById: () => undefined } as any);
    useActivityStore.setState({ current: { kind: 'idle_standby', bossPhase: 'prep' } as any });
  });

  it('renders a Sources button in the Hunter Totals panel header', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    expect(screen.getByTestId('hunter-totals-sources-button')).toBeInTheDocument();
  });

  it('opens the source breakdown modal when the Sources button is tapped', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hunter-totals-sources-button'));
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
  });

  it('closes the modal when the X button is tapped', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hunter-totals-sources-button'));
    fireEvent.click(screen.getByLabelText('Close source breakdown'));
    expect(screen.queryByTestId('hunter-totals-breakdown-modal')).toBeNull();
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /data/cybercache && npx vitest run src/test/dashboardPanelSourcesButton.test.tsx`
Expected: FAIL — `hunter-totals-sources-button` test id not found.

**Step 3: Wire the button in `DashboardScreen.tsx`**

Add a `breakdownOpen` state and a `Sources` button to the Hunter Totals panel:

```tsx
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
// ... in the DashboardScreen component:
const [breakdownOpen, setBreakdownOpen] = useState(false);
// ...
<Panel
  label="Hunter Totals"
  headerActions={
    <button
      type="button"
      data-testid="hunter-totals-sources-button"
      onClick={() => setBreakdownOpen(true)}
      className="flex items-center gap-1 border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber transition-colors hover:bg-amber/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber"
      style={signClip}
      aria-label="Open source breakdown for all character stats"
    >
      Sources
      <ChevronDown size={9} />
    </button>
  }
>
  <CharacterStatBarBody
    summary={computedStats}
    currentHp={hunterCurrentHp}
    maxHp={hunterMaxHp}
    activityKind={activity.current.kind}
    overrideActivity={overrideActivity}
    onChangeOverride={setOverrideActivity}
    onCycleActivity={cycleOverride}
  />
</Panel>
{breakdownOpen && (
  <CharacterStatBreakdownModal
    summary={computedStats}
    open={breakdownOpen}
    onClose={() => setBreakdownOpen(false)}
  />
)}
```

**Step 4: Run the new test to verify it passes**

Run: `cd /data/cybercache && npx vitest run src/test/dashboardPanelSourcesButton.test.tsx`
Expected: PASS — 3 tests pass.

**Step 5: Run the full test suite**

Run: `cd /data/cybercache && npx vitest run`
Expected: All tests pass. If any DashboardScreen test exists that doesn't account for the new `breakdownOpen` state, update the fixture to seed a closed state (the modal mounts only when `breakdownOpen` is true, so a closed default is the existing behavior).

**Step 6: Smoke test on the dev server**

Boot: `cd /data/cybercache && npm run dev`. Open the dashboard, tap `Sources` in the Hunter Totals panel header. Verify:
- Modal opens with `Source Breakdown` title
- 19 metrics visible (or however many the snapshot produces)
- Contributions grouped by `Base chassis` / `Gear` / `Weapons` / `Skill tree` / `Activity modules` / `Consumables (transient)`
- Consumable-bucket rows pulse amber
- X button + backdrop click both close

**Step 7: Commit**

```bash
cd /data/cybercache
git add src/screens/DashboardScreen.tsx src/test/dashboardPanelSourcesButton.test.tsx
git commit -m "feat(dashboard): add Sources button to Hunter Totals panel"
```

**⏸ PAUSE POINT.** User verifies the affordance on the live dashboard before continuing to Task 4. If the user wants a different affordance (e.g. label text instead of a separate button), pause and revise.

---

## Task 4: Type + label updates for boss collapse

**Goal:** Add `bossPhase` to `ActiveActivity`, remove `'boss_prep'` from the union, and update the label map.

**File:** `src/types/activity.ts`

**Step 1: Write the failing test**

`src/test/activityKindBossCollapse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ActivityKind } from '@/types/activity';
import { PRODUCTIVE_ACTIVITY_LABELS, IDLE_ACTIVITY, isProductiveActivity, DEFAULT_BOSS_PHASE } from '@/types/activity';

describe('ActivityKind — boss_prep removed, bossPhase added', () => {
  it('does not include boss_prep in the union', () => {
    // The union is structural; assert via label map keys.
    const labels: Record<string, string> = PRODUCTIVE_ACTIVITY_LABELS;
    expect(labels.boss_prep).toBeUndefined();
  });

  it('still includes boss_fight with the right label', () => {
    expect(PRODUCTIVE_ACTIVITY_LABELS.boss_fight).toBe('Boss fight');
  });

  it('IDLE_ACTIVITY has bossPhase prep', () => {
    expect((IDLE_ACTIVITY as any).bossPhase).toBe('prep');
  });

  it('DEFAULT_BOSS_PHASE is prep', () => {
    expect(DEFAULT_BOSS_PHASE).toBe('prep');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /data/cybercache && npx vitest run src/test/activityKindBossCollapse.test.ts`
Expected: FAIL — `boss_prep` is still in `PRODUCTIVE_ACTIVITY_LABELS`, `bossPhase` is not on `IDLE_ACTIVITY`, `DEFAULT_BOSS_PHASE` is not exported.

**Step 3: Update `src/types/activity.ts`**

```ts
export type ActivityKind =
  | 'none'
  | 'idle_standby'
  | 'roaming_loot'
  | 'boss_fight'  // ← was 'boss_prep' | 'boss_fight'
  | 'crafting'
  | 'salvaging'
  | 'workshop_service'
  | 'market_listing';

export type BossPhase = 'prep' | 'fight';
export const DEFAULT_BOSS_PHASE: BossPhase = 'prep';
export function isBossPhase(value: unknown): value is BossPhase {
  return value === 'prep' || value === 'fight';
}

export interface ActiveActivity {
  userId?: string;
  kind: ActivityKind;
  bossPhase: BossPhase;  // ← new
  startedAt: string | null;
  completesAt: string | null;
  targetType: ActivityTargetType | string | null;
  targetId: string | null;
  targetLabel: string | null;
  sceneKey: string | null;
  notes: string | null;
  activityPayload: Record<string, unknown>;
  publicPayload: Record<string, unknown>;
  lastHeartbeatAt: string | null;
  publicVisible: boolean;
  schemaVersion: number;
  updatedAt: string | null;
}

export interface StartActivityInput {
  kind: ActivityKind;
  bossPhase?: BossPhase;  // ← new
  targetType?: ActivityTargetType | string | null;
  // ... (unchanged)
}

export const IDLE_ACTIVITY: ActiveActivity = {
  kind: 'idle_standby',
  bossPhase: DEFAULT_BOSS_PHASE,  // ← new
  startedAt: null,
  // ... (unchanged)
};

export const PRODUCTIVE_ACTIVITY_LABELS: Record<ActivityKind, string> = {
  none: 'None',
  idle_standby: 'Idle standby',
  roaming_loot: 'Roaming loot',
  // boss_prep removed
  boss_fight: 'Boss fight',
  crafting: 'Crafting',
  salvaging: 'Salvaging',
  workshop_service: 'Workshop service',
  market_listing: 'Market listing',
};
```

**Step 4: Run the new test to verify it passes**

Run: `cd /data/cybercache && npx vitest run src/test/activityKindBossCollapse.test.ts`
Expected: PASS — 4 tests pass.

**Step 5: Run the full test suite (this will fail in many places — that's expected)**

Run: `cd /data/cybercache && npx vitest run`
Expected: many failures across `idleTickerBossFight.test.ts`, `ActionScreenContextual.tsx` consumers, `LiveTurfDiorama.tsx`, etc. Each failure tells us a call site that needs updating. Fix them in Tasks 5-7.

For this task, we accept the failures and proceed; the next tasks close them out one file at a time. Do not commit yet.

---

## Task 5: Headline metrics registry + one-shot migration

**Goal:** Drop `boss_prep` from `HEADLINE_METRIC_KEYS`; add a one-shot migration that renames any pre-collapse `kind: 'boss_prep'` to `kind: 'boss_fight', bossPhase: 'prep'`.

**File:** `src/lib/hud/headlineMetrics.ts` + `src/store/slices/activitySlice.ts` (or wherever the activity is hydrated from persistence)

**Step 1: Update `headlineMetrics.ts`**

Remove the `boss_prep` entry. `boss_fight` already returns the right 4 chips (`boss / dps / shieldBreak / armorBreak`).

```ts
export const HEADLINE_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  none: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  idle_standby: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  roaming_loot: ['rareFind', 'scrap', 'offline', 'dps'],
  boss_fight: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  crafting: ['craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance'],
  salvaging: ['salvageYield', 'rareMaterialChance', 'essenceExtraction', 'explosiveSalvage'],
  workshop_service: ['workshopSpeed', 'parallelQueueSlots', 'overclockChance', 'failureReduction'],
  market_listing: ['marketFeeReduction', 'marketSaleBonus', 'listingDurationBonus', 'premiumPricingChance'],
} as const;
```

**Step 2: Write the migration test**

`src/test/activityMigrationBossPrep.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';

describe('migrateActivityForBossCollapse', () => {
  it('renames boss_prep to boss_fight with bossPhase prep', () => {
    const out = migrateActivityForBossCollapse({ kind: 'boss_prep', startedAt: 't', completesAt: null, targetType: null, targetId: null, targetLabel: null, sceneKey: null, notes: null, activityPayload: {}, publicPayload: {}, lastHeartbeatAt: null, publicVisible: true, schemaVersion: 1, updatedAt: null } as any);
    expect(out.kind).toBe('boss_fight');
    expect(out.bossPhase).toBe('prep');
  });

  it('back-fills bossPhase prep for pre-collapse boss_fight rows', () => {
    const out = migrateActivityForBossCollapse({ kind: 'boss_fight', startedAt: 't' } as any);
    expect(out.bossPhase).toBe('prep');
  });

  it('leaves bossPhase alone if already set on a boss_fight row', () => {
    const out = migrateActivityForBossCollapse({ kind: 'boss_fight', bossPhase: 'fight' } as any);
    expect(out.bossPhase).toBe('fight');
  });

  it('passes through non-boss activities unchanged', () => {
    const input = { kind: 'crafting', bossPhase: undefined as any };
    const out = migrateActivityForBossCollapse(input);
    expect(out).toEqual(input);
  });
});
```

**Step 3: Implement the migration**

`src/lib/activity/activityMigration.ts`:

```ts
import type { ActiveActivity, BossPhase } from '@/types/activity';
import { DEFAULT_BOSS_PHASE } from '@/types/activity';

/**
 * One-shot migration for the boss_prep → boss_fight collapse.
 *
 *   - Pre-collapse `kind: 'boss_prep'` becomes `kind: 'boss_fight', bossPhase: 'prep'`.
 *   - Pre-collapse `kind: 'boss_fight'` without `bossPhase` gets `bossPhase: 'prep'`.
 *   - Everything else is passed through unchanged.
 *
 * This runs on every activity hydration. Idempotent: running it twice
 * on the same input produces the same output.
 */
export function migrateActivityForBossCollapse<T extends Partial<ActiveActivity>>(input: T): T {
  if (input.kind === ('boss_prep' as any)) {
    return { ...input, kind: 'boss_fight' as any, bossPhase: DEFAULT_BOSS_PHASE };
  }
  if (input.kind === 'boss_fight' && !input.bossPhase) {
    return { ...input, bossPhase: DEFAULT_BOSS_PHASE };
  }
  return input;
}
```

**Step 4: Wire the migration into activity hydration**

In the activity slice (or wherever `setActiveActivity` / hydration runs), apply the migration on every write. Typical pattern:

```ts
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';
// ...
setActiveActivity: (input) => set((s) => ({
  current: migrateActivityForBossCollapse({ ...s.current, ...input }),
})),
```

If the slice reads from persistence on boot (`useEffect` hydrate or similar), apply the migration there too.

**Step 5: Run the new test**

Run: `cd /data/cybercache && npx vitest run src/test/activityMigrationBossPrep.test.ts`
Expected: PASS — 4 tests pass.

**Step 6: Commit**

```bash
cd /data/cybercache
git add src/lib/hud/headlineMetrics.ts src/lib/activity/activityMigration.ts src/test/activityMigrationBossPrep.test.ts src/store/slices/activitySlice.ts
git commit -m "refactor(activity): drop boss_prep from union; add bossPhase + one-shot migration"
```

---

## Task 6: Activity store — `setBossPhase` action

**Goal:** Add a `setBossPhase(phase)` action to the activity store. The "Start Fight" button calls this on the active activity instead of starting a new activity.

**File:** `src/store/slices/activitySlice.ts`

**Step 1: Write the failing test**

`src/test/activitySliceBossPhase.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityStore } from '@/store/slices/activitySlice';
import type { ActiveActivity } from '@/types/activity';

describe('activitySlice — setBossPhase', () => {
  beforeEach(() => {
    useActivityStore.setState({ current: { kind: 'boss_fight', bossPhase: 'prep' } as ActiveActivity });
  });

  it('flips bossPhase from prep to fight on a boss_fight activity', () => {
    useActivityStore.getState().setBossPhase('fight');
    expect(useActivityStore.getState().current.bossPhase).toBe('fight');
    expect(useActivityStore.getState().current.kind).toBe('boss_fight');
  });

  it('flips bossPhase from fight to prep', () => {
    useActivityStore.setState({ current: { kind: 'boss_fight', bossPhase: 'fight' } as ActiveActivity });
    useActivityStore.getState().setBossPhase('prep');
    expect(useActivityStore.getState().current.bossPhase).toBe('prep');
  });

  it('is a no-op on a non-boss activity', () => {
    useActivityStore.setState({ current: { kind: 'crafting', bossPhase: 'prep' } as any });
    useActivityStore.getState().setBossPhase('fight');
    expect(useActivityStore.getState().current.bossPhase).toBe('prep');
  });
});
```

**Step 2: Implement the action**

```ts
// In activitySlice:
setBossPhase: (phase: BossPhase) => set((s) => {
  if (s.current?.kind !== 'boss_fight') return s;
  return { current: { ...s.current, bossPhase: phase } };
}),
```

Export `BossPhase` from the slice types if needed.

**Step 3: Run the test, then the full suite**

Run: `cd /data/cybercache && npx vitest run src/test/activitySliceBossPhase.test.ts && npx vitest run`
Expected: new test passes; full suite still has the same failures as Task 5 left (call-site updates still needed).

**Step 4: Commit**

```bash
cd /data/cybercache
git add src/store/slices/activitySlice.ts src/test/activitySliceBossPhase.test.ts
git commit -m "feat(activity): add setBossPhase action for the unified boss_fight activity"
```

---

## Task 7: Update call sites — boss prep modal

**Goal:** `BossPrepModal` uses `buildBossFightActivity(target, weapon, 'prep')` instead of the removed `buildBossPrepActivity`. "Start Fight" calls `setBossPhase('fight')` instead of starting a new activity.

**File:** `src/components/fight/BossPrepModal.tsx`, `src/lib/activity/activityBuilders.ts`

**Step 1: Update `activityBuilders.ts`**

Remove `buildBossPrepActivity` (or keep it as a thin alias if external code still references it — but the goal is full removal, so check first). Add `buildBossFightActivity(target, weapon, phase: BossPhase = 'prep')`:

```ts
export function buildBossFightActivity(target: BossDef, weapon: Weapon, phase: BossPhase = 'prep'): ActiveActivity {
  return {
    kind: 'boss_fight',
    bossPhase: phase,
    startedAt: new Date().toISOString(),
    completesAt: null,
    targetType: 'boss',
    targetId: target.id,
    targetLabel: target.name,
    sceneKey: 'boss_prep',  // or whatever the scene key was
    notes: null,
    activityPayload: { bossId: target.id, weaponId: weapon.id },
    publicPayload: {},
    lastHeartbeatAt: null,
    publicVisible: true,
    schemaVersion: 2,  // bump to flag the new shape
    updatedAt: new Date().toISOString(),
  };
}
```

**Step 2: Grep for all call sites**

Run: `cd /data/cybercache && grep -rn "buildBossPrepActivity" src --include='*.ts' --include='*.tsx'`
Expected: hits in `BossPrepModal.tsx` and `ActionScreenContextual.tsx` (and any test that imports it).

**Step 3: Update `BossPrepModal.tsx`**

In the modal's "Start Fight" handler:

```tsx
// Before:
startAction(buildBossPrepActivity(target, activityWeapon), makeRunEvent(...));
// After (only if no boss activity is active yet):
if (activity.current?.kind !== 'boss_fight') {
  startAction(buildBossFightActivity(target, activityWeapon, 'prep'), makeRunEvent(...));
}
setBossPhase('fight');
```

Confirm: import `setBossPhase` from the activity store; remove the `buildBossPrepActivity` import.

**Step 4: Update `ActionScreenContextual.tsx`**

Replace the `buildBossPrepActivity(...)` call at line 428 with `buildBossFightActivity(target, activityWeapon, 'prep')`. The `makeRunEvent('BOSS PREP', ...)` label becomes `makeRunEvent('BOSS FIGHT', ...)` (with `phase: 'prep'` in the payload).

**Step 5: Run `vitest`**

Run: `cd /data/cybercache && npx vitest run`
Expected: failures drop to zero (or to only the test fixtures that hardcode `kind: 'boss_prep'` literals).

**Step 6: Commit**

```bash
cd /data/cybercache
git add src/lib/activity/activityBuilders.ts src/components/fight/BossPrepModal.tsx src/screens/ActionScreenContextual.tsx
git commit -m "refactor(boss): switch prep modal to buildBossFightActivity + setBossPhase"
```

---

## Task 8: Update call sites — diorama + action screen

**Goal:** Replace `kind === 'boss_prep'` checks with `kind === 'boss_fight' && bossPhase === 'prep'`. Drop `'bossPrep'` from the diorama mode union; drive the visual switch off `bossPhase`.

**File:** `src/components/dashboard/LiveTurfDiorama.tsx`, `src/screens/ActionScreenContextual.tsx`

**Step 1: Update `LiveTurfDiorama.tsx`**

- `DioramaMode` type: drop `'bossPrep'`. Read `bossPhase` from the activity store. The mode is just `'bossFight'`, with a derived `isPrepping` boolean.
- `kindToMode`: `boss_fight` → `'bossFight'`.
- The `if (mode === 'bossPrep')` switch in the SVG layer becomes `if (isPrepping)`. The visual treatment stays the same; only the trigger source changes.
- `<BossHpOverlay active={...} />` (line 711): from
  `activityKind === 'boss_fight' || activityKind === 'boss_prep'`
  to
  `activityKind === 'boss_fight' && bossPhase === 'fight'`.

**Step 2: Update `ActionScreenContextual.tsx`**

The references at lines 84, 428, 466, 474, 649, 700, 713, 717, 739 (per the prior discovery grep) need to switch to:
- Line 84: remove the `boss_prep` spec entry. Update `boss_fight` spec to encompass prep semantics.
- Lines 466, 474, 700: `currentKind === 'boss_prep' || currentKind === 'boss_fight'` → `currentKind === 'boss_fight'`.
- Line 649: `currentKind === 'boss_prep'` → `currentKind === 'boss_fight' && bossPhase === 'prep'`.
- Line 713: `currentKind === 'boss_prep' ? 'Start Fight'` → `bossPhase === 'prep' ? 'Start Fight' : 'Resume Fight'`.
- Line 717: same shape.
- Line 739: `label === 'Boss Prep' && currentKind === 'boss_prep'` → `label === 'Boss Prep' && currentKind === 'boss_fight' && bossPhase === 'prep'`.

For 700 (`boss={...}`), the prop is shared. No change needed there beyond the kind match.

**Step 3: Update other consumers (animation director, run events)**

`src/lib/activity/actionAnimationDirector.ts` and `src/lib/run/runEvents.ts`: replace any `boss_prep` literals with `boss_fight` + `bossPhase === 'prep'`. Grep first to confirm what changes.

**Step 4: Run `vitest`**

Run: `cd /data/cybercache && npx vitest run`
Expected: most tests green; remaining failures are isolated test fixtures that hardcode `kind: 'boss_prep'` literals (Task 9 closes those).

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/components/dashboard/LiveTurfDiorama.tsx src/screens/ActionScreenContextual.tsx src/lib/activity/actionAnimationDirector.ts src/lib/run/runEvents.ts
git commit -m "refactor(hud): collapse boss_prep checks into boss_fight + bossPhase"
```

---

## Task 9: Update test fixtures

**Goal:** Replace `kind: 'boss_prep'` literals with `kind: 'boss_fight', bossPhase: 'prep'`.

**Step 1: Grep for any remaining `boss_prep` references**

Run: `cd /data/cybercache && grep -rn "boss_prep" src --include='*.ts' --include='*.tsx'`
Expected: only test fixtures and possibly a comment in the migration file.

**Step 2: Update each test fixture**

For each hit, replace the literal. Common patterns:
- `kind: 'boss_prep'` → `kind: 'boss_fight', bossPhase: 'prep'`
- `kinds.push('boss_prep')` → `kinds.push('boss_fight')` (the union no longer has `boss_prep`, so the kinds array test updates accordingly)
- `'boss_prep'` in a switch → `'boss_fight'` with a follow-up `bossPhase` check

**Step 3: Run the full suite**

Run: `cd /data/cybercache && npx vitest run`
Expected: 720+/720+ pass (the 4 from Task 5 type test, 4 from Task 5 migration test, 3 from Task 6 slice test, 3 from Task 3 dashboard button test, 6 from Task 2 modal test = 720 minimum, plus existing 717 minus 0-2 that we may have had to drop).

**Step 4: `tsc --noEmit`**

Run: `cd /data/cybercache && npx tsc --noEmit`
Expected: no errors. (If existing test fixtures had `kind: 'boss_prep'` as a literal that the type system previously accepted, the union change now rejects them — Task 9 closes that gap.)

**Step 5: Commit**

```bash
cd /data/cybercache
git add src/test
git commit -m "test: replace boss_prep fixtures with boss_fight + bossPhase"
```

---

## Task 10: Final verification + PR

**Step 1: Run the full verification matrix**

```bash
cd /data/cybercache
npm test
npm run build
npm run lint
npx tsc --noEmit
bash scripts/guard-architecture.sh  # if it exists
```

Expected: all five commands succeed.

**Step 2: Live smoke test**

Boot the dev server. Verify the full user journey:

1. Open the dashboard. Tap the new `Sources` button in the Hunter Totals panel header. Confirm the source breakdown modal opens, shows all 19 metrics bucketed by `Base chassis / Gear / Weapons / Skill tree / Activity modules / Consumables (transient)`, and closes via X / backdrop.
2. Tap the `Hunter Totals` title text. Confirm the activity override cycles (roaming → crafting → salvaging → ...).
3. Open the boss prep modal. Confirm the chips show boss metrics.
4. Tap "Start Fight". Confirm the activity stays as `boss_fight` with `bossPhase: 'fight'` (not a new activity).
5. Tap "Cancel prep" (if exposed). Confirm the activity stays as `boss_fight` with `bossPhase: 'prep'`.
6. Quit the app, restart, and confirm the migration ran: any previously-boss_prep activity now reads as `boss_fight, bossPhase: 'prep'`.

**Step 3: Update references**

- Update `references/hunter-totals-hud.md` to describe the new `Sources` button affordance and the `bossPhase` discriminator.
- Update `references/` skill docs for any other affected topics (boss prep modal, action screen).
- Trim `SKILL.md` if it has grown past the 100k cap; add a pointer in the trigger list: `hunter totals sources button`, `boss phase`, `boss_prep collapse`.

**Step 4: Open the PR**

```bash
cd /data/cybercache
git checkout -b feat/hunter-totals-sources-button-and-boss-collapse
git push -u origin feat/hunter-totals-sources-button-and-boss-collapse
gh pr create --title "feat(hud): Sources button + collapse boss_prep into boss_fight" --body "..."
```

PR body outline:
- **What:** Adds a `Sources` button to the Hunter Totals panel header that opens the existing source-breakdown modal. Collapses `ActivityKind.boss_prep` into `boss_fight` with a new `bossPhase: 'prep' | 'fight'` payload field.
- **Why:** The source breakdown modal existed but was unreachable from the dashboard (it shipped inside `CharacterStatBar`, which the dashboard bypassed in favor of `CharacterStatBarBody`). Separately, prep and fight were over-modeled as distinct activities; collapsing simplifies the lifecycle and prevents state divergence (e.g. two simultaneous boss activities).
- **Risk:** Low. The chef and the active-buff delivery pipeline are untouched. The collapse has a one-shot migration that runs on hydration; old saves read as `boss_fight, bossPhase: 'prep'`. The `Sources` button is additive (no behavior removed).
- **Verification:** 720+ tests pass. `tsc --noEmit` clean. Manual smoke on the dashboard confirmed the modal opens/closes and the boss phase transition works.

**Step 5: Commit docs**

```bash
cd /data/cybercache
git add references/ SKILL.md
git commit -m "docs(skill): document Sources button + bossPhase collapse"
git push
```

Report the PR URL, what was verified, and any gaps.

---

## Acceptance criteria

- **Sources button** is visible in the Hunter Totals panel header. Tap opens the source breakdown modal showing all 19 metrics bucketed by source. Modal closes via X and backdrop. Chips stay passive (no click target). Tapping the title still cycles activity overrides.
- **`boss_prep` is gone from the type system.** `ActivityKind` has 8 members (not 9). The grep `grep -rn "'boss_prep'" src --include='*.ts' --include='*.tsx'` returns no hits in source files (only in the migration file's docstring).
- **Boss prep modal:** the "Start Fight" button calls `setBossPhase('fight')` on the active activity. No new activity is started. `bossPhase` is preserved across the round-trip (UI → store → serialised state → store → UI). Pre-collapse saves (no `bossPhase` field) back-fill to `'prep'`.
- **All tests green.** `npx vitest run` passes. `npx tsc --noEmit` passes. `npm run build` and `npm run lint` pass.
- **No regressions** in the active-buff delivery pipeline, the consumable ring, the consumable ledger, the bucketed source breakdown, the chef→store adapter, or the activity→store adapter.
- **No new gameplay math.** No new state mutation paths outside the `setBossPhase` action.
- **Skill docs updated.** `references/hunter-totals-hud.md` describes the `Sources` button and the `bossPhase` discriminator. `SKILL.md` trigger list includes the new terms.
