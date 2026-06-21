# CyberCache Loadout Consistency Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan task-by-task. Do not auto-merge; stop after each phase for user review.

**Goal:** Make the frontend’s loadout/inventory display match the backend’s authoritative state, fix cache draws so they produce real weapons, and align client slot-compatibility rules with the server.

**Architecture:** Treat `item_instances` as the single source of truth for gear existence, type, equipped slot, and runtime state. Stop synthesizing fallback items in the adapter and stop substituting best-inventory weapons for actually-equipped weapons on the dashboard. Cache draws move from placeholder `{odds}` rows to real server-generated weapon payloads.

**Tech Stack:** TypeScript/React/Zustand frontend, Supabase (Postgres + RPC) backend, Vitest for tests.

---

## Phase 1: Stop the frontend from lying (no DB changes)

### Task 1: Make `serverItemAdapter` refuse to fabricate items

**Objective:** When a row has no recognizable gear-type payload, return `null` instead of inventing a generic Pistol.

**Files:**
- Modify: `src/lib/supabase/serverItemAdapter.ts`
- Modify: `src/lib/supabase/runtimeStateService.ts`
- Modify: `src/lib/supabase/verifiedStateSync.ts`
- Modify: `src/screens/ChestScreen.tsx`
- Modify: `src/screens/ActionScreenContextual.tsx`
- Create test: `src/lib/supabase/serverItemAdapter.test.ts`

**Step 1: Write failing test**

Create `src/lib/supabase/serverItemAdapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from './serverItemAdapter';

describe('serverItemRowToDisplayGear', () => {
  it('returns null for an odds-only cache placeholder', () => {
    const row = {
      id: 'item-1',
      item_level: 5,
      rarity: 'Rare',
      payload: { odds: { outcome: 'Rare' } },
    } as const;
    expect(serverItemRowToDisplayGear(row)).toBeNull();
  });

  it('returns a weapon when the payload has weaponType', () => {
    const row = {
      id: 'item-2',
      item_level: 5,
      rarity: 'Rare',
      payload: {
        id: 'item-2',
        name: 'Test SMG',
        level: 5,
        rarity: 'Rare',
        weaponType: 'SMG',
        manufacturer: 'HelixWorks',
        element: 'Kinetic',
        baseDamage: 50,
        attackSpeed: 2,
        critChance: 0.08,
        critDamage: 1.4,
        statusChance: 0.12,
        statusDamage: 1.1,
        bossDamageMod: 0.95,
        waveDamageMod: 1.15,
        shieldDamageMod: 1.05,
        armorDamageMod: 0.9,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        combatPower: 100,
        bossPower: 100,
        farmPower: 100,
        economyScore: 0,
        sourceTag: 'Cache-Forged',
        parts: [],
        affixes: [],
        pixelSeed: 123,
      },
    };
    const result = serverItemRowToDisplayGear(row);
    expect(result).not.toBeNull();
    expect(result && 'weaponType' in result ? result.weaponType : null).toBe('SMG');
  });
});
```

Run: `npx vitest run src/lib/supabase/serverItemAdapter.test.ts`  
Expected: FAIL — current function returns a fabricated weapon for the odds-only row.

**Step 2: Change the return type and fallback behavior**

In `src/lib/supabase/serverItemAdapter.ts`:

```ts
// Change function signature line ~37
export function serverItemRowToDisplayGear(row: ServerItemRow): GearItem | null {
```

Replace the fallback block (lines 108-145) with:

```ts
  console.warn('[serverItemAdapter] Unrecognizable item payload for row', row.id, '— hiding item until payload is repaired.');
  return null;
}
```

**Step 3: Filter out nulls in sync consumers**

In `src/lib/supabase/runtimeStateService.ts`, change line 28:

```ts
  const serverItems = rows.map(serverItemRowToDisplayGear).filter((item): item is GearItem => item !== null);
```

Add the import for `GearItem` at the top:

```ts
import type { GearItem } from '../../types/items';
```

In `src/lib/supabase/verifiedStateSync.ts`, change `syncRuntimeItem` lines 174-191:

