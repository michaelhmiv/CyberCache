# Dashboard & ConsumableRing Fix — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **Branch:** `fix/dashboard-clarity` off `master` (commit `2776d4e`)
> **Tests:** 711 passing | **tsc:** clean

**Goal:** Fix the dashboard's information poverty, declutter the diorama, make the
ConsumableRing show actionable buff state instead of just a count, and restore
at-a-glance activity status.

**Architecture:** Three phases — (1) wire the data layer so buffs actually flow from
chef → tick feed → activeBuffsStore → HUD, (2) replace the ConsumableRing with a
horizontal active-buff pill strip that shows **which** buffs are active and how much
time remains, (3) pull the CharacterStatBar and new buff strip OUT of the diorama
into the dashboard's scroll flow, restoring the diorama as a visualization-only
surface, (4) add a compact Current Activity indicator and improve affordances.

**Core decision for the dashboard surface:** "What is happening to me right now?"
(live readout) with expansion paths to "What should I equip?" (source breakdown).

**Root cause addressed:** The original sprint built UI before the data plumbing
was resolved. This plan fixes the data layer FIRST, then reworks the UI on top
of real data.

---

## Phase 1: Data Plumbing — Make Buffs Real

> **Gate:** After Phase 1, `useActiveBuffsStore` must receive chef-emitted buff events
> via the tick feed. The ring/pill strip will be rewritten in Phase 2 on top of real data.

### Task 1.1: Wire `consumableMods` into the snapshot

**Objective:** Pass the player's loaded consumable effects into
`buildCharacterMechanicsSnapshot` so the stat bar's consumable bucket shows real
numbers instead of always being empty.

**Files:**
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx` (~line 685)
- Modify: `src/lib/stats/characterStats.ts`
- Check: `src/lib/mechanics/buildCharacterMechanicsSnapshot.ts` (existing contract)

**Step 1: Create the consumableMods adapter**

Create `src/lib/buffs/consumableModsAdapter.ts`:

```ts
import { CONSUMABLES, type ConsumableType } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';

/**
 * Convert the player's loaded consumables into a flat Record<string, number>
 * suitable for `buildCharacterMechanicsSnapshot(…, { consumableMods })`.
 *
 * Maps the `runtime.baseEffects` fields that the snapshot reads into
 * snapshot-friendly keys. Only includes consumables that are loaded
 * (non-null) and recognised by the CONSUMABLES registry.
 *
 * Snapshot-consumed keys (from buildCharacterMechanicsSnapshot.ts):
 *   rareDropChanceMod, lootQuantity, bonusLootChance, scrapYieldMod, xpBoostMod
 *
 * Additional keys that the snapshot doesn't read yet (future-proofing):
 *   dpsMultiplier, shieldBreakMultiplier, armorBreakMultiplier,
 *   critChanceBonus, armorBypass, dodgeChanceBonus, staggerChance,
 *   yieldMultiplier, deathFeeReduction, eventChanceBonus
 */
