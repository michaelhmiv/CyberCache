/**
 * Gear-truth slice — danger math reads the authoritative loadout.
 *
 * The playtest's fresh guest saw DEADLY FOR YOU on every area and
 * YOU LOSE on the starter boss while actually winning both. The
 * duel math itself was honest; its INPUT was the broken Gear read:
 * with the starter pistol invisible to the loadout store, the
 * guest's priced DPS was 0 and every duel resolved to ticks-to-kill
 * infinity. These tests pin the input chain: the repaired starter
 * in the primary slot prices a positive DPS into
 * currentHunterDangerStats, and the starter area does NOT verdict
 * lethal for a fresh level-1 guest holding it. (The empty-loadout
 * lethal verdict is also pinned — the math is unchanged; what
 * changed is that the guest's weapon now reaches it.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { assessAreaDanger, currentHunterDangerStats } from '@/lib/combat/areaDanger';
import { getRoamingArea } from '@/constants/roamingAreas';
import { buildStarterWeaponPayload } from '@/server/lib/starterWeapon';
import { serverItemRowToDisplayGear } from '@/lib/api/serverItemAdapter';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null, vehicle: null,
} as const;

beforeEach(() => {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS } });
  usePlayerStore.setState({ level: 1, xp: 0, consumables: {} } as never);
});

describe('danger input chain', () => {
  it('an empty loadout prices 0 DPS and the starter area reads lethal (the pre-fix guest state)', () => {
    const stats = currentHunterDangerStats();
    expect(stats.effectiveDps).toBe(0);
    const verdict = assessAreaDanger(getRoamingArea('dustwaste_frontier'), stats);
    expect(verdict?.tier).toBe('lethal');
  });

  it('the repaired starter in the primary slot prices real DPS and Dustwaste is not lethal', () => {
    const row = {
      item_id: 'starter-row',
      payload: buildStarterWeaponPayload('starter-row'),
      runtime_state: 'equipped',
    };
    const starter = serverItemRowToDisplayGear(row);
    expect(starter).not.toBeNull();
    useInventoryStore.setState({ items: [starter!] });
    useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS, primary: 'starter-row' } });

    const stats = currentHunterDangerStats();
    expect(stats.effectiveDps).toBeGreaterThan(0);
    const verdict = assessAreaDanger(getRoamingArea('dustwaste_frontier'), stats);
    expect(verdict).not.toBeNull();
    expect(verdict?.tier).not.toBe('lethal');
  });
});
