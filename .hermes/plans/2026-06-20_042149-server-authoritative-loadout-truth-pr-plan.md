# Server-Authoritative Loadout Truth Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Eliminate every client-side weapon/loadout truth gap so no server-unconfirmed weapon can be rendered, calculated, used to start activity, or labeled as equipped.

**Architecture:** Split the codebase into explicit truth domains: **equipped/loadout truth** comes only from server-synced `useLoadoutStore` slots and resolved inventory rows; **inventory preview/projection** is allowed only when visually and textually labeled as preview. Presentation components must not fabricate weapon visuals in equipped/loadout contexts. Add regression tests and static guard tests so future audits catch fallback leaks.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Supabase RPCs/migrations, existing CyberCache store/RPC architecture.

---

## Current audit summary

This audit searched the repo for these classes of truth leaks:

- Weapon fallback/projection patterns: `bestWeapon`, `bestBossWeapon`, `activityWeapon`, `WeaponIllustration`, `patrol kit`, `fallbackType`, `fallbackMaker`, `fallbackElement`
- Loadout mutation/direct slot reads: `setSlot`, `setSlots`, `useLoadoutStore.setState`, `loadout.slots`, `emptySlots`, `currentItemId`
- Direct inventory weapon reads: `inventory.getWeapons()`, `useInventoryStore.getState().getWeapons()`, `getWeapons()`
- Local/hydration/fallback authority patterns: `localStorage`, `fallback`, `display_hydration_only`, `restoreRuntimeStoresFromSupabase`, `saveCurrentRuntimeStores`, `authoritative`
- Server authority/RPC patterns: `cc_equip_item`, `cc_unequip_slot`, `cc_loadout_snapshot`, `cc_item_accepts_slot`, `serverItemRowToDisplayGear`, `syncRuntimeItemsForUser`, `syncVerifiedResult`
- Activity/combat weapon usage: `buildRoamingLootActivity`, `buildBossFightActivity`, `computeFightPower`, `computeLoadoutDps`, `loadoutEffectiveDps`, `getWeapon(`

### Confirmed remaining gaps

| Severity | File | Lines / symbols | Finding | Required behavior |
|---|---|---:|---|---|
| Critical | `src/components/dashboard/LiveTurfDiorama.tsx` | `fallbackMaker`, `fallbackType`, `fallbackElement`, `weaponLabel`, line ~716 `WeaponIllustration weapon={weapon}` | Dashboard renders a fallback weapon illustration and “patrol kit” label when `weapon` is undefined. | Equipped/loadout context must render unarmed/no-weapon visual and label when no server-equipped weapon exists. |
| Critical | `src/screens/ActionScreenContextual.tsx` | ~358-359, ~426, ~433, ~440, ~708 | `activityWeapon` falls back to `bestBossWeapon`, then starts roaming/boss activities and renders the diorama with that fallback. | Actual activity inputs must use equipped weapon only; inventory-best can exist only as preview. |
| Critical | `src/components/fight/BossPrepModal.tsx` | ~245-255, ~287-303, ~328 | Primary/secondary/heavy are filled from inventory when loadout slots are empty, then used in simulation and boss prep activity. | Boss prep simulation/activity must separate equipped loadout from preview candidates. Empty loadout means no equipped weapon. |
| Major | `src/lib/stats/fightPower.ts` | ~30-47 | `computeFightPower` includes fallback chain `equipped weapons → bestInventoryWeapon → 0`. | Rename/split into explicit `computeEquippedFightPower` and `computePreviewFightPower` or remove fallback from equipped contexts. |
| Major | `src/components/fight/BossSelectModal.tsx` | ~21-42, ~129-131 | Computes “Your best vs …” from inventory first, then loadout. This is acceptable only as clearly labeled preview. Current comments claim it matches diorama. | Label as preview and never imply equipped/diorama truth. |
| Major | `src/components/weapon/WeaponIllustration.tsx` | ~395-408 | Component-level fallback generates a weapon when `weapon` is undefined. Fine for design previews; unsafe in equipped contexts. | Add `allowFallbackSpec?: boolean` or `mode`, default false for truth-sensitive use, and/or require explicit fallback props. |
| Major | `src/screens/DashboardScreen.test.tsx` | helper returns `bestWeapon`; test asserts best weapon exists while equipped is undefined | Test keeps old fallback concept alive even though dashboard no longer uses it. | Replace with tests asserting empty loadout renders no equipped weapon and no fallback weapon visual. |
| Major | `src/test/characterStatsDiorama.test.ts` | lines ~104-109 | Test comments encode “animation was using a fallback weapon” as a prior accepted state. | Add/replace regression with no-fallback equipped context test. |
| Medium | `src/components/profile/WorldPulseFeed.tsx` | `strongestWeapon = inventory.getWeapons().sort(...)` | Profile/social feed uses strongest inventory weapon. Likely OK as profile stat, but must label as inventory/owned, not equipped. | Audit label; no code change if label is truthful. |
| Medium | `src/screens/ProfileScreen.tsx` | `const weapons = inventory.getWeapons()` | Profile inventory count. Likely OK. | Ensure no equipped wording. |
| Medium | `src/components/gear/GearHub.tsx` | equip via `verifiedOps.equipItem`, direct `loadout.slots` for first empty | Server-verified equip path is OK. It should surface server errors inline rather than console-only. | Add user-visible error if equip rejected, but keep as secondary after truth fixes. |
| Medium | `src/screens/ChestScreen.tsx` | `handleEquip` uses `loadout.slots` to choose first empty and calls RPC | Server-verified path is OK. It sets local action state to `equipped` after RPC. | Ensure `syncVerifiedResult` has applied server snapshot before showing “equipped”; add error guard if RPC rejects. |

