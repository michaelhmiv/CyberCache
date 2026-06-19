# Dashboard Consumables Panel Rework

> **For Hermes:** Implement directly — design is locked, no subagent delegation needed.

**Goal:** Replace the dashboard "Active Buffs" panel with a "Consumables" panel that always shows survival stock at a glance, plus the existing armed-slots row and active buff pills.

**Architecture:** The change lives almost entirely in `ActiveBuffPills.tsx` — it already receives `consumables` (loadout) and `inventory` (player stock) as props. Add a new "Survival Stock" section (5 fixed rows for all survival-family consumables) above the existing armed-slots row and active buff pills. Rename the panel label in `DashboardScreen.tsx`.

**Tech Stack:** React 19 · TypeScript · Tailwind CSS 4 · Vitest + React Testing Library

---

## Locked Design Decisions

- **Tier 1 only:** All 5 survival-family consumables always visible with ×N stock. No boss-counter responsiveness.
- **Full density per row:** glyph · name · role · @threshold · ×N stock · EMG tag (if loaded) · one-line effect summary.
- **Panel label:** "Consumables" (renamed from "Active Buffs").
- **Keep armed-slots row:** Pre/Mid/Emg chip row stays as section B, unchanged.
- **Active buff pills:** unchanged (section C, only renders when roaming/fight is live).

## The 5 Survival Consumables

All have `allowedSlots: [Emergency]` — can only go in the Emergency slot.

| ConsumableType | Name | Role | Trigger | Threshold | Base Effect |
|---|---|---|---|---|---|
| `MedKit` | Med Kit | Emergency Heal | hpBelowThreshold | 0.5 (50% HP) | Heal 150 HP |
| `MedKitRefined` | Med Kit (Refined) | Premium Emergency Heal | hpBelowThreshold | 0.5 (50% HP) | Heal 260 HP |
| `ShieldCell` | Shield Cell | Shield Sustain | shieldBelowThreshold | 0.25 (25% Shield) | +120 Shield |
| `NanoSwarm` | Nano Swarm | Attrition Repair | hpBelowThreshold | 0.6 (60% HP) | Repair 300 HP / 30s |
| `AdrenalineShot` | Adrenaline Shot | Last-Stand Save | hpBelowThreshold | 0.2 (20% HP) | Heal 80 + +10% DPS / 20s, −5% rewards |

## Tasks

### Task 1: Create feature branch
```bash
cd /data/cybercache
git checkout master
git pull
git checkout -b feat/dashboard-consumables-panel
```

### Task 2: Add survival stock section to ActiveBuffPills.tsx

**Files:** Modify `src/components/stats/ActiveBuffPills.tsx`

**Changes:**
1. Add `SURVIVAL_IDS` constant — the 5 survival `ConsumableType` values.
2. Add `formatTriggerLabel(def)` helper — renders `@ 50% HP` / `@ 25% Shield` from `def.trigger` + `def.runtime.threshold`.
3. Add `SurvivalStockRow` sub-component — renders one survival row with full density fields. Takes `def`, `stockCount`, `isLoaded` (bool), `isBufferConsumable` (bool). Calls `buildEffectSummary(def, syntheticBuff, false)` for the effect line.
4. Remove the `loadedCount === 0` early-return. Replace with always-render: survival stock section is always present (5 rows minimum), even when nothing is loaded and no buffs are active.
5. Restructure the return: survival stock section → armed-slots row (existing) → active buff pills (existing).

**×0 styling:** Rows with 0 stock get `opacity-50` and the ×N count renders as red text (`text-red`). Non-zero stock renders ×N as amber text (existing accent behavior).

### Task 3: Rename panel label in DashboardScreen.tsx

**Files:** Modify `src/screens/DashboardScreen.tsx` line ~379

Change `<Panel label="Active Buffs">` to `<Panel label="Consumables">`.

### Task 4: Update tests in ActiveBuffPills.test.tsx

**Files:** Modify `src/test/ActiveBuffPills.test.tsx`

**New tests:**
- `renders all 5 survival stock rows always` — verify 5 `[data-testid="survival-stock-row"]` elements render even when nothing is loaded.
- `shows ×N stock count from inventory` — pass `inventory={{ MedKit: 3 }}` and verify "×3" on the Med Kit row.
- `dims ×0 stock rows` — verify 0-stock rows have the dimmed class.
- `shows EMG tag when survival item is loaded into Emergency slot` — pass `consumables={{ PreFight: null, MidFight: null, Emergency: ConsumableType.MedKit }}` and verify the Med Kit row has the EMG tag.
- `existing armed-slots and active-buff tests still pass` — verify no regression.

**Updates to existing tests:**
- The "No consumables loaded" test needs updating — with survival stock always rendered, the component no longer shows an empty state. Adjust or remove this test.
- The "renders armed indicators" test should verify armed-slots-row still appears alongside the survival stock section.

### Task 5: Verify

```bash
npx tsc --noEmit                              # type-check
npx vitest run src/test/ActiveBuffPills.test.tsx  # unit tests
npm run build                                  # production build
```

### Task 6: Commit

```bash
git add src/components/stats/ActiveBuffPills.tsx src/screens/DashboardScreen.tsx src/test/ActiveBuffPills.test.tsx
git commit -m "feat(dashboard): rework Active Buffs panel into Consumables with survival stock"
```

---

## Pitfalls

- **`buildEffectSummary` signature:** Takes `(def, buff, isBufferConsumable)`. For stock rows, pass `isBufferConsumable=false` so MedKit shows "Heal 150 HP" (not "+150 HP buffer"). The synthetic `buff` needs all required `ActiveBuff` fields but `value`/`qualityPercent` can be undefined.
- **`ConsumableType` enum:** Values are PascalCase strings (`MedKit`, not `medKit`). Verify exact casing from `src/types/game.ts`.
- **Early-return removal:** The old `loadedCount === 0` early-return rendered a button. Removing it means the component always renders the survival stock section. The outer `<button onClick={onClick}>` wrapper should still wrap everything for the ledger-open interaction.
- **Threshold rendering:** `def.runtime.threshold` is a fraction (0.5 = 50%). Render as `@ ${Math.round(threshold * 100)}% HP` or `% Shield` based on `def.trigger`.
