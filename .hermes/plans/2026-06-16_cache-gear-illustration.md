# Add Gear Illustration to Cache Open — CyberCache

> **For Hermes:** Single-file change to ChestScreen.tsx. No extraction, no new files.

**Goal:** When a cache is opened, show the actual gear illustration (weapon/shield/ordnance art) on the revealed item card — not just text stats.

**Problem:** The `GearItemCard` in ChestScreen shows only text (name, rarity badge, level, stats, action buttons). Despite the app having a rich `GearIllustration` component that renders SVG weapon/shield/ordnance art (used in GearHub and MarketScreen), it's never called here. A legendary weapon and a common shield look identical — just colored text.

---

## Task: Add centered `GearIllustration` to `GearItemCard`

**Files:** `src/screens/ChestScreen.tsx`

**Step 1: Add import**

Add after the existing imports (around line 9):

```tsx
import { GearIllustration } from '@/components/gearArt/GearIllustration';
```

**Step 2: Add illustration to the card**

Insert a centered `GearIllustration` between the opening `motion.div` and the name/rarity header. The illustration goes after the motion wrapper opens but before the name row:

```tsx
// Right after line 58 (opening motion.div), before line 61 (name row):
<motion.div
  initial={{ opacity: 0, y: 30 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95 }}
  className="relative rounded-xl p-4 bg-surface border border-border overflow-hidden"
  style={{ borderLeftColor: rarityDef.color, borderLeftWidth: 4 }}
>
  {/* NEW: centered gear illustration */}
  <div className="flex justify-center mb-3">
    <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-bg">
      <GearIllustration item={item} size={72} showBadges={false} />
    </div>
  </div>

  <div className="flex items-center justify-between mb-1">
    ... rest of existing card ...
```

**Full change:**

```diff
+import { GearIllustration } from '@/components/gearArt/GearIllustration';

 const GearItemCard: React.FC<{...}> = ({ item, action, onEquip, onScrap, onLockToggle }) => {
   ...
   return (
     <motion.div ...>
+      <div className="flex justify-center mb-3">
+        <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-bg">
+          <GearIllustration item={item} size={72} showBadges={false} />
+        </div>
+      </div>
       <div className="flex items-center justify-between mb-1">
         ...
```

**Verification:**
1. `cd /data/cybercache && npm run build` — zero TS errors
2. Visual: open a cache, the revealed item card shows the weapon/shield/ordnance art centered above the name
3. All existing actions (Equip, Lock, Recycle) still work
4. Scrapped items still disappear (action === 'scrapped' returns null before rendering)
5. Works for all gear types (weapon, shield, class mod, relic, ordnance) — `GearIllustration` already handles all of them

**Note on the decrypting spinner:** The spinning `Box` icon during the "DECRYPTING CACHE..." phase (lines 293-313) can't show the actual item because the API hasn't returned yet. That stays as-is — a satisfying "mystery box" animation is correct UX for the waiting state.