```ts
function syncRuntimeItem(row: ServerItemRow | undefined): void {
  if (!row?.id) return;
  if (row.runtime_state === 'salvaged' || row.runtime_state === 'consumed' || row.runtime_state === 'listed') {
    useInventoryStore.getState().removeItem(row.id);
    clearItemFromLoadout(row.id);
    return;
  }

  const item = serverItemRowToDisplayGear(row);
  if (!item) {
    useInventoryStore.getState().removeItem(row.id);
    clearItemFromLoadout(row.id);
    return;
  }

  useInventoryStore.getState().upsertItem(item);
  const slot = toLoadoutSlot(row.equipped_slot);
  if (slot) {
    clearItemFromLoadout(row.id);
    useLoadoutStore.getState().setSlot(slot, row.id);
    return;
  }

  clearItemFromLoadout(row.id);
}
```

**Step 4: Handle null in cache-open screens**

In `src/screens/ActionScreenContextual.tsx`, inside `openCache`, after `const item = serverItemRowToDisplayGear(...)`:

```ts
      if (!item) {
        const msg = 'Cache produced an unrecognizable item. The roll has been recorded; please contact support.';
        setCacheError(msg);
        pushEvents([makeRunEvent('CACHE FAILED', msg, 'cache', 'cache_corrupt')]);
        return;
      }
```

In `src/screens/ChestScreen.tsx`, inside `handleOpen`, after `const item = serverItemRowToDisplayGear(...)`:

```ts
      if (!item) {
        setError('Cache produced an unrecognizable item.');
        return;
      }
```

Make `setRevealed` only accept non-null: the type will narrow if you check `item` first.

**Step 5: Run tests**

Run: `npx vitest run src/lib/supabase/serverItemAdapter.test.ts`  
Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/supabase/serverItemAdapter.ts src/lib/supabase/runtimeStateService.ts src/lib/supabase/verifiedStateSync.ts src/screens/ChestScreen.tsx src/screens/ActionScreenContextual.tsx src/lib/supabase/serverItemAdapter.test.ts
git commit -m "fix(adapter): refuse to fabricate items from unrecognizable payloads"
```

---

### Task 2: Exclude market-listed items from inventory hydration

**Objective:** `runtime_state = 'listed'` items belong to the market, not the loadout picker.

**Files:**
- Modify: `src/lib/supabase/runtimeStateService.ts`

**Step 1: Add the filter**

```ts
const { data, error } = await supabase
  .from('item_instances')
  .select('id,item_level,rarity,is_locked,runtime_state,equipped_slot,payload,created_at')
  .eq('owner_user_id', userId)
  .neq('runtime_state', 'salvaged')
  .neq('runtime_state', 'consumed')
  .neq('runtime_state', 'listed')
  .order('created_at', { ascending: false });
```

`verifiedStateSync.syncRuntimeItem` already removes listed items after Task 1.

**Step 2: Add regression test**

Create `src/lib/supabase/runtimeStateService.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncRuntimeItemsForUser } from './runtimeStateService';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';

vi.mock('./client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn(() => ({
            neq: vi.fn(() => ({
              neq: vi.fn(() => ({
                order: vi.fn(() => ({
                  data: [
                    {
                      id: 'listed-gun',
                      item_level: 1,
                      rarity: 'Rare',
                      runtime_state: 'listed',
                      equipped_slot: null,
                      payload: { weaponType: 'Pistol', id: 'listed-gun', name: 'Listed', level: 1, rarity: 'Rare' },
                    },
                    {
                      id: 'available-gun',
                      item_level: 1,
                      rarity: 'Rare',
                      runtime_state: 'available',
                      equipped_slot: null,
                      payload: { weaponType: 'Pistol', id: 'available-gun', name: 'Available', level: 1, rarity: 'Rare' },
                    },
                  ],
                  error: null,
                })),
              })),
            })),
          })),
        })),
      })),
    })),
  },
}));

describe('syncRuntimeItemsForUser', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
    useLoadoutStore.setState({ slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null }, consumables: { PreFight: null, MidFight: null, Emergency: null } });
  });

  it('drops listed items from local inventory', async () => {
    await syncRuntimeItemsForUser('user-1');
    const ids = useInventoryStore.getState().items.map((i) => i.id);
    expect(ids).toContain('available-gun');
    expect(ids).not.toContain('listed-gun');
  });
});
```

Run: `npx vitest run src/lib/supabase/runtimeStateService.test.ts`  
Expected: PASS.

**Step 3: Commit**

```bash
git add src/lib/supabase/runtimeStateService.ts src/lib/supabase/runtimeStateService.test.ts
git commit -m "fix(sync): exclude listed/market items from inventory hydration"
```

---

### Task 3: Align client slot-compatibility rules with the server

**Objective:** Client and server must agree on what can go in each slot. Move the rule to a shared helper so both picker and presets use it.

**Files:**
- Create: `src/lib/loadout/loadoutSlotCompat.ts`
- Create test: `src/lib/loadout/loadoutSlotCompat.test.ts`
- Modify: `src/components/action/SlotGearPicker.tsx`

**Step 1: Write failing test for the shared helper**

Create `src/lib/loadout/loadoutSlotCompat.ts`:

```ts
import type { GearItem } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

