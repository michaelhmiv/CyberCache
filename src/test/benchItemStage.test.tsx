/**
 * The item on the bench, on stage (Motion M4b).
 *
 * M1 put the hunter to work; the bench itself stayed empty — the
 * thing being made appeared in no scene, and when it finished,
 * only weapons rose as themselves (everything else became a gold
 * disc). These tests assert the stage now shows the work:
 *  - a running job seats its truthful output picture at the work
 *    point (real renders for recipe-specified outputs, the
 *    slot+rarity frame for gear that does not exist yet);
 *  - the set-piece FX execute on the canvas light-kit vehicle —
 *    no SVG strokes remain in BenchFx;
 *  - completions of every gear kind + cosmetics rise as
 *    themselves;
 *  - salvaging — whose completion beat was forced null — gets the
 *    same celebrate + rise grammar off the salvage feed, once per
 *    settlement, never replaying history, never for a failed
 *    batch, never under reduced motion;
 *  - the panel bench scene seats the caller's running job too.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useInventoryStore, useSalvageFeedStore, useWorkshopStore } from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';
import type { SalvageYield } from '@/lib/gear/salvageAward';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ActivityKind } from '@/types/activity';
import type { GearItem, Shield, Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const motionHoist = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => motionHoist.reducedMotion };
});

const DIORAMA_WEAPON: Weapon = {
  id: 'bench-item-weapon',
  name: 'Bench Test Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;

const job = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'job-1',
  bench: 1,
  kind: 'consumable',
  recipeId: 'recipe_patch_kit',
  name: 'Patch Kit',
  state: 'running',
  unitsTotal: 1,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 1_000,
  remainingMs: 59_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
  ...over,
});

const serverView = (over: Partial<WorkshopServerView>): WorkshopServerView => ({
  benches: 1,
  tools: { owned: {}, fitted: {}, charges: {} },
  jobs: [],
  masteries: {},
  activeActionKind: null,
  recentCompletions: [],
  ...over,
});

const setWorkshop = (view: WorkshopServerView | null) => {
  act(() => {
    useWorkshopStore.setState({ server: view });
  });
};

const renderDiorama = (activityKind: ActivityKind) =>
  render(
    <LiveTurfDiorama
      area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
      weapon={DIORAMA_WEAPON}
      playerLevel={5}
      equippedCount={1}
      activityKind={activityKind}
    />,
  );

afterEach(() => {
  motionHoist.reducedMotion = false;
  act(() => {
    useWorkshopStore.setState({ server: null });
    useInventoryStore.setState({ items: [] });
    useSalvageFeedStore.setState({ events: [] });
  });
});

describe('the seat — the running job’s output sits on the bench', () => {
  it('consumable job: the real consumable seats at the work point; FX ride the canvas vehicle', () => {
    setWorkshop(serverView({ jobs: [job({})] }));
    renderDiorama('crafting');
    const seat = screen.getByTestId('bench-seat-render');
    expect(seat.getAttribute('data-plan-kind')).toBe('consumable');
    // The FX vehicle is the canvas light kit now — no SVG burst.
    const fx = screen.getByTestId('bench-fx');
    expect(fx.getAttribute('data-fx-vehicle')).toBe('canvas');
    expect(fx.querySelector('canvas')).toBeTruthy();
    expect(fx.querySelector('svg')).toBeNull();
  });

  it('gear job: the seat is the slot+rarity frame (the item does not exist yet)', () => {
    setWorkshop(serverView({ jobs: [job({ kind: 'gear', recipeId: 'frame_shield', gearRarity: 'Rare' })] }));
    renderDiorama('crafting');
    const seat = screen.getByTestId('bench-seat-render');
    expect(seat.getAttribute('data-plan-kind')).toBe('gearFrame');
    const frame = seat.querySelector('[data-seat-slot]');
    expect(frame?.getAttribute('data-seat-slot')).toBe('shield');
    expect(frame?.getAttribute('data-seat-rarity')).toBe('Rare');
  });

  it('named-relic job: the seat is the relic form, not a frame', () => {
    setWorkshop(serverView({ jobs: [job({ kind: 'gear', recipeId: 'tool_precision_calipers' })] }));
    renderDiorama('crafting');
    expect(screen.getByTestId('bench-seat-render').getAttribute('data-plan-kind')).toBe('namedRelic');
  });

  it('no running job in the lane: the bench sits empty', () => {
    setWorkshop(serverView({ jobs: [] }));
    renderDiorama('crafting');
    expect(screen.queryByTestId('bench-seat')).toBeNull();
  });

  it('lane discipline: a running CRAFT job does not seat on the service stage', () => {
    setWorkshop(serverView({ jobs: [job({})] }));
    renderDiorama('workshop_service');
    expect(screen.queryByTestId('bench-seat')).toBeNull();
  });

  it('service lane: a running shield-tech job seats the target shield itself', () => {
    const shield = {
      id: 'shield-9',
      name: 'Service Aegis',
      rarity: Rarity.Rare,
      level: 4,
      hp: 120,
      rechargeRate: 8,
      rechargeDelay: 2,
      element: Element.Kinetic,
    } as unknown as Shield;
    act(() => {
      useInventoryStore.setState({ items: [shield] });
    });
    setWorkshop(serverView({
      jobs: [job({ kind: 'shieldtech', recipeId: 'svc_flip', shieldtechItemId: 'shield-9' })],
    }));
    renderDiorama('workshop_service');
    expect(screen.getByTestId('bench-seat-render').getAttribute('data-plan-kind')).toBe('serviceItem');
  });

  it('reduced motion: the seat still shows (it is information, not motion); FX stay dark', () => {
    motionHoist.reducedMotion = true;
    setWorkshop(serverView({ jobs: [job({})] }));
    renderDiorama('crafting');
    expect(screen.getByTestId('bench-seat-render').getAttribute('data-plan-kind')).toBe('consumable');
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });
});

describe('the rise — every kind rises as itself', () => {
  const settle = (entry: Record<string, unknown>) => {
    const doneJob = job({ state: 'complete', unitsCompleted: 1 });
    setWorkshop(serverView({ jobs: [doneJob], recentCompletions: [] }));
    renderDiorama('crafting');
    setWorkshop(serverView({ jobs: [doneJob], recentCompletions: [entry as never] }));
  };

  it('a shield completion rises as the shield (was: gold disc)', () => {
    const shield = {
      id: 'shield-1',
      name: 'Risen Aegis',
      rarity: Rarity.Rare,
      level: 4,
      hp: 120,
      rechargeRate: 8,
      rechargeDelay: 2,
      element: Element.Kinetic,
    } as unknown as Shield;
    act(() => {
      useInventoryStore.setState({ items: [shield] });
    });
    settle({ jobId: 'job-1', recipeId: 'frame_shield', name: 'Shield Frame', unit: 0, completedAtMs: 5, itemId: 'shield-1', rarity: 'Rare' });
    expect(screen.getByTestId('bench-completion-rise')).toBeTruthy();
    expect(screen.getByTestId('bench-rise-render').getAttribute('data-plan-kind')).toBe('item');
  });

  it('a cosmetic completion rises as the part (was: gold disc)', () => {
    settle({ jobId: 'job-1', recipeId: 'recipe_skin_bulwark_torso', name: 'Bulwark Siege Torso', unit: 0, completedAtMs: 5, itemId: 'cos-1', cosmeticPartId: 'bulwark-torso' });
    expect(screen.getByTestId('bench-rise-render').getAttribute('data-plan-kind')).toBe('cosmeticPart');
  });

  it('a service completion still rises as the glow beat (it has no item picture)', () => {
    settle({ jobId: 'job-1', recipeId: 'svc', name: 'Shield Flip', unit: 0, completedAtMs: 5, shieldtechPointsApplied: 12 });
    expect(screen.getByTestId('bench-rise-render').getAttribute('data-plan-kind')).toBe('glow');
  });
});

describe('the salvage beat — salvaging celebrates its settlements', () => {
  const scrapYield: SalvageYield = {
    scrapValue: 12,
    scrapAlloy: 0,
    ballisticParts: 0,
    reactiveComponents: 0,
    techFragments: 0,
    voidDust: 0,
    essences: {},
  };
  const victim = { id: 'victim-1', name: 'Bent Frame' } as unknown as GearItem;

  it('a fresh recycle fires the rise as Scrap; history at mount never replays', () => {
    // A recycle that settled BEFORE the stage mounted: no beat.
    act(() => {
      useSalvageFeedStore.getState().push(victim, scrapYield);
    });
    renderDiorama('salvaging');
    expect(screen.queryByTestId('salvage-completion-rise')).toBeNull();

    // A recycle settling while salvaging holds the stage: the beat.
    act(() => {
      useSalvageFeedStore.getState().push({ ...victim, id: 'victim-2' }, scrapYield);
    });
    expect(screen.getByTestId('salvage-completion-rise')).toBeTruthy();
    expect(screen.getByTestId('salvage-rise-render').getAttribute('data-plan-kind')).toBe('material');
    // The hunter celebrates the settlement (the work cycle holds).
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });

  it('a failed batch earns no beat', () => {
    renderDiorama('salvaging');
    act(() => {
      useSalvageFeedStore.getState().pushBatchFailure({ ceiling: 'Rare', totalItems: 4, message: 'nope' });
    });
    expect(screen.queryByTestId('salvage-completion-rise')).toBeNull();
  });

  it('reduced motion: no salvage beat', () => {
    motionHoist.reducedMotion = true;
    renderDiorama('salvaging');
    act(() => {
      useSalvageFeedStore.getState().push(victim, scrapYield);
    });
    expect(screen.queryByTestId('salvage-completion-rise')).toBeNull();
  });

  it('a recycle settling while another mode holds the stage does not fire on the bench', () => {
    renderDiorama('roaming_loot');
    act(() => {
      useSalvageFeedStore.getState().push(victim, scrapYield);
    });
    expect(screen.queryByTestId('salvage-completion-rise')).toBeNull();
  });
});

describe('the panel bench scene seats the caller’s job', () => {
  it('CraftingBenchScene renders the seat for the running job it is handed', () => {
    render(<CraftingBenchScene progress={0.4} causeLabel="Tempering" working seatJob={job({})} />);
    expect(screen.getByTestId('crafting-bench-seat-render').getAttribute('data-plan-kind')).toBe('consumable');
  });

  it('no job handed in: no seat', () => {
    render(<CraftingBenchScene progress={0.4} causeLabel="Tempering" working />);
    expect(screen.queryByTestId('crafting-bench-seat')).toBeNull();
  });
});