### Already-good / do not rewrite unless tests expose gaps

| File | Why it is OK |
|---|---|
| `src/lib/supabase/runtimeStateService.ts` | Filters `salvaged`, `consumed`, `listed`, maps server rows, and resets loadout slots from server rows. |
| `src/lib/supabase/verifiedStateSync.ts` | Applies server result items and final `loadout` snapshot last. |
| `src/lib/supabase/serverItemAdapter.ts` | Hides odds-only/unrecognizable payloads instead of fabricating default weapons. |
| `supabase/migrations/20260620000000_loadout_truth_cache_weapons.sql` | Production migration makes cache draws real weapon payloads and tightens slot acceptance. |
| `src/screens/DashboardScreen.tsx` | Uses `loadout.getWeapon(...)` only for dashboard equipped weapon and stat weapons. The bug is downstream visual fallback. |
| `src/lib/combat/loadoutSurvival.ts` | Computes DPS from loadout slots only. |

---

## Non-negotiable invariant

Add this invariant to tests and implementation comments:

> If the server-synced loadout does not confirm a weapon in `primary`, `secondary`, or `heavy`, the client must not render, calculate, start activity with, label, or persist any weapon as equipped. Inventory-based projections are allowed only when explicitly labeled as previews and must not feed equipped/activity truth.

---

## Implementation phases

### Phase 1: Add truth helpers and regression tests first

#### Task 1.1: Create equipped weapon selector helpers

**Objective:** Provide one obvious way to retrieve equipped weapons so components stop rebuilding fallback chains by hand.

**Files:**
- Create: `src/lib/loadout/equippedWeaponTruth.ts`
- Test: `src/lib/loadout/equippedWeaponTruth.test.ts`

**Step 1: Write failing tests**

Create `src/lib/loadout/equippedWeaponTruth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Weapon } from '@/types/items';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { selectEquippedWeapons, selectPrimaryEquippedWeapon } from './equippedWeaponTruth';

const makeWeapon = (id: string): Weapon => ({
  id,
  name: id,
  level: 1,
  rarity: Rarity.Common,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0,
  critDamage: 1,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  rollQuality: 50,
  combatPower: 10,
  bossPower: 10,
  farmPower: 10,
  economyScore: 0,
  parts: [],
  affixes: [],
  sourceTag: 'test',
});

describe('equipped weapon truth helpers', () => {
  it('returns no weapons when every loadout getter is undefined', () => {
    const weapons = selectEquippedWeapons({
      getWeapon: () => undefined,
    });
    expect(weapons).toEqual([]);
    expect(selectPrimaryEquippedWeapon({ getWeapon: () => undefined })).toBeUndefined();
  });

  it('returns only loadout getter weapons and preserves slot priority', () => {
    const primary = makeWeapon('primary');
    const heavy = makeWeapon('heavy');
    const weapons = selectEquippedWeapons({
      getWeapon: (slot) => slot === 'primary' ? primary : slot === 'heavy' ? heavy : undefined,
    });
    expect(weapons.map((w) => w.id)).toEqual(['primary', 'heavy']);
    expect(selectPrimaryEquippedWeapon({ getWeapon: (slot) => slot === 'heavy' ? heavy : undefined })?.id).toBe('heavy');
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npx vitest run src/lib/loadout/equippedWeaponTruth.test.ts
```

