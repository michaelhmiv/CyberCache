# Med Kit Visibility — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Med Kit buffer and inventory count visible on the dashboard and fight screen so the player can answer "Am I protected, by how much, and for how long?"

**Architecture:** Three additive patches to existing components — no new files, no new data flows. All data already lives in Zustand stores (`survivalSlice.medKitBuffer`, `playerSlice.consumables`, `activeBuffsSlice`). Each patch adds a small surfacing line to an existing component.

**Tech Stack:** React 19 · TypeScript · Zustand 5 · Tailwind CSS 4

---

## Coverage Audit (Before)

| Data point | Dashboard at-a-glance | Dashboard expand (Ledger) | Fight screen HP strip |
|---|---|---|---|
| MedKit buffer HP | ✓ "150 HP" text in pill | ✗ | ✗ |
| MedKit inventory count | ✗ | ✗ | ✗ |
| MedKit buffer relation to HP | ✗ | ✗ | ✗ |
| Nano Swarm regen | ✓ tick count | ✗ | ✗ |
| Shield HP | ✓ stacked bar | ✓ | ✗ |

## Coverage Audit (After)

| Data point | Dashboard at-a-glance | Dashboard expand (Ledger) | Fight screen HP strip |
|---|---|---|---|
| MedKit buffer HP | ✓ "150 HP · 3×" | ✓ as contribution | ✓ "🛡 150" text |
| MedKit inventory count | ✓ "· 3×" in pill | ✓ "5 in stock" | ✗ (not needed in combat) |
| MedKit buffer relation to HP | ✓ stacked bar segment | ✓ in breakdown | ✓ text near HP |
| Nano Swarm regen | ✓ tick count | ✓ | ✓ "✦ 10/tick" text |
| Shield HP | ✓ stacked bar | ✓ | ✓ text near HP |

---

### Task 1: Pass inventory counts into ActiveBuffPills

**Objective:** ActiveBuffPills receives consumable inventory counts so medkit pills can show "150 HP · 3× left"

**Files:**
- Modify: `src/components/stats/ActiveBuffPills.tsx`
- Modify: `src/screens/DashboardScreen.tsx:391-392` (ActiveBuffPills call site)

**Step 1: Add `inventory` prop to ActiveBuffPills**

In `ActiveBuffPills.tsx`, add to the props interface:

```tsx
export const ActiveBuffPills = memo(function ActiveBuffPills({
  consumables,
  inventory,       // ← NEW
  onClick,
  size: _size,
}: {
  consumables: LoadoutConsumables;
  inventory: Record<string, number>;  // ← NEW
  onClick: () => void;
  size?: number;
}) {
```

**Step 2: Update BuffPill to use the inventory count**

Inside the `BuffPill` memo component, add an `inventoryCount` parameter and modify the display label:

```tsx
const BuffPill = memo(function BuffPill({
  buff,
  now,
  inventoryCount,   // ← NEW
}: {
  buff: ActiveBuff;
  now: number;
  inventoryCount: number;  // ← NEW
}) {
  // ... existing code ...
  const isMedKit = buff.consumableId === 'MedKit' || buff.consumableId === 'MedKitRefined';
  const isBuffer = buff.value && isMedKit;
  // Med Kit: show buffer HP + inventory count instead of timer
  const displayLabel = isBuffer
    ? `${buff.value} HP${inventoryCount > 0 ? ` · ${inventoryCount}×` : ''}`
    : isArmed ? 'ARMED' : remainingLabel;
```

**Step 3: Pass `inventoryCount` to BuffPill call**

In the `activeBuffs.map(...)` section (line 169), pass `inventoryCount`:

```tsx
{activeBuffs.map((buff) => {
  const invCount = inventory[buff.consumableId] ?? 0;
  return <BuffPill key={buff.id} buff={buff} now={now} inventoryCount={invCount} />;
})}
```

**Step 4: Pass inventory from DashboardScreen**

In `DashboardScreen.tsx`, the ActiveBuffPills call site at line 392 needs to pass inventory:

```tsx
<ActiveBuffPills
  consumables={loadout.consumables}
  inventory={player.consumables}
  onClick={() => setLedgerOpen(true)}
/>
```

**Step 5: Verify**

Run: `npx vitest run src/test/ActiveBuffPills.test.tsx`
Expected: tests pass. If no existing test for inventory count, add one.

---

### Task 2: Show inventory stock count in ConsumableLedger

**Objective:** Each loaded slot row in the Ledger modal shows "N in stock"

**Files:**
- Modify: `src/components/stats/ConsumableLedger.tsx`
- Modify: `src/screens/DashboardScreen.tsx:394` (Ledger call site)

**Step 1: Add inventory prop to ConsumableLedger**

```tsx
export const ConsumableLedger: React.FC<{
  consumables: LoadoutConsumables;
  inventory: Record<string, number>;  // ← NEW
  onClose: () => void;
}> = ({ consumables, inventory, onClose }) => {
```

**Step 2: Show stock count per loaded slot**

In the SLOT_ORDER.map section (lines 108-149), after the ledgerText line, add inventory count:

```tsx
{def ? (
  <>
    <div className="truncate text-sm font-black text-text-primary">{def.name}</div>
    <div className="truncate text-[9px] text-text-muted">{def.runtime.ledgerText}</div>
    {/* NEW: inventory stock count */}
    <div className="mt-0.5 text-[8px] font-black uppercase text-amber">
      {(inventory[def.id] ?? 0)} in stock
    </div>
  </>
) : (
  // ... empty slot rendering unchanged
)}
```

**Step 3: Pass inventory from DashboardScreen**

