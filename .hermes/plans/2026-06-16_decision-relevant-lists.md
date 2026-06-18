# Decision-Relevant List Information — CyberCache

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace identity-only rows and placeholder text in list views with decision-relevant stats, affix previews, and effect summaries — so users can triage items without leaving the list.

**Architecture:** Reuse `gearCardSummary` (already defined in GearHub.tsx) as the shared source of per-item decision stats. Extract it to a shared utility. Replace `itemSubtext` and `GearMiniCard` placeholder text with the same stat-pill pattern. Remove implementation-level hashtags from Consumables/Vendor and replace with styled decision badges.

**Tech Stack:** React 19, TypeScript, Tailwind CSS. No new dependencies.

---

## Principle

For every list, answer: **What decision is the user making, and what numbers/effects do they need to make it?**

- Weapon picker → need DPS, Boss/Farm power, element, roll quality, affix preview
- Shield picker → need HP, mitigation %, recharge rate
- Consumable browser → need tactical role, primary effect, quality band
- Vendor → need counter applicability, cost vs owned
- Market → need item stats to judge value before inspecting

---

## Task Breakdown

### Phase 1: Extract `gearCardSummary` to a shared utility

#### Task 1.1: Move `gearCardSummary` and its dependencies to `src/lib/gear/gearCardSummary.ts`

**Objective:** Make the rich stat computation reusable across GearHub, SlotGearPicker, and MarketScreen.

**Files:**
- Create: `src/lib/gear/gearCardSummary.ts`
- Modify: `src/components/gear/GearHub.tsx` (import from new path, remove local definition)

**What moves:**
- `gearCardSummary()` function (~80 lines)
- `CardStat` interface
- `GearCardSummary` interface
- Helper functions it depends on: `topActivityModule`, `affixValue`, `formatNumber`, `formatPct`, `bestAffixText`, `isWeapon`, `isShield`, `isClassMod`, `isOrdnance`, `isRelic`, `kindOf`, `affixesOf`
- `itemComparable` (used by gearCardSummary indirectly via helpers — check actual call graph)
- `StatPill` component (or keep it local to GearHub and export it too)

**Step 1: Create the file**

```typescript
// src/lib/gear/gearCardSummary.ts
import type { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance, Affix } from '@/types/items';

// ── Type Guards ──
export const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
export const isShield = (item: GearItem): item is Shield => 'hp' in item && !isWeapon(item);
export const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
export const isOrdnance = (item: GearItem): item is Ordnance => 'effect' in item && 'damage' in item && !isWeapon(item);
export const isRelic = (item: GearItem): item is Relic => !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);

// ... rest of the extracted functions
```

**Step 2: Update GearHub imports**

Remove the local definitions and import from `@/lib/gear/gearCardSummary`.

**Step 3: Verify**

Run `npm run build` — no TS errors. GearHub renders unchanged.

---

### Phase 2: SlotGearPicker — Show decision stats per row

#### Task 2.1: Add stat pills to picker rows using `gearCardSummary`

**Objective:** Replace the identity-only `itemSubtext` line with primary stat pills and affix preview, matching the GearHub list row format.

**Files:** `src/components/action/SlotGearPicker.tsx`

**Current row (lines 386-397):**
```tsx
<div className="text-sm font-black text-text-primary truncate">{item.name}</div>
<div className="text-[10px] text-text-muted mt-0.5">{itemSubtext(item)}</div>
{currentItem && <GearCompare current={currentItem} candidate={item} compact />}
```

**Replacement design:**
```tsx
// Import gearCardSummary, StatPill (or inline a mini version)
import { gearCardSummary } from '@/lib/gear/gearCardSummary';

// In the row render:
const summary = gearCardSummary(item);
const accent = RARITY_COLORS[item.rarity] ?? '#A5A7B5';

// Row content:
<div className="min-w-0 flex-1">
  <div className="flex items-center gap-1.5">
    <span className="text-xs font-black truncate" style={{ color: accent }}>{item.name}</span>
    <span className="text-[9px] text-text-muted shrink-0">{item.rarity} · Lv.{item.level}</span>
  </div>

  {/* Primary stats as compact pills — the decision info */}
  <div className="flex flex-wrap gap-1 mt-1">
    {summary.primaryStats.map(stat => (
      <span key={stat.label} className="inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1 py-0.5 text-[9px]">
        <span className="text-text-muted">{stat.label}</span>
        <span className={`font-bold ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
      </span>
    ))}
  </div>

  {/* Best affix preview — one line */}
  {summary.badges[0] && (
    <div className="text-[9px] text-amber mt-0.5 truncate">{summary.badges[0]}</div>
  )}