export function buildConsumableMods(
  consumables: LoadoutConsumables,
): Record<string, number> {
  const mods: Record<string, number> = {};
  const SLOTS: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

  for (const slot of SLOTS) {
    const id = consumables[slot] as ConsumableType | null;
    if (!id) continue;
    const def = CONSUMABLES[id as keyof typeof CONSUMABLES];
    if (!def) continue;
    const eff = def.runtime.baseEffects;

    // Keys the snapshot reads
    if (typeof eff.rareDropChanceMod === 'number') mods.rareDropChanceMod = (mods.rareDropChanceMod ?? 0) + eff.rareDropChanceMod;
    if (typeof eff.lootQuantity === 'number') mods.lootQuantity = (mods.lootQuantity ?? 0) + eff.lootQuantity;
    if (typeof eff.bonusLootChance === 'number') mods.bonusLootChance = (mods.bonusLootChance ?? 0) + eff.bonusLootChance;
    if (typeof eff.scrapYieldMod === 'number') mods.scrapYieldMod = (mods.scrapYieldMod ?? 0) + eff.scrapYieldMod;
    if (typeof eff.xpBoostMod === 'number') mods.xpBoostMod = (mods.xpBoostMod ?? 0) + eff.xpBoostMod;

    // Future keys (additive — the snapshot doesn't read them yet)
    if (typeof eff.dpsMultiplier === 'number') mods.dpsMultiplier = (mods.dpsMultiplier ?? 1) * eff.dpsMultiplier;
    if (typeof eff.shieldBreakMultiplier === 'number') mods.shieldBreakMultiplier = (mods.shieldBreakMultiplier ?? 1) * eff.shieldBreakMultiplier;
    if (typeof eff.armorBreakMultiplier === 'number') mods.armorBreakMultiplier = (mods.armorBreakMultiplier ?? 1) * eff.armorBreakMultiplier;
    if (typeof eff.critChanceBonus === 'number') mods.critChanceBonus = (mods.critChanceBonus ?? 0) + eff.critChanceBonus;
    if (typeof eff.armorBypass === 'number') mods.armorBypass = (mods.armorBypass ?? 0) + eff.armorBypass;
    if (typeof eff.dodgeChanceBonus === 'number') mods.dodgeChanceBonus = (mods.dodgeChanceBonus ?? 0) + eff.dodgeChanceBonus;
    if (typeof eff.staggerChance === 'number') mods.staggerChance = (mods.staggerChance ?? 0) + eff.staggerChance;
    if (typeof eff.yieldMultiplier === 'number') mods.yieldMultiplier = (mods.yieldMultiplier ?? 1) * eff.yieldMultiplier;
    if (typeof eff.deathFeeReduction === 'number') mods.deathFeeReduction = (mods.deathFeeReduction ?? 0) + eff.deathFeeReduction;
    if (typeof eff.eventChanceBonus === 'number') mods.eventChanceBonus = (mods.eventChanceBonus ?? 0) + eff.eventChanceBonus;
  }

  return mods;
}
```

**Step 2: Wire the adapter into LiveTurfDiorama**

In `src/components/dashboard/LiveTurfDiorama.tsx`, import the adapter and pass it
to `buildCharacterStatSummary`:

```tsx
import { buildConsumableMods } from '@/lib/buffs/consumableModsAdapter';

// Inside LiveTurfDiorama, after existing useMemo:
const consumableMods = useMemo(
  () => buildConsumableMods(loadout.consumables),
  [loadout.consumables],
);

// Modify the computedStats useMemo to pass consumableMods:
const computedStats = useMemo<CharacterStatSummary>(
  () => statSummary ?? buildCharacterStatSummary({
    player, weapons: statWeapons, shield: loadout.getShield(),
    classMod: loadout.getClassMod(), relic: loadout.getRelic(),
    ordnance: loadout.getOrdnance(), spentSkills: skills.spent,
    boss, activeBuffs,
    consumableMods,  // ← NEW
  }),
  [statSummary, player.level, primaryWeapon, secondaryWeapon, heavyWeapon,
   weapon, loadout, skills.spent, boss, activeBuffs, consumableMods],
);
```

**Step 3: Thread consumableMods through characterStats**

In `src/lib/stats/characterStats.ts`, update `buildCharacterStatSummary` to accept
and forward `consumableMods`:

```ts
export function buildCharacterStatSummary(input: {
  // … existing fields …
  consumableMods?: Record<string, number>;  // ← NEW
}): CharacterStatSummary {
  const snapshot = buildCharacterMechanicsSnapshot({
    // … existing spread …
    consumableMods: input.consumableMods,  // ← pass through
  });
  // … rest unchanged …
}
```

**Step 4: Verify**

Run: `npx vitest run src/test/characterStatsDiorama.test.ts src/test/characterStatBarRotating.test.tsx`

Expected: All existing tests pass. The consumable bucket in the source breakdown
modal now shows actual modifiers when consumables are loaded.

**Step 5: Commit**

```bash
git add src/lib/buffs/consumableModsAdapter.ts src/components/dashboard/LiveTurfDiorama.tsx src/lib/stats/characterStats.ts
git commit -m "feat(hud): wire consumableMods into snapshot so consumable bucket shows real numbers"
```

---

### Task 1.2: Emit buff events from chef response into tick feed

**Objective:** When the chef processes a boss attempt or activity result, emit
per-consumable buff events into the tick feed so the client can track which
consumables fired and for how long.

**Files:**
- Modify: `src/store/slices/tickSlice.ts` (add `BuffEvent` type and dispatcher)
- Modify: `src/lib/chef/bossResultAdapter.ts` (emit buff events after boss result)
- Check: `src/lib/chef/chefClient.ts` (activity results)
- Check: `src/lib/buffs/activeBuffs.ts` (CONSUMABLE_ACTIVATORS registry)

**Step 1: Add BuffEvent to tick feed**

In `src/store/slices/tickSlice.ts`, add:

```ts
import type { ConsumableType } from '@/types/game';