export function isItemCompatibleWithSlot(item: GearItem, slot: LoadoutSlot): boolean {
  switch (slot) {
    case 'primary':
    case 'secondary':
    case 'heavy':
      return 'weaponType' in item;
    case 'shield':
      return 'hp' in item && !('weaponType' in item);
    case 'classMod':
      return 'treeBonus' in item;
    case 'relic':
      return (
        'affixes' in item &&
        !('weaponType' in item) &&
        !('hp' in item) &&
        !('treeBonus' in item) &&
        !('damage' in item)
      );
    case 'ordnance':
      return 'damage' in item && 'effect' in item && !('weaponType' in item);
    default:
      return false;
  }
}
```

Create `src/lib/loadout/loadoutSlotCompat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isItemCompatibleWithSlot } from './loadoutSlotCompat';
import type { Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';

const weapon = { weaponType: 'Pistol' } as Weapon;
const shield = { hp: 100 } as Shield;
const classMod = { treeBonus: 'assault' } as ClassMod;
const relic = { affixes: [] } as Relic;
const ordnance = { damage: 50, effect: 'burst' } as Ordnance;

describe('isItemCompatibleWithSlot', () => {
  it.each([
    ['primary', weapon, true],
    ['secondary', weapon, true],
    ['heavy', weapon, true],
    ['primary', shield, false],
    ['shield', shield, true],
    ['shield', ordnance, false],
    ['classMod', classMod, true],
    ['relic', relic, true],
    ['relic', ordnance, false],
    ['ordnance', ordnance, true],
  ] as [import('@/store/slices/loadoutSlice').LoadoutSlot, GearItem, boolean][])('%s for %p returns %s', (slot, item, expected) => {
    expect(isItemCompatibleWithSlot(item, slot)).toBe(expected);
  });
});
```

Run: `npx vitest run src/lib/loadout/loadoutSlotCompat.test.ts`  
Expected: PASS.

**Step 2: Replace SlotGearPicker local rule with the helper**

In `src/components/action/SlotGearPicker.tsx`:

- Delete the local `isSlotCompatible` function.
- Add import: `import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';`
- Replace all remaining `isSlotCompatible` calls with `isItemCompatibleWithSlot`.

**Step 3: Run picker tests / compile**

Run: `npx tsc --noEmit`  
Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/loadout/loadoutSlotCompat.ts src/lib/loadout/loadoutSlotCompat.test.ts src/components/action/SlotGearPicker.tsx
git commit -m "refactor(loadout): share slot-compatibility rule between picker and presets"
```

---

### Task 4: Remove the dashboard’s best-weapon fallback

**Objective:** Only show a weapon on the dashboard and in Hunter Totals if it is actually equipped.

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`
- Create test: `src/screens/DashboardScreen.test.tsx` (optional; if UI test harness is too heavy, use a selector test)

**Step 1: Replace weapon selection logic**

In `src/screens/DashboardScreen.tsx`, replace lines 225-257:

**Old:**
```ts
  const bestWeapon = [...inventory.getWeapons()].sort((a, b) => b.combatPower - a.combatPower)[0];
  const equippedWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy') ?? bestWeapon;
  const shieldHp = loadout.getShield()?.hp ?? 0;
  ...
  const statWeapons = useMemo(() => {
    const weaponIds = new Set(equippedWeapons.map((w) => w.id));
    return equippedWeapon && !weaponIds.has(equippedWeapon.id)
      ? [equippedWeapon, ...equippedWeapons]
      : equippedWeapons.length > 0
        ? equippedWeapons
        : equippedWeapon
          ? [equippedWeapon]
          : [];
  }, [equippedWeapon, equippedWeapons]);
```

**New:**
```ts
  const equippedWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy') ?? undefined;
  const shieldHp = loadout.getShield()?.hp ?? 0;
  ...
  const statWeapons = equippedWeapons;
```

Also update `startSelectedRoaming` and `openBossPrep` so they pass `equippedWeapon` (now possibly `undefined`) — the activity builders already accept `Weapon | undefined`, so no code change is required besides removing the fallback.

**Step 2: Add test**

Create a selector-style test `src/screens/DashboardScreen.test.tsx`:

```ts
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';

// Simplified reproduction of the dashboard weapon logic
function useDashboardWeapons() {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const equippedWeapon =
    loadout.getWeapon('primary') ??
    loadout.getWeapon('secondary') ??
    loadout.getWeapon('heavy') ??
    undefined;
  const equippedWeapons = [
    loadout.getWeapon('primary'),
    loadout.getWeapon('secondary'),
    loadout.getWeapon('heavy'),
  ].filter((w): w is import('@/types/items').Weapon => !!w);
  return { equippedWeapon, statWeapons: equippedWeapons, bestWeapon: inventory.getWeapons().sort((a, b) => b.combatPower - a.combatPower)[0] };
}

describe('Dashboard weapon logic', () => {
  it('does not fall back to the best inventory weapon when no weapon is equipped', () => {
    useInventoryStore.setState({ items: [{ id: 'w1', name: 'Best Gun', rarity: 'Rare', combatPower: 999, weaponType: 'Pistol' } as any] });
    useLoadoutStore.setState({ slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null }, consumables: { PreFight: null, MidFight: null, Emergency: null } });

    const { result } = renderHook(() => useDashboardWeapons());
    expect(result.current.equippedWeapon).toBeUndefined();
    expect(result.current.statWeapons).toHaveLength(0);
  });
});
```

Run: `npx vitest run src/screens/DashboardScreen.test.tsx`  
Expected: PASS.

**Step 3: Commit**

```bash
git add src/screens/DashboardScreen.tsx src/screens/DashboardScreen.test.tsx
git commit -m "fix(dashboard): only show actually-equipped weapons, not best inventory fallback"
```

---

### Task 5: Surface real server errors in ActionLoadout

**Objective:** Replace generic “Unable to update loadout” with the actual RPC error message.

**Files:**
- Create: `src/lib/supabase/rpcError.ts`
- Modify: `src/components/action/ActionLoadout.tsx`

**Step 1: Add error formatter**

Create `src/lib/supabase/rpcError.ts`:

```ts
export type RpcErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

export function formatRpcError(error: unknown): string {
  if (typeof error === 'string') return error;
  const e = error as RpcErrorLike;
  if (e?.message) return e.message;
  if (e?.details) return e.details;
  return 'Unable to update loadout.';
}
```

**Step 2: Use it in ActionLoadout**

In `src/components/action/ActionLoadout.tsx`:

```ts
import { formatRpcError } from '@/lib/supabase/rpcError';
```

Replace the two catch blocks:

```ts
    } catch (err) {
      setError(formatRpcError(err));
    }
```

Do this for both `onEquip` and `onUnequip`.

**Step 3: Commit**

```bash
git add src/lib/supabase/rpcError.ts src/components/action/ActionLoadout.tsx
git commit -m "fix(loadout): show actual server error messages when equip/unequip fails"
```

---

### Task 6: Harden preset loading against missing / incompatible items

**Objective:** Presets should not try to equip items that are gone or do not fit the slot.

**Files:**
- Modify: `src/store/slices/loadoutPresetsSlice.ts`
- Create test: `src/store/slices/loadoutPresetsSlice.test.ts`

**Step 1: Add slot compatibility check**

In `src/store/slices/loadoutPresetsSlice.ts`:

```ts
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
```

Change the `loadPreset` slot loop:

```ts
    for (const [slot, itemId] of Object.entries(preset.slots) as [LoadoutSlot, string | null][]) {
      const item = itemId ? inventory.getById(itemId) : undefined;
      if (item && isItemCompatibleWithSlot(item, slot)) {
        equipPromises.push(
          verifiedOps.equipItem(itemId, slot).catch((err) => {
            console.warn(`[loadoutPresets] Failed to equip ${itemId} to ${slot}:`, err instanceof Error ? err.message : err);
          }),
        );
      } else if (itemId) {
        console.warn(`[loadoutPresets] Item ${itemId} (slot ${slot}) missing or incompatible — skipping.`);
      }
    }
```

**Step 2: Add regression test**

Create `src/store/slices/loadoutPresetsSlice.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { useLoadoutPresetsStore } from './loadoutPresetsSlice';
import { useInventoryStore } from './inventorySlice';
import { useLoadoutStore } from './loadoutSlice';
import * as verifiedOps from '@/lib/supabase/verifiedOps';

vi.mock('@/lib/supabase/verifiedOps', () => ({
  verifiedOps: { equipItem: vi.fn(() => Promise.resolve({})) },
}));

describe('loadoutPresets', () => {
  it('skips incompatible items when loading a preset', async () => {
    useInventoryStore.setState({
      items: [
        { id: 'shield-1', hp: 100, rarity: 'Rare', level: 1 } as any,
      ],
    });
    useLoadoutStore.setState({ slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null }, consumables: { PreFight: null, MidFight: null, Emergency: null } });

    const presetId = useLoadoutPresetsStore.getState().savePreset('Test');
    if (!presetId) throw new Error('preset save failed');

    useLoadoutPresetsStore.setState((s) => ({
      presets: s.presets.map((p) =>
        p.id === presetId ? { ...p, slots: { ...p.slots, primary: 'shield-1' } } : p
      ),
    }));

    await useLoadoutPresetsStore.getState().loadPreset(presetId);
    expect(verifiedOps.verifiedOps.equipItem).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/store/slices/loadoutPresetsSlice.test.ts`  
Expected: PASS.

**Step 3: Commit**

```bash
git add src/store/slices/loadoutPresetsSlice.ts src/store/slices/loadoutPresetsSlice.test.ts
git commit -m "fix(presets): skip missing or slot-incompatible items when loading presets"
```

---

### Phase 1 verification

Run the full suite and typecheck:

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: tests pass, types clean, lint clean. If anything fails, fix within Phase 1 before moving on.

---

## Phase 2: Make cache draws produce real weapons (database work)

### Task 7: Add a server-side weapon payload generator

**Objective:** `cc_make_item` must write a real `Weapon`-shaped payload that the client can equip.

**Files:**
- Create: `supabase/migrations/20260620000000_loadout_truth_cache_weapons.sql`

**Step 1: Create migration file**

Create `supabase/migrations/20260620000000_loadout_truth_cache_weapons.sql` with this content:

```sql
-- Generate a real weapon payload for cache draws.
create or replace function public.cc_generate_weapon_payload(
  _level integer,
  _rarity text
) returns jsonb
language plpgsql
immutable
as $$
declare
  _types text[] := array['Pistol','SMG','Shotgun','Sniper','Launcher','Beam'];
  _manufacturers text[] := array['Redline','Ironwood','BlastForge','Prismatek','ThrowTech','HelixWorks'];
  _elements text[] := array['Kinetic','Fire','Shock','Corrosive','Cryo','Void'];
  _type text;
  _manufacturer text;
  _element text;
  _base jsonb;
  _level_scalar numeric;
  _rarity_scalar numeric;
  _base_damage numeric;
  _attack_speed numeric;
  _crit_chance numeric;
  _crit_damage numeric;
  _status_chance numeric;
  _status_damage numeric;
  _boss_damage_mod numeric;
  _wave_damage_mod numeric;
  _shield_damage_mod numeric;
  _armor_damage_mod numeric;
  _combat_power numeric;
begin
  _type := _types[1 + floor(random() * array_length(_types, 1))::integer];
  _manufacturer := _manufacturers[1 + floor(random() * array_length(_manufacturers, 1))::integer];
  _element := _elements[1 + floor(random() * array_length(_elements, 1))::integer];

  _level_scalar := 1 + (_level - 1) * 0.08;

  _rarity_scalar := case _rarity
    when 'Common' then 1.0
    when 'Uncommon' then 1.1
    when 'Rare' then 1.25
    when 'Epic' then 1.45
    when 'Legendary' then 1.7
    else 1.0
  end;

  _base := case _type
    when 'Pistol' then '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
    when 'SMG' then '{"baseDamage":45,"attackSpeed":2.0,"critChance":0.08,"critDamage":1.4,"statusChance":0.12,"statusDamage":1.1,"bossDamageMod":0.95,"waveDamageMod":1.15,"shieldDamageMod":1.05,"armorDamageMod":0.9}'::jsonb
    when 'Shotgun' then '{"baseDamage":140,"attackSpeed":0.7,"critChance":0.06,"critDamage":1.6,"statusChance":0.1,"statusDamage":1.3,"bossDamageMod":0.9,"waveDamageMod":1.3,"shieldDamageMod":0.95,"armorDamageMod":1.05}'::jsonb
    when 'Sniper' then '{"baseDamage":200,"attackSpeed":0.5,"critChance":0.25,"critDamage":2.0,"statusChance":0.05,"statusDamage":1.0,"bossDamageMod":1.2,"waveDamageMod":0.7,"shieldDamageMod":1.0,"armorDamageMod":1.1}'::jsonb
    when 'Launcher' then '{"baseDamage":300,"attackSpeed":0.35,"critChance":0.03,"critDamage":1.8,"statusChance":0.15,"statusDamage":1.5,"bossDamageMod":1.15,"waveDamageMod":1.1,"shieldDamageMod":0.85,"armorDamageMod":1.3}'::jsonb
    when 'Beam' then '{"baseDamage":60,"attackSpeed":1.5,"critChance":0.07,"critDamage":1.35,"statusChance":0.2,"statusDamage":1.4,"bossDamageMod":1.0,"waveDamageMod":0.95,"shieldDamageMod":1.15,"armorDamageMod":1.15}'::jsonb
    else '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
  end;

  _base_damage := round((_base->>'baseDamage')::numeric * _level_scalar * _rarity_scalar);
  _attack_speed := round(((_base->>'attackSpeed')::numeric * _level_scalar * 0.98)::numeric, 2);
  _crit_chance := round(least(0.9, (_base->>'critChance')::numeric * _level_scalar * 0.95)::numeric, 3);
  _crit_damage := round(((_base->>'critDamage')::numeric * _level_scalar * 0.97)::numeric, 2);
  _status_chance := round(least(0.9, (_base->>'statusChance')::numeric * _level_scalar)::numeric, 3);
  _status_damage := round(((_base->>'statusDamage')::numeric * _level_scalar * 0.96)::numeric, 2);

  _boss_damage_mod := (_base->>'bossDamageMod')::numeric;
  _wave_damage_mod := (_base->>'waveDamageMod')::numeric;
  _shield_damage_mod := (_base->>'shieldDamageMod')::numeric;
  _armor_damage_mod := (_base->>'armorDamageMod')::numeric;

  _combat_power := round(_base_damage * _attack_speed * (1 + _crit_chance * _crit_damage) * (1 + _status_chance * _status_damage * 0.3));

  return jsonb_build_object(
    'id', null,
    'weaponType', _type,
    'manufacturer', _manufacturer,
    'element', _element,
    'name', _rarity || ' Cache ' || _type,
    'level', _level,
    'rarity', _rarity,
    'baseDamage', _base_damage,
    'attackSpeed', _attack_speed,
    'critChance', _crit_chance,
    'critDamage', _crit_damage,
    'statusChance', _status_chance,
    'statusDamage', _status_damage,
    'bossDamageMod', _boss_damage_mod,
    'waveDamageMod', _wave_damage_mod,
    'shieldDamageMod', _shield_damage_mod,
    'armorDamageMod', _armor_damage_mod,
    'offlineEarningsMod', 0,
    'rareDropChanceMod', 0,
    'scrapYieldMod', 0,
    'rollQuality', 50,
    'parts', '[]'::jsonb,
    'affixes', '[]'::jsonb,
    'sourceTag', 'Cache-Forged',
    'isLocked', false,
    'combatPower', _combat_power,
    'bossPower', _combat_power,
    'farmPower', _combat_power,
    'economyScore', 0
  );
end;
$$;

-- Tighten weapon-slot acceptance: null/empty payload is no longer treated as a weapon.
create or replace function public.cc_item_accepts_slot(payload jsonb, slot_name text)
returns boolean
language sql
immutable
as $$
  select case
    when slot_name in ('primary','secondary','heavy') then payload ? 'weaponType'
    when slot_name = 'shield' then payload ? 'hp' and not payload ? 'weaponType'
    when slot_name = 'classMod' then payload ? 'treeBonus'
    when slot_name = 'ordnance' then payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
    when slot_name = 'relic' then payload ? 'affixes' and not payload ? 'weaponType' and not payload ? 'hp' and not payload ? 'treeBonus' and not payload ? 'damage'
    else false
  end;
$$;

-- cc_make_item now creates a real weapon
create or replace function public.cc_make_item(nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  odds jsonb;
  rarity_value text;
  item_value bigint;
  item_level integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if p.cache_tokens < 1 then raise exception 'Not enough tokens'; end if;

  odds := public.cc_draw_odds('cache_primary_rarity');
  rarity_value := odds ->> 'outcome';

  update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;

  item_level := greatest(1, p.player_level);
  item_value := public.cc_compute_item_estimated_value(
    jsonb_build_object('odds', odds),
    'weapon',
    rarity_value,
    item_level
  );

  insert into public.item_instances (
    owner_user_id,
    kind,
    item_level,
    rarity,
    estimated_value,
    supply_mode,
    payload
  ) values (
    actor,
    'weapon',
    item_level,
    rarity_value,
    item_value,
    'verified_action',
    public.cc_generate_weapon_payload(item_level, rarity_value)
  ) returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$$;

-- Clean up historical broken cache rows. They were never equippable and the
-- verified_action_ledger still records the draw for audit purposes.
update public.item_instances
set runtime_state = 'consumed',
    tradeable = false,
    equipped_slot = null
where kind = 'gear'
  and payload ? 'odds'
  and not (payload ? 'weaponType')
  and not (payload ? 'hp')
  and not (payload ? 'damage')
  and not (payload ? 'treeBonus')
  and not (payload ? 'affixes');

revoke execute on function public.cc_generate_weapon_payload(integer, text) from public, anon;
grant execute on function public.cc_generate_weapon_payload(integer, text) to authenticated, service_role;
```

**Step 2: Apply locally**

```bash
supabase db reset
```

or

```bash
supabase migration up
```

Expected: migration applies cleanly.

**Step 3: Add TypeScript integration test**

Create `src/lib/supabase/cacheWeaponPayload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from './serverItemAdapter';
import type { ServerItemRow } from './serverItemAdapter';

describe('cache weapon payload round-trip', () => {
  it('recognizes a generated cache weapon as a real weapon', () => {
    const row: ServerItemRow = {
      id: 'cache-weapon-1',
      item_level: 10,
      rarity: 'Rare',
      payload: {
        id: 'cache-weapon-1',
        weaponType: 'Pistol',
        manufacturer: 'HelixWorks',
        element: 'Kinetic',
        name: 'Rare Cache Pistol',
        level: 10,
        rarity: 'Rare',
        baseDamage: 100,
        attackSpeed: 1.2,
        critChance: 0.1,
        critDamage: 1.5,
        statusChance: 0.08,
        statusDamage: 1.2,
        bossDamageMod: 1,
        waveDamageMod: 1,
        shieldDamageMod: 1,
        armorDamageMod: 1,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        parts: [],
        affixes: [],
        sourceTag: 'Cache-Forged',
        isLocked: false,
        pixelSeed: 123,
        combatPower: 150,
        bossPower: 150,
        farmPower: 150,
        economyScore: 0,
      },
    };
    const item = serverItemRowToDisplayGear(row);
    expect(item).not.toBeNull();
    expect(item && 'weaponType' in item ? item.weaponType : null).toBe('Pistol');
  });
});
```

Run: `npx vitest run src/lib/supabase/cacheWeaponPayload.test.ts`  
Expected: PASS.

**Step 4: Commit**

```bash
git add supabase/migrations/20260620000000_loadout_truth_cache_weapons.sql src/lib/supabase/cacheWeaponPayload.test.ts
git commit -m "feat(db): generate real weapon payloads for cache draws and tighten slot acceptance"
```

---

### Phase 2 verification

1. Run backend migration against local Supabase:

```bash
supabase db reset
```

2. Run full TypeScript test suite:

```bash
npm test
npx tsc --noEmit
```

Expected: all green.

---

## Phase 3: Smoke test and regression shield

### Task 8: Write a comprehensive smoke test

**Objective:** A single test file guards every behavior touched in this plan.

**Files:**
- Create: `src/test/loadoutConsistencySmoke.test.ts`

**Step 1: Create smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from '@/lib/supabase/serverItemAdapter';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import type { Weapon, Shield } from '@/types/items';

const weaponPayload = {
  id: 'w1',
  name: 'Gun',
  level: 1,
  rarity: 'Rare',
  weaponType: 'Pistol',
  manufacturer: 'HelixWorks',
  element: 'Kinetic',
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.05,
  critDamage: 1.5,
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
  combatPower: 15,
  bossPower: 15,
  farmPower: 15,
  economyScore: 0,
  sourceTag: 'Cache-Forged',
  parts: [],
  affixes: [],
  pixelSeed: 1,
};

describe('Loadout consistency smoke', () => {
  it('hides placeholder cache rows without a weapon type', () => {
    expect(serverItemRowToDisplayGear({ id: 'bad', payload: { odds: {} } })).toBeNull();
  });

  it('recognizes real cache weapons', () => {
    const item = serverItemRowToDisplayGear({ id: 'w1', payload: weaponPayload });
    expect(item && 'weaponType' in item).toBe(true);
  });

  it('matches client/server slot rules', () => {
    expect(isItemCompatibleWithSlot(weaponPayload as unknown as Weapon, 'primary')).toBe(true);
    expect(isItemCompatibleWithSlot({ hp: 100 } as Shield, 'primary')).toBe(false);
    expect(isItemCompatibleWithSlot({ hp: 100 } as Shield, 'shield')).toBe(true);
  });

  it('dashboard statWeapons only includes equipped weapons', () => {
    useInventoryStore.setState({ items: [weaponPayload as unknown as Weapon] });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });

    const equipped = [
      useLoadoutStore.getState().getWeapon('primary'),
      useLoadoutStore.getState().getWeapon('secondary'),
      useLoadoutStore.getState().getWeapon('heavy'),
    ].filter((w): w is Weapon => !!w);

    expect(equipped).toHaveLength(0);
  });
});
```

Run: `npx vitest run src/test/loadoutConsistencySmoke.test.ts`  
Expected: PASS.

**Step 2: Commit**

```bash
git add src/test/loadoutConsistencySmoke.test.ts
git commit -m "test: add loadout consistency smoke test"
```

---

### Task 9: Final full-suite verification

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
```