Expected: FAIL because `equippedWeaponTruth.ts` does not exist.

**Step 3: Implement helper**

Create `src/lib/loadout/equippedWeaponTruth.ts`:

```ts
import type { Weapon } from '@/types/items';

export type WeaponLoadoutReader = {
  getWeapon: (slot: 'primary' | 'secondary' | 'heavy') => Weapon | undefined;
};

const WEAPON_SLOT_ORDER = ['primary', 'secondary', 'heavy'] as const;

export function selectEquippedWeapons(loadout: WeaponLoadoutReader): Weapon[] {
  return WEAPON_SLOT_ORDER
    .map((slot) => loadout.getWeapon(slot))
    .filter((weapon): weapon is Weapon => !!weapon);
}

export function selectPrimaryEquippedWeapon(loadout: WeaponLoadoutReader): Weapon | undefined {
  return selectEquippedWeapons(loadout)[0];
}
```

**Step 4: Run test to verify pass**

```bash
npx vitest run src/lib/loadout/equippedWeaponTruth.test.ts
```

Expected: PASS.

---

#### Task 1.2: Add static guard for forbidden fallback chains in equipped contexts

**Objective:** Catch future `?? bestWeapon` / inventory fallback leakage before it ships.

**Files:**
- Create: `src/test/serverAuthoritativeLoadoutInvariant.test.ts`

**Step 1: Write failing/static guard tests**

Create `src/test/serverAuthoritativeLoadoutInvariant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('server-authoritative loadout invariant', () => {
  it('ActionScreenContextual does not feed best inventory weapon into activity truth', () => {
    const source = read('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toMatch(/activityWeapon[\s\S]{0,240}best[A-Za-z]*Weapon/);
    expect(source).not.toMatch(/buildRoamingLootActivity\([^\n]*best[A-Za-z]*Weapon/);
    expect(source).not.toMatch(/buildBossFightActivity\([^\n]*best[A-Za-z]*Weapon/);
  });

  it('BossPrepModal does not fill equipped slots from inventory fallback', () => {
    const source = read('src/components/fight/BossPrepModal.tsx');
    expect(source).not.toMatch(/loadout\.getWeapon\('[^']+'\)\s*\|\|\s*inventory\.getWeapons/);
  });

  it('LiveTurfDiorama does not render a fallback weapon when weapon is absent', () => {
    const source = read('src/components/dashboard/LiveTurfDiorama.tsx');
    expect(source).not.toContain('patrol kit');
    expect(source).not.toMatch(/WeaponIllustration[\s\S]{0,240}weapon=\{weapon\}[\s\S]{0,240}fallback/);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npx vitest run src/test/serverAuthoritativeLoadoutInvariant.test.ts
```

Expected: FAIL on current code. This is the regression shield.

---

### Phase 2: Fix dashboard visual truth

#### Task 2.1: Make `WeaponIllustration` fallback opt-in

**Objective:** Prevent accidental fake weapons from rendering when a caller passes `weapon={undefined}`.

**Files:**
- Modify: `src/components/weapon/WeaponIllustration.tsx`
- Test: `src/components/weapon/WeaponIllustration.test.tsx` or existing nearest test file if one exists

**Implementation approach:**

Add prop:

```ts
  allowFallbackSpec?: boolean;
```

Update component signature:

```ts
export const WeaponIllustration: React.FC<WeaponIllustrationProps> = ({
  weapon,
  type,
  manufacturer,
  element,
  rarity,
  visualSeed,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
  allowFallbackSpec = false,
}) => {
  const sizing = toSize(size);
  if (!weapon && !allowFallbackSpec) return null;
  const spec = weapon ? buildWeaponVisualSpec(weapon) : fallbackSpec({ type, manufacturer, element, rarity, visualSeed });
  // existing render continues
```

**Important:** Update intentional design-preview callers to pass `allowFallbackSpec`. Search all `WeaponIllustration` calls after this change.

Expected likely intentional fallback callers:
- `src/components/pixelArt/WeaponCanvas.tsx` if it is a design/demo canvas
- `src/components/dashboard/LiveTurfDiorama.tsx` should **not** pass it in equipped context

**Verification:**

```bash
npx vitest run src/test/serverAuthoritativeLoadoutInvariant.test.ts
npx tsc --noEmit
```