</div>
```

**Remove:** `itemSubtext` function entirely (lines 70-85) — it's now obsolete.

**Keep:** `GearCompare` when `currentItem` exists (it shows the diff). But render it *after* the candidate's own stats, not instead of them.

**Remove `itemSubtext` usage at line 356** (in the "Currently Equipped" section) — replace with the same stat pill approach for consistency, or keep simpler since it's just the "remove this" reference.

**Step 1: Write the change** — patch SlotGearPicker.tsx

**Step 2: Verify**

Run `npm run build`. Visual: open a loadout slot picker, each row shows DPS/Boss/Farm (weapons), HP/Mit/Rech (shields), DMG/Shield/Armor (ordnance), Tree/Nodes/Boost (class mods), Affix/Idle/Drop (relics).

---

### Phase 3: MarketScreen — Show stats on listing cards

#### Task 3.1: Replace `GearMiniCard` placeholder text with `gearCardSummary` stats

**Objective:** The `GearMiniCard` currently shows literal placeholder text "Inspect full stats / value / market supply" instead of actual item stats. Replace with primary stat pills.

**Files:** `src/screens/MarketScreen.tsx`

**Current `GearMiniCard` (lines 62-79):**
```tsx
function GearMiniCard({ item, right, onInspect }: { item: GearItem; right?: React.ReactNode; onInspect: () => void }) {
  const color = rarityColor(item.rarity);
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onInspect} className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.99]">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-bg">
          <GearIllustration item={item} size={46} showBadges={false} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black" style={{ color }}>{item.name}</div>
          <div className="text-[10px] text-text-muted">{item.rarity} · Lv.{item.level ?? 1} · {itemKind(item)}</div>
          {/* THIS IS THE PROBLEM — placeholder text */}
          <div className="mt-0.5 text-[9px] font-black uppercase tracking-wide text-amber">Inspect full stats / value / market supply</div>
        </div>
      </button>
      {right}
    </div>
  );
}
```

**Replacement:**
```tsx
function GearMiniCard({ item, right, onInspect }: { item: GearItem; right?: React.ReactNode; onInspect: () => void }) {
  const color = rarityColor(item.rarity);
  const summary = gearCardSummary(item);
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onInspect} className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.99]">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-bg">
          <GearIllustration item={item} size={46} showBadges={false} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black" style={{ color }}>{item.name}</div>
          <div className="text-[10px] text-text-muted">{item.rarity} · Lv.{item.level ?? 1} · {itemKind(item)}</div>
          {/* Decision stats — same pill pattern as GearHub */}
          <div className="flex flex-wrap gap-1 mt-1">
            {summary.primaryStats.slice(0, 3).map(stat => (
              <span key={stat.label} className="inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1 py-0.5 text-[9px]">
                <span className="text-text-muted">{stat.label}</span>
                <span className={`font-bold ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
              </span>
            ))}
          </div>
          {summary.badges[0] && (
            <div className="text-[9px] text-amber mt-0.5 truncate">{summary.badges[0]}</div>
          )}
        </div>
      </button>
      {right}
    </div>
  );
}
```

**Import:** Add `import { gearCardSummary } from '@/lib/gear/gearCardSummary';`

**Step 2: Verify**

Run `npm run build`. Visual: Market buy/sell/my-listings tabs show actual stats per item instead of "Inspect full stats..." text.

---

### Phase 4: ConsumablesScreen — Remove hashtags, add decision info

#### Task 4.1: Replace hashtag row with decision-relevant badges

**Objective:** Remove implementation-level hashtags (`layoutChannel`, raw slot IDs like `#consumable_1`) and replace with tactical role, effect summary, and quality band.

**Files:** `src/screens/ConsumablesScreen.tsx`

**Current hashtag row (lines 161-167):**
```tsx
<div className="mt-0.5 flex flex-wrap gap-1">
  <span className="...">{def.runtime.layoutChannel}</span>
  <span className="...">Best {bestQuality.toFixed(0)}% · {getConsumableQualityBand(bestQuality)}</span>
  {def.allowedSlots.map((slot) => (
    <span key={slot} ...>{slot}</span>
  ))}
</div>
```

**Replacement:**
```tsx
<div className="mt-0.5 flex flex-wrap gap-1">
  {/* Tactical role — what it actually does for the player */}
  <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[8px] font-bold text-amber">
    {def.tacticalRole}
  </span>
  {/* Quality band as a compact badge */}
  <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[8px] text-text-muted">
    Q{bestQuality.toFixed(0)}% · {getConsumableQualityBand(bestQuality)}
  </span>
  {/* Equipped indicator if slotted */}
  {def.allowedSlots.some(slot => loadout.consumables[slot] === def.id) && (
    <span className="rounded border border-green/30 bg-green/10 px-1.5 py-0.5 text-[8px] font-bold text-green">
      Equipped
    </span>
  )}
</div>
```

**Also add:** The `shortDescription` is the only effect info visible. Consider making it slightly more prominent or adding the primary effect magnitude if available from the consumable def.

**Step 2: Verify**

Run `npm run build`. Visual: Consumables list shows tactical role, quality, equipped status — no raw implementation IDs.

---

### Phase 5: VendorScreen — Remove hashtag formatting, keep counter info

#### Task 5.1: Replace `#counterTags` with styled counter badges

**Objective:** Counter tags like `#boss`, `#shielded` are actually useful decision info — they tell you what the item is good against. But the `#` prefix is noisy. Style them as proper badges.

**Files:** `src/screens/VendorScreen.tsx`

**Current hashtag row (lines 78-85):**
```tsx
<div className="flex flex-wrap gap-1.5">
  {c.allowedSlots.map((slot) => (
    <span key={slot} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">{slot}</span>
  ))}
  {c.counterTags.map((tag) => (
    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-amber/10 text-amber">#{tag}</span>
  ))}
</div>
```

**Replacement:**
```tsx
<div className="flex flex-wrap gap-1.5">
  {/* Slots as muted pills */}
  {c.allowedSlots.map((slot) => (
    <span key={slot} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted">{slot}</span>
  ))}
  {/* Counter tags as styled amber badges — no # prefix */}
  {c.counterTags.map((tag) => (
    <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded border border-amber/30 bg-amber/10 text-amber font-bold">{tag}</span>
  ))}
</div>
```

**Step 2: Verify**

Run `npm run build`. Visual: Vendor items show counter tags as styled badges, not hashtags. Still clearly indicate what the item counters.

---

## Files Changed Summary

| File | Change | Lines |
|------|--------|-------|
| `src/lib/gear/gearCardSummary.ts` | **NEW** — extract shared stat computation | ~200 lines |
| `src/components/gear/GearHub.tsx` | Import from new path, remove local definitions | ~80 lines removed |
| `src/components/action/SlotGearPicker.tsx` | Replace `itemSubtext` with stat pills + affix preview | ~40 lines changed |
| `src/screens/MarketScreen.tsx` | Replace `GearMiniCard` placeholder with stats | ~15 lines changed |
| `src/screens/ConsumablesScreen.tsx` | Replace hashtag row with decision badges | ~15 lines changed |
| `src/screens/VendorScreen.tsx` | Replace #counterTags with styled badges | ~10 lines changed |

## Files NOT Changed

| File | Reason |
|------|--------|
| `WorkshopScreen.tsx` | Already shows decision-relevant info (materials, quality, time, cost) |
| `LeaderboardList.tsx` / `LeaderboardRow.tsx` | Already compact and decision-relevant (rank, trend, value) |
| `ChestScreen.tsx` | Tiny data sets, not decision lists |
| `DashboardScreen.tsx` | Already functional |
| `ProfileScreen.tsx` | Stats already grids; death log is informational |
| `ActionScreenContextual.tsx` | Boss phases/craft queues are procedural, not decision lists |

---

## Verification

After each phase:
1. `cd /data/cybercache && npm run build` — zero TS errors
2. Visual smoke test:
   - **Slot picker**: Tap an open loadout slot → rows show DPS/HP/etc stats
   - **Market**: Browse buy/sell/my-listings → cards show stats instead of placeholder
   - **Consumables**: Browse items tab → no raw `#consumable_1` tags, shows tactical role
   - **Vendor**: Vendor tab → counter tags are styled badges, not `#hashtags`
3. All interactive elements still work (equip, buy, sell, inspect, claim)

## Risks

- **`gearCardSummary` depends on `topActivityModule` which uses `affixesOf` → `affixes` field.** All gear types have `affixes` in the type definitions; verify at runtime that `GearMiniCard` items (from listings) have the field populated.
- **StatPill component is currently in GearHub.tsx.** Either export it or inline a mini version. The slot picker and market cards use inline `<span>` pills already — no need to extract.
- **`shortDescription` may not be enough for consumable effect information.** The `ConsumableDef` type has `effects` and `triggers` fields — if `shortDescription` doesn't convey the primary effect clearly, we may need to derive a summary from those. Check the actual data after Phase 4.