export interface BuffEvent {
  type: 'consumable-fired';
  consumableId: ConsumableType;
  source: 'boss-result' | 'activity-result';
  sourceId: string;
  startedAt: number;
  durationMs: number;
  qualityPercent?: number;
}
```

Add `dispatchBuffEvent` to the store's actions:

```ts
dispatchBuffEvent: (event: BuffEvent) => set((state) => ({
  buffEvents: [...state.buffEvents.slice(-19), event],
})),
```

Add `buffEvents: BuffEvent[]` to the state interface.

**Step 2: Emit from boss result adapter**

In `src/lib/chef/bossResultAdapter.ts`, after a boss result is processed,
emit buff events for each `consumedConsumables` entry:

```ts
import { CONSUMABLE_ACTIVATORS, resolveConsumableDuration } from '@/lib/buffs/activeBuffs';
import { useTickFeedStore } from '@/store/slices/tickSlice';

// After resolving a boss result:
const consumedMap = result.consumedConsumables ?? {};
for (const [type, count] of Object.entries(consumedMap)) {
  const activator = CONSUMABLE_ACTIVATORS[type as ConsumableType];
  if (!activator) continue;
  for (let i = 0; i < count; i++) {
    const buffEvent: BuffEvent = {
      type: 'consumable-fired',
      consumableId: type as ConsumableType,
      source: 'boss-result',
      sourceId: result.attemptId,
      startedAt: Date.now(),
      durationMs: resolveConsumableDuration(type as ConsumableType, result.quality ?? 0),
      qualityPercent: result.quality,
    };
    useTickFeedStore.getState().dispatchBuffEvent(buffEvent);
  }
}
```

**Step 3: Verify**

Run: `npx vitest run src/test/bossResultAdapter.test.ts src/test/tickFeedTones.test.ts`

Expected: Existing tests pass. Add a new test verifying buff events are emitted.

**Step 4: Commit**

```bash
git add src/store/slices/tickSlice.ts src/lib/chef/bossResultAdapter.ts
git commit -m "feat(hud): emit chef-triggered consumable buff events into tick feed"
```

---

### Task 1.3: Wire tick feed buff events into activeBuffsStore

**Objective:** Subscribe `useActiveBuffsStore` to `BuffEvent`s from the tick feed,
automatically creating `ActiveBuff` rows with correct durations and display states.

**Files:**
- Create: `src/lib/buffs/buffEventSubscriber.ts`
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx` (mount subscriber)

**Step 1: Create buff event subscriber**

Create `src/lib/buffs/buffEventSubscriber.ts`:

```ts
import { useTickFeedStore, type BuffEvent } from '@/store/slices/tickSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { CONSUMABLE_ACTIVATORS, getConsumableDisplayState, getConsumableVisualTtl, type ActiveBuff } from '@/lib/buffs/activeBuffs';
import { CONSUMABLES } from '@/constants/consumables';
import { useEffect, useRef } from 'react';

/**
 * React hook that subscribes to BuffEvents in the tick feed and
 * upserts them into useActiveBuffsStore. Runs a 1s prune interval.
 *
 * Mount once near the top of the app (or in LiveTurfDiorama).
 * Returns a cleanup function suitable for useEffect cleanup.
 */
export function useBuffEventSubscriber() {
  const lastProcessedIndex = useRef(0);

  useEffect(() => {
    const sub = useTickFeedStore.subscribe((state) => {
      const newEvents = state.buffEvents.slice(lastProcessedIndex.current);
      if (newEvents.length === 0) return;
      lastProcessedIndex.current = state.buffEvents.length;

      const store = useActiveBuffsStore.getState();
      for (const event of newEvents) {
        const activator = CONSUMABLE_ACTIVATORS[event.consumableId];
        if (!activator) continue;

        const def = CONSUMABLES[event.consumableId];
        const buff: ActiveBuff = {
          id: `${event.consumableId}:${event.sourceId}:${Date.now()}`,
          consumableId: event.consumableId,
          family: def?.family ?? 'survival',
          source: activator.source,
          sourceId: event.sourceId,
          startedAt: event.startedAt,
          expiresAt: event.startedAt + event.durationMs,
          durationMs: event.durationMs,
          displayState: getConsumableDisplayState(event.consumableId, event.durationMs),
          visualTtlMs: getConsumableVisualTtl(event.consumableId, event.durationMs),
          qualityPercent: event.qualityPercent,
          value: activator.defaultValue,
        };
        store.upsert(buff);
      }
    });

    const cleanup = useActiveBuffsStore.getState().startCleanup(1000);

    return () => {
      sub();
      cleanup();
    };
  }, []);
}
```

**Step 2: Mount subscriber in LiveTurfDiorama**