---

#### Task 2.2: Render unarmed dashboard state in `LiveTurfDiorama`

**Objective:** When `weapon` is undefined, the dashboard must visually and textually show no equipped weapon.

**Files:**
- Modify: `src/components/dashboard/LiveTurfDiorama.tsx`
- Test: add focused test under `src/test/liveTurfDioramaLoadoutTruth.test.tsx` or extend existing dashboard/diorama tests

**Implementation requirements:**

1. Remove equipped-context use of:
   - `fallbackMaker`
   - `fallbackType`
   - `fallbackElement`
   - `patrol kit`
2. Use neutral projectile only for non-weapon scene decoration if needed, but do not render a weapon illustration.
3. Replace weapon label:

```ts
const weaponLabel = weapon
  ? `${weapon.rarity} ${weapon.element} ${weapon.weaponType}`
  : 'No weapon equipped';
```

4. Replace line ~716 with conditional render:

```tsx
{weapon ? (
  <motion.div
    className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6"
    key={`weapon-${weapon.id}`}
    animate={eventActive && !reduced ? { x: [-2, 3, 0], y: [0, -2, 0] } : undefined}
    transition={eventActive && !reduced ? { duration: 0.44 } : undefined}
  >
    <WeaponIllustration weapon={weapon} size={106} showBadges={false} animate={false} />
  </motion.div>
) : (
  <div
    className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6 border-2 border-border bg-bg/80 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-text-muted"
    data-testid="diorama-unarmed-state"
  >
    Unarmed
  </div>
)}
```

The exact visual can be adjusted, but it must have a testable marker and must not render `WeaponIllustration` fallback.

**Test acceptance:**

- With `weapon={undefined}`, rendered output includes `No weapon equipped` or `diorama-unarmed-state`.
- With real weapon, rendered output includes the weapon label and no unarmed marker.

**Verification:**

```bash
npx vitest run src/test/liveTurfDioramaLoadoutTruth.test.tsx src/test/serverAuthoritativeLoadoutInvariant.test.ts
```

---

### Phase 3: Fix activity/boss equipped truth

#### Task 3.1: Replace `ActionScreenContextual.activityWeapon` with equipped-only selection

**Objective:** Activities started from the Action screen must use equipped loadout weapon only, never best inventory fallback.

**Files:**
- Modify: `src/screens/ActionScreenContextual.tsx`
- Test: add/extend `src/test/activeRoamingArchitecture.test.ts` or create `src/test/actionScreenLoadoutTruth.test.tsx`

**Implementation:**

Import helper:

```ts
import { selectPrimaryEquippedWeapon, selectEquippedWeapons } from '@/lib/loadout/equippedWeaponTruth';
```

Replace:

```ts
const bestBossWeapon = useMemo(() => inventory.getWeapons().sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
```

with:

```ts
const equippedWeapons = useMemo(() => selectEquippedWeapons(loadoutStore), [loadoutStore]);
const activityWeapon = equippedWeapons[0];
const bestBossPreviewWeapon = useMemo(() => [...inventory.getWeapons()].sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
```

Then update `computeFightPower` call per Task 3.2.

**Acceptance:**

- `buildRoamingLootActivity` receives `activityWeapon`, which is equipped-only.
- `buildBossFightActivity` receives `activityWeapon`, which is equipped-only.
- Any use of `bestBossPreviewWeapon` is only displayed as preview, not passed to activity builders.

---

#### Task 3.2: Split fight power into equipped vs preview helpers

**Objective:** Make fallback semantics impossible to confuse by naming.

**Files:**
- Modify: `src/lib/stats/fightPower.ts`
- Modify tests: `src/test/fightPower.test.ts`

**Implementation:**

Replace/augment exports:

```ts
export function computeEquippedFightPower(
  equippedWeapons: Array<Weapon | undefined>,
  currentBoss: BossDef | null | undefined,
): number {
  const equipped = equippedWeapons.filter((weapon): weapon is Weapon => !!weapon);
  if (equipped.length === 0) return 0;
  if (currentBoss) {
    return Math.round(computeLoadoutDps(equipped, currentBoss.weaknesses, currentBoss.resistances));
  }
  return Math.round(equipped.reduce((sum, weapon) => sum + computeStandardDps(weapon), 0));
}

export function computePreviewFightPower(
  previewWeapon: Weapon | undefined,
  currentBoss: BossDef | null | undefined,
): number {
  if (!previewWeapon) return 0;
  if (currentBoss) {
    return Math.round(computeLoadoutDps([previewWeapon], currentBoss.weaknesses, currentBoss.resistances));
  }
  return Math.round(computeStandardDps(previewWeapon));
}
```

