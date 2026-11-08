/**
 * Work cycle on stage (Motion Reboot M1) — the bench tenants.
 *
 * The defect M1 exists to kill: in crafting / salvaging / workshop
 * service the hunter stood at IDLE HOLDING HIS WEAPON in front of
 * a static set piece while the panel below claimed work was
 * happening, and a finished craft produced no beat on the stage
 * at all. These tests assert the stage itself:
 *  - bench modes render the hunter at the bench, UNARMED, in the
 *    work-cycle branch (data-work-cycle names the spec — data,
 *    not a code branch);
 *  - the cycle's set-piece FX run only while a job in the mode's
 *    lane is RUNNING in the workshop mirror (salvaging: the mode
 *    holding the stage is the work);
 *  - a unit settling in the lane fires the completion rise once;
 *  - reduced motion collapses the bench to the held work pose —
 *    no FX, no cycle (today's picture);
 *  - roaming is untouched.
 * M4c extends the contract to the last frozen tenant: market
 * listing runs the low-amplitude stall cycle (the hunter tends
 * his stall, unarmed; no bench FX — nothing is struck there).
 * Panel bay scenes assert the same contract per family.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene, RepairBayScene, ShieldTechBayScene } from '@/components/pixelArt/ActionScenes';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useWorkshopStore } from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ActivityKind } from '@/types/activity';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

// The diorama reads reduced motion from framer's useReducedMotion
// (the OS prefers-reduced-motion signal — the game's standing
// source). Force it per-test through the hook itself.
const motionHoist = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => motionHoist.reducedMotion };
});

const DIORAMA_WEAPON: Weapon = {
  id: 'work-cycle-weapon',
  name: 'Cycle Test Carbine',
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
  bench: 0,
  kind: 'consumable',
  recipeId: 'recipe-1',
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
  });
});

describe('LiveTurfDiorama — bench modes run the work cycle (M1)', () => {
  it('crafting: the hunter works the bench unarmed — no held weapon, forge spec bound', () => {
    setWorkshop(serverView({ jobs: [job({})] }));
    renderDiorama('crafting');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('forge');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    // Working: the forge FX run at the bench.
    expect(screen.getByTestId('bench-fx').getAttribute('data-bench-fx')).toBe('forge');
  });

  it('crafting at rest: no job in the lane, no cycle FX — but still at the bench, unarmed', () => {
    setWorkshop(serverView({ jobs: [] }));
    renderDiorama('crafting');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('forge');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });

  it('crafting ignores a running SERVICE-lane job (lane discipline)', () => {
    setWorkshop(serverView({ jobs: [job({ kind: 'repair' })] }));
    renderDiorama('crafting');
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });

  it('workshop service: a running repair job runs the assembly cycle', () => {
    setWorkshop(serverView({ jobs: [job({ kind: 'repair' })] }));
    renderDiorama('workshop_service');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('assembly');
    expect(screen.getByTestId('bench-fx').getAttribute('data-bench-fx')).toBe('assembly');
  });

  it('workshop service ignores a running CRAFT-lane job', () => {
    setWorkshop(serverView({ jobs: [job({ kind: 'consumable' })] }));
    renderDiorama('workshop_service');
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });

  it('salvaging: the mode holding the stage is the work — crush cycle runs with no job queue', () => {
    setWorkshop(null);
    renderDiorama('salvaging');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('crush');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    expect(screen.getByTestId('bench-fx').getAttribute('data-bench-fx')).toBe('crush');
  });

  it('a unit settling in the lane fires the completion rise; pre-existing completions never replay', () => {
    const doneJob = job({ state: 'complete', unitsCompleted: 1 });
    const entry = {
      jobId: 'job-1',
      recipeId: 'recipe-1',
      name: 'Patch Kit',
      unit: 0,
      completedAtMs: 1_700_000_000_000,
      consumableType: 'PatchKit',
    };
    // First mirror view already carries the completion: no beat.
    setWorkshop(serverView({ jobs: [doneJob], recentCompletions: [entry] }));
    renderDiorama('crafting');
    expect(screen.queryByTestId('bench-completion-rise')).toBeNull();

    // A NEW unit settles while the stage watches: the rise fires.
    const entry2 = { ...entry, unit: 1, completedAtMs: 1_700_000_060_000 };
    setWorkshop(serverView({ jobs: [doneJob], recentCompletions: [entry, entry2] }));
    expect(screen.getByTestId('bench-completion-rise')).toBeTruthy();
  });

  it('reduced motion: the bench is the held pose — no FX even with a job running', () => {
    motionHoist.reducedMotion = true;
    setWorkshop(serverView({ jobs: [job({})] }));
    renderDiorama('crafting');
    expect(screen.queryByTestId('bench-fx')).toBeNull();
    expect(screen.getByTestId('pixel-hunter').getAttribute('data-armed')).toBe('false');
    expect(screen.getByTestId('pixel-hunter').getAttribute('data-cycle-active')).toBeNull();
  });

  it('market listing (M4c): the hunter tends his stall — stall cycle bound, unarmed, no bench FX', () => {
    renderDiorama('market_listing');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('stall');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    // Nothing is struck at a stall: the bench FX kit never mounts.
    expect(screen.queryByTestId('bench-fx')).toBeNull();
    expect(screen.getByTestId('pixel-vendor-set')).toBeTruthy();
  });

  it('market listing under reduced motion: the held work pose at the stall — no cycle', () => {
    motionHoist.reducedMotion = true;
    renderDiorama('market_listing');
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-work-cycle')).toBe('stall');
    expect(hunter.getAttribute('data-cycle-active')).toBeNull();
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
  });

  it('roaming is untouched: enemy, held weapon, no cycle', () => {
    renderDiorama('roaming_loot');
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    expect(screen.getByTestId('pixel-held-weapon')).toBeTruthy();
    expect(screen.queryByTestId('bench-fx')).toBeNull();
  });
});

describe('Panel bay scenes — the same spec drives the bay (M1)', () => {
  it('crafting bench scene: forge FX while working, silent at rest', () => {
    const { rerender } = render(
      <CraftingBenchScene progress={0.4} causeLabel="Tempering" working />,
    );
    expect(screen.getByTestId('crafting-bench-fx').getAttribute('data-bench-fx')).toBe('forge');
    expect(screen.getByTestId('crafting-bench-hunter').getAttribute('data-work-cycle')).toBe('forge');
    rerender(<CraftingBenchScene progress={0} causeLabel="The Bench" working={false} />);
    expect(screen.queryByTestId('crafting-bench-fx')).toBeNull();
  });

  it('crafting bench scene derives working from a mid-flight progress bar when not told', () => {
    const { rerender } = render(<CraftingBenchScene progress={0.4} causeLabel="Tempering" />);
    expect(screen.getByTestId('crafting-bench-fx')).toBeTruthy();
    rerender(<CraftingBenchScene progress={0} causeLabel="The Bench" />);
    expect(screen.queryByTestId('crafting-bench-fx')).toBeNull();
  });

  it('repair bay scene runs the assembly accent', () => {
    render(<RepairBayScene progress={0.4} causeLabel="Repairing" working />);
    expect(screen.getByTestId('repair-bay-fx').getAttribute('data-bench-fx')).toBe('assembly');
    expect(screen.getByTestId('repair-bay-hunter').getAttribute('data-work-cycle')).toBe('assembly');
  });

  it('shield-tech bay scene runs the calibration accent (its own family)', () => {
    render(<ShieldTechBayScene progress={0.4} causeLabel="Calibrating" working />);
    expect(screen.getByTestId('shieldtech-bay-fx').getAttribute('data-bench-fx')).toBe('calibration');
    expect(screen.getByTestId('shieldtech-bay-hunter').getAttribute('data-work-cycle')).toBe('calibration');
  });

  it('reduced motion silences the bay FX while working', () => {
    render(<CraftingBenchScene progress={0.4} causeLabel="Tempering" working reduced />);
    expect(screen.queryByTestId('crafting-bench-fx')).toBeNull();
  });
});