```tsx
// In LiveTurfDiorama:
import { useBuffEventSubscriber } from '@/lib/buffs/buffEventSubscriber';

// Inside the component:
useBuffEventSubscriber();
```

**Step 3: Add test**

Create `src/lib/buffs/__tests__/buffEventSubscriber.test.ts`:

```ts
// Test that buff events flow from tick feed → activeBuffsStore
// Test that pruneInterval cleans up expired buffs
// Test that upsert replaces existing buffs by id
```

**Step 4: Verify**

Run: `npx vitest run src/lib/buffs/__tests__/`

Expected: All tests pass. New subscriber test confirms the data flow.

**Step 5: Commit**

```bash
git add src/lib/buffs/buffEventSubscriber.ts src/lib/buffs/__tests__/buffEventSubscriber.test.ts src/components/dashboard/LiveTurfDiorama.tsx
git commit -m "feat(hud): wire tick feed buff events into activeBuffsStore via subscriber hook"
```

---

## Phase 2: ConsumableRing → ActiveBuffPills Redesign

> **Gate:** After Phase 2, the consumable display shows **which** buffs are active
> with per-buff countdown timers, instead of a single integer in a circle.
> Empty loaded slots are shown as armed indicators.

### Task 2.1: Create ActiveBuffPills component

**Objective:** Replace the circular ConsumableRing with a horizontal pill strip
that shows one pill per active buff (name, time remaining, visual bar), plus
armed-slot indicators for loaded but not-yet-fired consumables.

**Files:**
- Create: `src/components/stats/ActiveBuffPills.tsx`
- Create: `src/test/ActiveBuffPills.test.tsx`
- Modify: `src/components/stats/ConsumableRing.tsx` (no changes — kept for reference)
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx` (swap ring → pills)

**Step 1: Design the data shape**

Each pill row:

```
┌──────────────────────────────────┐
│ 🔴 Adrenaline Shot       18s ▸   │  ← amber accent + countdown timer
│ ████████████████░░░░░░░░░░░░░░  │  ← time-remaining progress bar
│ DPS +10% · active                 │  ← effect summary
└──────────────────────────────────┘
```

For armed (loaded but unfired):

```
┌──────────────────────────────────┐
│ ⚪ Ammo Pack              ARMED  │  ← muted, no timer
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← full grey bar
│ +5% DPS · pre-fight               │
└──────────────────────────────────┘
```

For empty slots:

```
┌──────────────────────────────────┐
│ ─  Pre-Fight Slot  ─  EMPTY  ─  │  ← ultra-compact, no bar
└──────────────────────────────────┘
```

**Step 2: Write ActiveBuffPills component**

Create `src/components/stats/ActiveBuffPills.tsx`:

```tsx
import React, { memo, useMemo } from 'react';
import { Shield, Zap, Crosshair, PackageOpen } from 'lucide-react';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { CONSUMABLES } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import { getConsumableMechanicKind } from '@/lib/buffs/activeBuffs';

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];
const SLOT_LABEL: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Pre', MidFight: 'Mid', Emergency: 'Emg',
};

const mechanicsIcon: Record<string, React.ElementType> = {
  'survival-repair': Shield,
  'survival-boost': Shield,
  'ammo-coverage': Crosshair,
  'phase-break': Zap,
  'boss-prep': Crosshair,
  'boss-mechanic': Zap,
  'economy-outcome': PackageOpen,
  'activity-start': PackageOpen,
};

// Mirror ConsumableRing accent colors
const accentHex: Record<string, string> = {
  green: '#7CFC00', red: '#FF4B5C', orange: '#FF9000',
  cyan: '#00E5FF', amber: '#FFB300', purple: '#B66BFF', blue: '#5AA7FF',
};

interface BuffPillProps {
  buff: ActiveBuff;
  now: number;
  onClick: () => void;
}

