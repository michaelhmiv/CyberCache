/**
 * Bench harness page (Motion Reboot M1, dev only) — serves the
 * Home stage in its bench modes and the three panel bay scenes
 * with a seeded workshop mirror, for before/after captures at
 * phone width. Driven entirely by URL params:
 *
 *   mode    crafting | salvaging | workshopService |
 *           panel-craft | panel-repair | panel-shield
 *   state   working (a running job in the lane) | rest (no job) |
 *           complete (a unit settles ~1.8s after load)
 *   kind    consumable (default) | gear | relic — the crafting
 *           job's family (M4b: the seat on the bench differs per
 *           family — the real consumable, the slot+rarity frame,
 *           the named relic's form). The job carries a REAL
 *           recipe id so the seat resolution runs the production
 *           path, exactly as the live stage does.
 *   weapon  1 (default; the fixture weapon is passed — bench
 *           modes sling it, other modes hold it) | 0
 *
 * On master (pre-M1) the same page renders the statue: bench
 * modes fall through to the armed idle, panel scenes hold the
 * frozen work pose. Nothing here is imported by the app bundle;
 * bench-harness.html is served by the Vite dev server only.
 */
import React from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene, RepairBayScene, ShieldTechBayScene } from '@/components/pixelArt/ActionScenes';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useWorkshopStore } from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') ?? 'crafting';
const state = params.get('state') ?? 'working';
const withWeapon = params.get('weapon') !== '0';
const kindParam = params.get('kind') ?? 'consumable';

/** The crafting job per family — real catalog recipes, so the
 *  M4b seat resolution (recipeId → catalog → compositor) runs
 *  exactly as it does on the live stage. */
const jobForKind = (service: boolean): Partial<WorkshopJobView> => {
  if (service) return { kind: 'repair' };
  if (kindParam === 'gear') return { kind: 'gear', recipeId: 'frame_shield', name: 'Shield Frame', gearRarity: 'Rare' };
  if (kindParam === 'relic') return { kind: 'gear', recipeId: 'tool_precision_calipers', name: 'Precision Calipers', gearRarity: 'Epic' };
  return { kind: 'consumable', recipeId: 'recipe_patch_kit', name: 'Patch Kit' };
};

const FIXTURE_WEAPON: Weapon = {
  id: 'bench-harness-weapon',
  name: 'Harness Carbine',
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

const harnessJob = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'harness-job-1',
  bench: 0,
  kind: 'consumable',
  recipeId: 'recipe_patch_kit',
  name: 'Patch Kit',
  state: 'running',
  unitsTotal: 2,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 12_000,
  remainingMs: 48_000,
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

const baseView = (over: Partial<WorkshopServerView>): WorkshopServerView => ({
  benches: 1,
  tools: { owned: {}, fitted: {}, charges: {} },
  jobs: [],
  masteries: {},
  activeActionKind: null,
  recentCompletions: [],
  ...over,
});

const completionEntry = (unit: number) => ({
  jobId: 'harness-job-1',
  recipeId: 'recipe_patch_kit',
  name: 'Patch Kit',
  unit,
  completedAtMs: 1_700_000_000_000 + unit * 60_000,
  consumableType: 'PatchKit',
});

function seedWorkshop() {
  const service = mode === 'workshopService';
  const family = jobForKind(service);
  if (state === 'working') {
    useWorkshopStore.setState({
      server: baseView({ jobs: [harnessJob({ ...family })], activeActionKind: service ? 'workshop_service' : 'crafting' }),
    });
  } else if (state === 'rest') {
    useWorkshopStore.setState({ server: baseView({}) });
  } else if (state === 'complete') {
    const done = harnessJob({ ...family, state: 'complete', unitsCompleted: 1 });
    useWorkshopStore.setState({
      server: baseView({ jobs: [done], recentCompletions: [completionEntry(0)] }),
    });
    window.setTimeout(() => {
      useWorkshopStore.setState({
        server: baseView({ jobs: [done], recentCompletions: [completionEntry(0), completionEntry(1)] }),
      });
    }, 1800);
  }
}

seedWorkshop();

const activityKindFor = (m: string) =>
  m === 'workshopService' ? 'workshop_service' : (m as 'crafting' | 'salvaging');

export const BenchHarnessPage: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#0B0B10', padding: 12, boxSizing: 'border-box' }}>
    <div style={{ width: 390, margin: '0 auto' }} data-testid="bench-harness-root">
      {mode === 'panel-craft' ? (
        <CraftingBenchScene
          progress={0.45}
          causeLabel="Tempering · Patch Kit"
          buysLabel="→ Patch Kit ×1"
          working={state !== 'rest'}
          seatJob={state === 'working' ? harnessJob({ ...jobForKind(false) }) : null}
        />
      ) : mode === 'panel-repair' ? (
        <RepairBayScene progress={0.45} causeLabel="Repairing · Dune Runner" buysLabel="2 kits used" working={state !== 'rest'} />
      ) : mode === 'panel-shield' ? (
        <ShieldTechBayScene progress={0.45} causeLabel="Calibrating · Aegis Wall" buysLabel="1 core used" working={state !== 'rest'} />
      ) : (
        <LiveTurfDiorama
          area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
          weapon={withWeapon ? FIXTURE_WEAPON : undefined}
          playerLevel={5}
          equippedCount={1}
          activityKind={activityKindFor(mode) as never}
        />
      )}
    </div>
  </div>
);