Keep `computeFightPower` temporarily as deprecated only if needed for compatibility, but remove all production callers. Tests should move to explicit helpers.

**Test changes:**

- `computeEquippedFightPower([], boss)` returns `0` even if inventory weapon exists elsewhere.
- `computePreviewFightPower(bestInventoryWeapon, boss)` returns projection.
- Remove/replace test named “fallback is only used when loadout is empty” because that behavior is no longer valid for equipped truth.

---

#### Task 3.3: Fix `BossPrepModal` slot fallbacks and simulation truth

**Objective:** Boss prep modal must simulate actual equipped loadout, not auto-fill empty slots from inventory.

**Files:**
- Modify: `src/components/fight/BossPrepModal.tsx`
- Test: create/extend `src/test/bossPrepLoadoutTruth.test.tsx`

**Implementation:**

Replace:

```ts
const primary = loadout.getWeapon('primary') || inventory.getWeapons()[0] || null;
const secondary = loadout.getWeapon('secondary') || inventory.getWeapons()[1] || null;
const heavy = loadout.getWeapon('heavy') || inventory.getWeapons().find((w) => w.weaponType === 'Launcher') || null;
```

with:

```ts
const primary = loadout.getWeapon('primary') ?? null;
const secondary = loadout.getWeapon('secondary') ?? null;
const heavy = loadout.getWeapon('heavy') ?? null;
const previewWeapons = useMemo(() => inventory.getWeapons(), [inventory]);
```

Only use `previewWeapons` in clearly labeled recommendation UI, not `simulateBoss`, not `buildBossFightActivity`, and not `activityWeapon`.

**Acceptance:**

- Empty loadout sim has 0 weapon DPS.
- Boss prep activity starts with `weapon: undefined` if no weapon equipped.
- UI may show “Best owned preview” separately, but it must not affect `sim` or `activityWeapon`.

---

#### Task 3.4: Clarify `BossSelectModal` projection labels

**Objective:** Keep useful projection while preventing “equipped” confusion.

**Files:**
- Modify: `src/components/fight/BossSelectModal.tsx`
- Test: add/extend nearest BossSelectModal test if one exists; otherwise static guard in `serverAuthoritativeLoadoutInvariant.test.ts`

**Implementation:**

- Rename `bestWeapon` to `bestInventoryPreviewWeapon`.
- Label chip as `Best owned preview vs X`, not `Your best vs X` if that can be read as active/equipped.
- Remove comment that says it matches the diorama.
- Prefer loadout-equipped value as primary display if present, with preview second:
  - `Equipped vs X: 0 DPS` when no equipped weapon
  - `Best owned preview: N DPS` if inventory weapon exists

**Acceptance:**

- No comments imply inventory preview is dashboard/diorama truth.
- Projection remains useful but clearly separate.

---

### Phase 4: Tighten equip UX around server rejection

#### Task 4.1: Surface verified equip failures in `GearHub`

**Objective:** If the server rejects equip, user sees why instead of silent console warning.

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

**Implementation:**

- Add local `equipError` state.
- Use `formatRpcError` from `src/lib/supabase/rpcError.ts`.
- Render an inline error banner near inspect/equip controls.
- Keep server RPC as the only mutation path.

**Acceptance:**

- RPC failure does not set local equipped UI state.
- User sees server error message.

---

#### Task 4.2: Tighten `ChestScreen` equip action state

**Objective:** Do not mark a cache item as “equipped” unless server RPC succeeds and sync applies.

**Files:**
- Modify: `src/screens/ChestScreen.tsx`

**Implementation:**

Current code already awaits `verifiedOps.equipItem`; keep that. Add try/catch around per-item equip action and show `formatRpcError` if rejected. Consider action state value `equip_failed` if the card has per-item action labels.

**Acceptance:**

- Failed equip shows error.
- Successful equip still waits for RPC.

---

### Phase 5: Static audit hardening

#### Task 5.1: Expand static invariant tests to cover all production fallback sites

**Objective:** Make the audit repeatable and enforceable.

**Files:**
- Modify: `src/test/serverAuthoritativeLoadoutInvariant.test.ts`

**Add checks:**