const BuffPill = memo(function BuffPill({ buff, now, onClick }: BuffPillProps) {
  const def = CONSUMABLES[buff.consumableId];
  const remaining = Math.max(0, buff.expiresAt - now);
  const total = Math.max(1, buff.durationMs);
  const ratio = remaining / total;
  const isActive = buff.displayState === 'active';
  const accent = def?.visual.accent ?? 'amber';
  const color = accentHex[accent] ?? '#FFB300';
  const kind = getConsumableMechanicKind(buff.consumableId);
  const Icon = mechanicsIcon[kind] ?? Crosshair;

  const formatTime = (ms: number) => {
    if (ms >= 60_000) return `${Math.ceil(ms / 60_000)}m`;
    if (ms >= 1_000) return `${Math.ceil(ms / 1_000)}s`;
    return '<1s';
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 border-2 border-border bg-bg/90 px-2 py-1.5 text-left"
      style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: color + '40' }}>
          <Icon size={10} style={{ color }} />
        </div>
        <span className="truncate text-[10px] font-black text-text-primary">
          {def?.name ?? buff.consumableId}
        </span>
        {isActive && (
          <span className="shrink-0 text-[9px] font-black text-amber">
            {formatTime(remaining)}
          </span>
        )}
        {!isActive && (
          <span className="shrink-0 text-[9px] font-black text-text-muted">
            ARMED
          </span>
        )}
      </div>
      {/* Time-remaining bar */}
      <div className="h-0.5 w-full overflow-hidden bg-surface">
        <div
          className="h-full transition-all duration-1000"
          style={{
            width: `${isActive ? ratio * 100 : 100}%`,
            backgroundColor: isActive ? color : '#2A2F3A',
          }}
        />
      </div>
      <div className="text-[8px] text-text-muted">
        {buff.displayState === 'recent' ? 'just triggered' : def?.runtime.ledgerText?.slice(0, 40) ?? `${kind}`}
      </div>
    </button>
  );
});

export const ActiveBuffPills = memo(function ActiveBuffPills({
  consumables,
  onClick,
}: {
  consumables: LoadoutConsumables;
  onClick: () => void;
}) {
  const [now, setNow] = React.useState(Date.now);
  const buffs = useActiveBuffsStore((s) => s.buffs);
  const activeBuffs = useMemo(
    () => buffs.filter((b) => b.expiresAt > now),
    [buffs, now],
  );

  // Update "now" every second for countdown timers
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Armed slots: loaded but not currently in activeBuffs
  const armed = SLOT_ORDER
    .map((slot) => ({ slot, id: consumables[slot] }))
    .filter(({ id }) => id != null)
    .filter(({ id }) => !activeBuffs.some((b) => b.consumableId === id));

  if (activeBuffs.length === 0 && armed.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="border-2 border-border bg-bg/80 px-2 py-2 text-[10px] text-text-muted"
        style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}
        aria-label="No consumables loaded. Tap to manage."
      >
        No consumables loaded
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="active-buff-pills">
      {activeBuffs.map((buff) => (
        <BuffPill key={buff.id} buff={buff} now={now} onClick={onClick} />
      ))}
      {armed.map(({ slot, id }) => {
        const def = id ? CONSUMABLES[id as keyof typeof CONSUMABLES] : null;
        return (
          <div
            key={slot}
            className="flex items-center gap-1.5 border-2 border-border bg-bg/60 px-2 py-1"
            style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}
          >
            <span className="text-[8px] font-black text-text-muted">
              {SLOT_LABEL[slot]}
            </span>
            <span className="truncate text-[10px] font-black text-text-muted">
              {def?.name ?? id}
            </span>
            <span className="shrink-0 text-[8px] font-black text-text-muted">
              LOADED
            </span>
          </div>
        );
      })}
    </div>
  );
});
```

**Step 3: Swap ring → pills in LiveTurfDiorama**

In `LiveTurfDiorama.tsx`:

```tsx
// Replace:
// <ConsumableRing consumables={loadout.consumables} activeBuffs={activeBuffs} onClick={() => setLedgerOpen(true)} />

// With:
<ActiveBuffPills consumables={loadout.consumables} onClick={() => setLedgerOpen(true)} />
```

Keep the ledger modal — it remains the expand target for full details.

**Step 4: Add tests**

Create `src/test/ActiveBuffPills.test.tsx`:

```ts
// Test: renders "No consumables loaded" when empty
// Test: renders active buff pills with countdown bar
// Test: renders armed indicators for loaded-but-not-firing slots
// Test: 1s interval updates "now" prop
// Test: onClick fires when a buff pill is tapped
// Test: mechanic icon is correct for each mechanicKind
```

**Step 5: Verify**

Run: `npx vitest run src/test/ActiveBuffPills.test.tsx`

Expected: All new tests pass.

**Step 6: Commit**

```bash
git add src/components/stats/ActiveBuffPills.tsx src/test/ActiveBuffPills.test.tsx src/components/dashboard/LiveTurfDiorama.tsx
git commit -m "feat(hud): replace ConsumableRing with ActiveBuffPills showing per-buff timers"
```

---

## Phase 3: Pull HUD Out of Diorama

> **Gate:** After Phase 3, the diorama is a visualization-only surface. The
> CharacterStatBar and ActiveBuffPills live in the dashboard's main scroll flow,
> giving each element proper vertical space and visual hierarchy.

### Task 3.1: Move CharacterStatBar below diorama

**Objective:** Remove the embedded CharacterStatBar body from inside the diorama
SVG overlay, and mount it as a standalone panel in the dashboard below the diorama.

**Files:**
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx` (remove stat bar from overlay)
- Modify: `src/screens/DashboardScreen.tsx` (mount stat bar below diorama)