If any test fails, fix the implementation, not the test, and re-run.

---

## Out of scope (do not do now)

- Removing the consumables slot UI (`PreFight`/`MidFight`/`Emergency`) — that was a separate policy decision and is not part of the weapon/loadout truth fixes.
- Rebalancing the simplified SQL weapon generator against the client weapon generator — the generated cache weapon is real and equippable; fine-tuning stat parity can be a follow-up.
- Adding a server-side anti-cheat validator for client-generated items — not needed because cache items are now generated server-side.
- Market listing UI still showing equipped items — already handled by excluding `listed` from inventory sync.

---

## Files changed summary

### TypeScript
- `src/lib/supabase/serverItemAdapter.ts`
- `src/lib/supabase/runtimeStateService.ts`
- `src/lib/supabase/verifiedStateSync.ts`
- `src/lib/supabase/rpcError.ts` (new)
- `src/lib/loadout/loadoutSlotCompat.ts` (new)
- `src/components/action/ActionLoadout.tsx`
- `src/components/action/SlotGearPicker.tsx`
- `src/screens/DashboardScreen.tsx`
- `src/screens/ChestScreen.tsx`
- `src/screens/ActionScreenContextual.tsx`
- `src/store/slices/loadoutPresetsSlice.ts`

### Tests
- `src/lib/supabase/serverItemAdapter.test.ts` (new)
- `src/lib/supabase/runtimeStateService.test.ts` (new)
- `src/lib/loadout/loadoutSlotCompat.test.ts` (new)
- `src/screens/DashboardScreen.test.tsx` (new)
- `src/store/slices/loadoutPresetsSlice.test.ts` (new)
- `src/lib/supabase/cacheWeaponPayload.test.ts` (new)
- `src/test/loadoutConsistencySmoke.test.ts` (new)

### SQL
- `supabase/migrations/20260620000000_loadout_truth_cache_weapons.sql` (new)

---

## Approval checkpoint

This plan intentionally keeps verified-action authority on Supabase and treats the client adapter/dashboard as display-only fixes. Cache draws move from placeholder `{odds}` rows to real server-side weapon payloads.

**If the architecture looks correct, say "Proceed" and I’ll implement Phase 1 first.**