```tsx
{ledgerOpen && <ConsumableLedger consumables={loadout.consumables} inventory={player.consumables} onClose={() => setLedgerOpen(false)} />}
```

**Step 4: Verify**

Run: `npx vitest run src/test/ConsumableLedger.test.tsx`
Expected: tests pass. Update test to assert stock count rendering.

---

### Task 3: Add medkit buffer to health metric stacked bar

**Objective:** The health metric's stacked bar on the dashboard shows medkit buffer as a distinct green segment alongside chassis and shield.

**Files:**
- Modify: `src/lib/stats/characterStats.ts:237-240`

**Step 1: Add survival consumable buffer to stacked segments**

In `buildCharacterStatSummary`, the health metric stacked array currently only has chassis + shield:

```ts
// Current (line 237-240):
metric('health', 'Max HP', totalHealth, whole(totalHealth), 'combat HP: chassis + shield', 'green', healthContribs, [
  { value: baseHealth, display: whole(baseHealth), tone: 'muted', label: 'Chassis' },
  ...(shield ? [{ value: shieldHp, display: whole(shieldHp), tone: 'cyan' as StatTone, label: 'Shield' }] : []),
]),
```

Update to include medkit/nano swarm buffer segments from survival consumables:

```ts
// Build survival consumable stacked segments (MedKit buffer, NanoSwarm)
const survivalStacked = survivalConsumableContribs
  .filter(c => c.value > 0)
  .map(c => ({
    value: c.value,
    display: c.display,
    tone: c.tone,
    label: c.source,
  }));

metric('health', 'Max HP', totalHealth, whole(totalHealth), 'combat HP: chassis + shield + consumables', 'green', healthContribs, [
  { value: baseHealth, display: whole(baseHealth), tone: 'muted', label: 'Chassis' },
  ...(shield ? [{ value: shieldHp, display: whole(shieldHp), tone: 'cyan' as StatTone, label: 'Shield' }] : []),
  ...survivalStacked,
]),
```

**Step 2: Verify**

Run: `npx vitest run src/test/characterStatBreakdownModal.test.tsx`
Expected: tests pass. Visually verify the stacked bar now shows a green segment for medkit buffer.

---

### Task 4: Add medkit buffer + shield text to fight screen HP strip

**Objective:** The compact HP strip on the fight screen shows medkit buffer, shield HP, and nano swarm info alongside current HP.

**Files:**
- Modify: `src/screens/ActionScreenContextual.tsx:777-783`

**Step 1: Read survival consumable state**

The file already imports `useSurvivalStore` and reads `survival.currentHp` and `survival.maxHp`. Add reads for `medKitBuffer`, `shieldHp`, `nanoSwarmTicksRemaining`:

```tsx
const survival = useSurvivalStore();
const { currentHp, maxHp, medKitBuffer, shieldHp, nanoSwarmTicksRemaining } = survival;
```

**Step 2: Update HP display**

Replace the current HP strip (lines 777-783):

```tsx
{/* 3. Compact status strip — HP / Keys / Tick */}
<div className="flex gap-2 text-[10px]">
  <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
    <span className="text-text-muted">HP </span>
    <span className={`font-black ${currentHp < maxHp * 0.3 ? 'text-red' : currentHp < maxHp * 0.6 ? 'text-amber' : 'text-green'}`}>
      {Math.round(currentHp)}/{Math.round(maxHp)}
    </span>
  </div>
```

Update to:

```tsx
{/* 3. Compact status strip — HP (with buffer/shield) / Keys / Tick */}
<div className="flex gap-2 text-[10px]">
  <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
    <span className="text-text-muted">HP </span>
    <span className={`font-black ${currentHp < maxHp * 0.3 ? 'text-red' : currentHp < maxHp * 0.6 ? 'text-amber' : 'text-green'}`}>
      {Math.round(currentHp)}/{Math.round(maxHp)}
    </span>
    {shieldHp > 0 && (
      <span className="ml-1 font-black text-cyan">🛡 {Math.round(shieldHp)}</span>
    )}
    {medKitBuffer > 0 && (
      <span className="ml-1 font-black text-green">✚ {Math.round(medKitBuffer)}</span>
    )}
    {nanoSwarmTicksRemaining > 0 && (
      <span className="ml-1 font-black text-purple">✦ {nanoSwarmTicksRemaining}t</span>
    )}
  </div>
```

**Step 3: Verify**

Run: `npx vitest run src/test/ActionScreenContextual.test.tsx` (if it exists)
Otherwise: Dev server `npm run dev`, equip a Med Kit, start roaming, verify HP strip shows buffer.

---

### Task 5: TypeScript check and full test suite

**Objective:** Ensure no type errors and all existing tests pass.

**Step 1: Type check**

```bash
npx tsc --noEmit
```
Expected: zero errors.

**Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: all existing tests pass.

**Step 3: Fix any test failures**

Check specifically:
- `src/test/ActiveBuffPills.test.tsx` — may need updated props
- `src/test/ConsumableLedger.test.tsx` — may need updated props
- `src/test/characterStatBreakdownModal.test.tsx` — stacked bar segments may have changed

---

### Task 6: Commit

```bash
git add -A
git commit -m "feat: surface Med Kit buffer and inventory count on dashboard and fight screen

- ActiveBuffPills: show inventory count for medkit buffs ('150 HP · 3×')
- ConsumableLedger: show 'N in stock' per loaded consumable slot
- Health metric stacked bar: add survival consumable segment (green)
- Fight screen HP strip: show medkit buffer, shield, nano swarm alongside HP"
```