**Step 1: Remove stat bar from diorama overlay**

In `LiveTurfDiorama.tsx`, remove the entire `hunter-totals-bar` div (lines ~769-792)
that contains the CharacterStatBarBody button and ConsumableRing/ActiveBuffPills.

Keep the props (`computedStats`, `hunterCurrentHp`, `hunterMaxHp`, `activityKind`,
`overrideActivity`, `setOverrideActivity`, `cycleOverride`) — they'll be exposed
to the DashboardScreen or passed via a different mechanism.

**Step 2: Expose needed props from diorama**

Either:
(a) Lift `overrideActivity` state up to DashboardScreen, or
(b) Keep it in diorama and forward via a render prop / callback

Option (b) is cleaner — keep diorama as the state owner but don't render the
stat bar inside it:

Add to LiveTurfDioramaProps:

```ts
children?: React.ReactNode; // rendered below the SVG, outside the diorama panel
```

Then render `{children}` after the closing `</svg>` but before the closing `</section>`:

```tsx
// After the SVG and overlay divs, before bottom action buttons:
{children}
```

**Step 3: Mount stat bar + pills in DashboardScreen**

In `DashboardScreen.tsx`, after `<LiveTurfDiorama>`:

```tsx
<LiveTurfDiorama area={selectedArea} weapon={equippedWeapon} ...>
  {/* Stat bar and buff pills are children of diorama —
      rendered visually below the SVG but inside the diorama section */}
</LiveTurfDiorama>

{/* Standalone stat bar (replaces the embedded one) */}
<CharacterStatBar
  summary={/* needs to be computed in DashboardScreen or lifted from diorama */}
  currentHp={hunterCurrentHp}
  maxHp={hunterMaxHp}
  activityKind={activity.current.kind}
/>

{/* Active buff pills */}
<ActiveBuffPills
  consumables={loadout.consumables}
  onClick={() => setLedgerOpen(true)}
/>
```

Actually, this is getting complex. The cleaner approach: compute a shared
`computedStats` in DashboardScreen (lift from diorama) and pass it to both.
Let me simplify.

**Revised approach: Lift stat computation to DashboardScreen**

In `DashboardScreen.tsx`, add the stat computation:

```tsx
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

// Inside DashboardScreen:
const hunterCurrentHp = useSurvivalStore((state) => state.currentHp);
const hunterMaxHp = useSurvivalStore((state) => state.maxHp);
const activeBuffRows = useActiveBuffsStore((s) => s.buffs);
const [activeBuffNow] = useState(Date.now);
const activeBuffs = activeBuffRows.filter((b) => b.expiresAt > activeBuffNow);

const computedStats = useMemo(() => buildCharacterStatSummary({
  player,
  weapons: statWeapons, // need to compute this too
  shield: loadout.getShield(),
  classMod: loadout.getClassMod(),
  relic: loadout.getRelic(),
  ordnance: loadout.getOrdnance(),
  spentSkills: skills.getTotalSpent(),
  boss: currentBoss ?? undefined,
  activeBuffs,
}), [player, loadout, skills, currentBoss, activeBuffs]);
```

Pass `statSummary={computedStats}` to LiveTurfDiorama so it doesn't re-compute.

**Step 4: Remove stat bar overlay from diorama**

Delete the `hunter-totals-bar` div from `LiveTurfDiorama.tsx`.
The diorama now contains only: SVG scene, weapon illustration, HP overlays,
loot drops, and bottom action buttons.

**Step 5: Add stat bar + pills to DashboardScreen**

After the diorama in the scroll flow:

```tsx
<LiveTurfDiorama
  area={selectedArea}
  weapon={equippedWeapon}
  statSummary={computedStats}
  /* … other props … */
/>

{/* Hunter Totals — now a standalone panel */}
<Panel label="Hunter Totals">
  <CharacterStatBarBody
    summary={computedStats}
    currentHp={hunterCurrentHp}
    maxHp={hunterMaxHp}
    activityKind={activity.current.kind}
    overrideActivity={overrideActivity}
    onChangeOverride={setOverrideActivity}
    onCycleActivity={cycleOverride}
    onOpenBreakdown={() => setSourceBreakdownOpen(true)}
  />
</Panel>

{/* Active Buffs — now visible in the scroll flow */}
<div className="border-2 border-border bg-surface/95 p-2" style={panelClip}>
  <div className="mb-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">
    Active Buffs
  </div>
  <ActiveBuffPills consumables={loadout.consumables} onClick={() => setLedgerOpen(true)} />
</div>
```