```ts
it('production code has no equipped-context inventory weapon fallbacks', () => {
  const action = read('src/screens/ActionScreenContextual.tsx');
  const prep = read('src/components/fight/BossPrepModal.tsx');
  expect(action).not.toMatch(/\?\?\s*best[A-Za-z]*Weapon/);
  expect(prep).not.toMatch(/\|\|\s*inventory\.getWeapons/);
});

it('WeaponIllustration fallback is opt-in only', () => {
  const source = read('src/components/weapon/WeaponIllustration.tsx');
  expect(source).toContain('allowFallbackSpec');
  expect(source).toMatch(/if \(!weapon && !allowFallbackSpec\) return null/);
});
```

**Acceptance:**

- These tests fail if someone reintroduces automatic fallback weapon rendering or activity fallback.

---

## Full validation gate

Run after implementation:

```bash
npm test -- --run \
  src/lib/loadout/equippedWeaponTruth.test.ts \
  src/test/serverAuthoritativeLoadoutInvariant.test.ts \
  src/test/liveTurfDioramaLoadoutTruth.test.tsx \
  src/test/fightPower.test.ts \
  src/test/activeRoamingArchitecture.test.ts \
  src/test/loadoutConsistencySmoke.test.ts \
  src/test/verifiedStateSyncLoadout.test.ts \
  src/lib/supabase/serverItemAdapter.test.ts \
  src/lib/supabase/runtimeStateService.test.ts

npx tsc --noEmit
npm run lint
npm run build
```

If a browser/dev-server verification is in scope after code changes, also verify manually:

1. Sign in as account with empty server loadout.
2. Dashboard shows `Equipped: None` and no weapon illustration / only unarmed state.
3. Action screen does not render a fallback gun in the diorama.
4. Boss prep with empty loadout shows 0 equipped weapon contribution; any best-owned projection is separate and labeled preview.
5. Attempting to equip invalid/stale item shows server error and does not visually stick.

---

## PR strategy

Recommended branch:

```bash
git checkout master
git pull --ff-only origin master
git checkout -b fix/server-authoritative-loadout-truth
```

Recommended commits:

1. `test: add server-authoritative loadout invariant guards`
2. `fix: stop dashboard weapon fallback rendering`
3. `fix: separate equipped and preview weapon power`
4. `fix: remove activity weapon inventory fallbacks`
5. `fix: surface server equip rejection errors`
6. `test: expand loadout truth regression coverage`

Recommended PR title:

```text
fix: enforce server-authoritative weapon/loadout truth across UI
```

Recommended PR body summary:

```markdown
## Summary
- Removes fallback weapon rendering from dashboard/action equipped contexts
- Splits equipped weapon truth from best-inventory preview/projection
- Prevents activity builders and boss prep simulation from using inventory fallback weapons
- Adds invariant tests so future audits catch fallback leaks
- Surfaces verified equip RPC errors instead of silently reverting

## Test Plan
- [ ] npm test -- --run src/test/serverAuthoritativeLoadoutInvariant.test.ts ...
- [ ] npx tsc --noEmit
- [ ] npm run lint
- [ ] npm run build
- [ ] Manual empty-loadout dashboard/action verification
```

---

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| Some existing UI depended on fallback visuals to avoid empty-looking cards. | Replace with explicit unarmed/no-equipped state rather than blank space. |
| Boss prep may look weaker because it stops auto-filling inventory weapons. | Add separate `Best owned preview` copy if needed, but do not feed it into sim/activity truth. |
| `WeaponIllustration` fallback opt-in can break design/demo callers. | TypeScript errors and visual tests will identify callers that need `allowFallbackSpec`. |
| Static guard regex can be brittle. | Keep guards simple and pair with behavioral tests. |
| Existing tests may encode old fallback behavior. | Update tests to distinguish equipped truth vs preview. |

---

## Done criteria

The PR is done only when all are true:

- [ ] Empty server loadout renders no weapon visual in dashboard/action equipped contexts.
- [ ] Empty server loadout produces 0 equipped weapon DPS/power in equipped contexts.
- [ ] Activity builders receive only equipped loadout weapon, never best inventory fallback.
- [ ] Boss prep simulation uses only equipped weapons.
- [ ] Inventory-best projections, if retained, are visibly labeled preview.
- [ ] Invalid/stale equip attempts surface server errors.
- [ ] Static invariant tests fail on reintroduced fallback chains.
- [ ] Full test/type/lint/build gate passes.