Move the `overrideActivity`, `cycleOverride`, and `ledgerOpen` state to DashboardScreen.

**Step 6: Verify**

Run: `npx vitest run`
Expected: All 711 tests still pass. Update diorama-related test assertions.

**Step 7: Commit**

```bash
git add src/components/dashboard/LiveTurfDiorama.tsx src/screens/DashboardScreen.tsx
git commit -m "refactor(hud): pull CharacterStatBar and ActiveBuffPills out of diorama into dashboard scroll flow"
```

---

### Task 3.2: Simplify diorama overlays

**Objective:** After removing the stat bar and buff pills, clean up remaining
diorama overlays. The diorama should be a combat visualization, not a control surface.

**Files:**
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx`

**Step 1: Remove the body button wrapper**

The `aria-disabled="true"` body button was a placeholder for the
source-breakdown modal. Since we moved the stat bar out, delete it.

**Step 2: Compact the bottom action buttons**

Reduce padding from `px-3 py-2` to `px-2 py-1.5` since there's more
vertical space now in the dashboard.

**Step 3: Verify**

Run: `npx vitest run src/test/LiveTurfDioramaRing.test.tsx`

Expected: Tests pass after updating selectors.

**Step 4: Commit**

```bash
git add src/components/dashboard/LiveTurfDiorama.tsx
git commit -m "refactor(hud): remove disabled body button and compact diorama action buttons"
```

---

## Phase 4: Activity Status + Affordance Polish

> **Gate:** After Phase 4, the dashboard clearly shows what activity is running,
> the activity override has a visible affordance, and the ResourceBar is more legible.

### Task 4.1: Add compact Current Activity indicator

**Objective:** Restore at-a-glance activity status that was lost when the
Current Activity panel was removed. Place it below the ResourceBar as a
compact one-line indicator.

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`

**Step 1: Add ActivityBadge component**

Below the ResourceBar and above the Level Strip:

```tsx
{/* Compact activity status */}
<div className="flex items-center gap-2 border-2 border-border bg-bg/90 px-2 py-1" style={signClip}>
  <div className={`h-2 w-2 rounded-full ${selectedRoamingActive ? 'bg-green animate-pulse' : 'bg-amber'}`} />
  <span className="truncate text-[10px] font-black text-text-primary">
    {activityLabel}
  </span>
  <span className="shrink-0 text-[9px] font-black text-text-muted">
    {activityTarget}
  </span>
  <span className={`shrink-0 text-[8px] font-black uppercase tracking-wider ${selectedRoamingActive ? 'text-green' : 'text-red'}`}>
    {selectedRoamingActive ? 'LIVE' : activity.current.pending ? 'SYNC' : 'IDLE'}
  </span>
</div>
```

**Step 2: Verify**

Build check: `npx tsc --noEmit`
Visual check: Dashboard shows activity name, target, and LIVE/IDLE/SYNC badge.

**Step 3: Commit**

```bash
git add src/screens/DashboardScreen.tsx
git commit -m "feat(hud): add compact activity status indicator below ResourceBar"
```

---

### Task 4.2: Add visual affordance for activity override

**Objective:** Add a chevron or arrow indicator to the "Hunter Totals" header
so players know it's tappable to cycle activities.

**Files:**
- Modify: `src/components/stats/CharacterStatBar.tsx`

**Step 1: Add a cycle icon**

In the `CharacterStatBarBody`, when `showCycle` is true, add a subtle
`ChevronLeftRight` or `RefreshCw` icon next to "Hunter Totals":

```tsx
<button
  type="button"
  data-testid="hud-cycle-activity"
  aria-label="Cycle activity override"
  onClick={...}
  className="cursor-pointer uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-amber focus:outline-none focus-visible:text-amber flex items-center gap-1"
>
  Hunter Totals
  <RefreshCw size={9} className="opacity-40 group-hover:opacity-70" />
</button>
```

**Step 2: Verify**

Run: `npx vitest run src/test/characterStatBarOverride.test.tsx`
Expected: All existing tests pass. The cycle button still works.

**Step 3: Commit**

```bash
git add src/components/stats/CharacterStatBar.tsx
git commit -m "feat(hud): add cycle icon affordance to Hunter Totals header"
```

---

### Task 4.3: Improve ResourceBar legibility

**Objective:** Restore the colored left-edge accent bars that the old HudChips
had, and increase number font size for readability.

**Files:**
- Modify: `src/components/layout/ResourceBar.tsx`

**Step 1: Restore left-edge color bars**

The old HudChips had `<div className=`absolute left-0 top-0 h-full w-1.5 ${color.fill}` />`.
Add this back to the Chip component, deriving the color from the resource's
visualAsset:

```tsx
// In the Chip component, add a left accent bar:
const resourceColors: Record<string, { bar: string }> = {
  credits: { bar: 'bg-cyan' },
  scrap: { bar: 'bg-amber' },
  cacheKey: { bar: 'bg-green' },
  loot: { bar: 'bg-red' },
  level: { bar: 'bg-amber' },
};
const barColor = resourceColors[resourceId]?.bar ?? 'bg-amber';
```

```tsx
<div className={`absolute left-0 top-0 h-full w-1 ${barColor}`} />
```

**Step 2: Increase number size**

Change value text from `text-sm` to `text-base` for the first chip content:

```tsx
<div className="text-base font-black leading-none text-text-primary">{value}</div>
```

**Step 3: Verify**

Build check: `npx tsc --noEmit`
Visual: ResourceBar chips now have colored left bars + larger numbers.

**Step 4: Commit**

```bash
git add src/components/layout/ResourceBar.tsx
git commit -m "fix(hud): restore colored left-edge bars and larger numbers in ResourceBar"
```

---

## Phase 5: Cleanup & Verification

### Task 5.1: Remove dead code from ConsumableRing

**Objective:** The old ConsumableRing component is no longer used after Phase 2.
Mark it as deprecated and remove its test, or keep it for reference.

**Files:**
- Modify: `src/components/stats/ConsumableRing.tsx` (add deprecation comment)
- Archive: `src/test/ConsumableRing.test.tsx`

**Step 1: Add deprecation comment**

```tsx
/**
 * @deprecated Replaced by ActiveBuffPills (Phase 2 dashboard fix, June 2026).
 * Kept for reference during the transition. Remove after next release.
 */
```

**Step 2: Keep test but mark skip**

The test file remains for build pass but tests are `it.skip`ed.

**Step 3: Commit**

```bash
git add src/components/stats/ConsumableRing.tsx src/test/ConsumableRing.test.tsx
git commit -m "refactor(hud): deprecate ConsumableRing in favor of ActiveBuffPills"
```

---

### Task 5.2: Full regression test pass

**Objective:** Ensure all 711+ existing tests pass, tsc is clean, and the
dashboard renders without console errors.

**Files:**
- N/A (test run)

**Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass (may have new tests from this plan; should be ≥711).

**Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: Clean, no errors.

**Step 3: Build check**

```bash
npx vite build
```

Expected: Clean build, no warnings.

**Step 4: Commit final state**

```bash
git add -A
git commit -m "chore(hud): full regression pass — all tests pass, tsc clean"
```

---

## Verification Checklist

- [ ] `useActiveBuffsStore` receives buff events from chef via tick feed
- [ ] Source breakdown modal shows real numbers in the consumable bucket
- [ ] ActiveBuffPills shows per-buff name, time remaining, progress bar
- [ ] Armed (loaded but unfired) slots visible as muted rows
- [ ] Empty slots shown as compact indicators
- [ ] Dashboard has compact activity status (name · target · LIVE/IDLE)
- [ ] CharacterStatBar is a standalone panel, not embedded in diorama
- [ ] ActiveBuffPills is a standalone panel, not embedded in diorama
- [ ] Diorama has no stat bar overlay or disabled button
- [ ] "Hunter Totals" has a cycle icon that indicates tappability
- [ ] ResourceBar chips have colored left bars + larger numbers
- [ ] 711+ tests pass, tsc clean, build clean

## Risk Register

| Risk | Mitigation |
|---|---|
| Chef doesn't emit `consumedConsumables` yet | Phase 1 skips buff events if the field is absent; pills fall back to armed-only display |
| Moving stat bar out breaks diorama layout | Phase 3 makes stat bar a separate panel; diorama height unchanged |
| ActiveBuffPills adds too much vertical height | Each pill is ~40px; with 3 buffs max (+ 3 armed indicators) = ~240px — acceptable below diorama |
| Existing test assertions on `data-consumable-ring` break | Update selectors to `data-active-buff-pills`; keep old test file with skip markers |
