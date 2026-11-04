/**
 * Saved Builds SB-1 — the client half of the truthful apply.
 *
 * Pins the contract loadPreset now has with cc_apply_build (0066):
 * ONE apply call carrying the full slot map (vehicle included), the
 * active marker moves only on a clean full apply, the belt applies
 * only after the op returns, and the per-slot report lands in the
 * store for the switcher to render. (The old test pinned the dead
 * fan-out contract — "skips incompatible items when loading" — which
 * was defect 2's silent failure wearing a test's clothes.)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useLoadoutPresetsStore } from './loadoutPresetsSlice';
import { useLoadoutStore, type LoadoutSlot } from './loadoutSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { recallDispatch } from '@/lib/chef/chefClient';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    applyBuild: vi.fn(),
    marketCancel: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('@/lib/chef/chefClient', () => ({
  recallDispatch: vi.fn(() => Promise.resolve({})),
}));

const applyBuildMock = vi.mocked(verifiedOps.applyBuild);
const marketCancelMock = vi.mocked(verifiedOps.marketCancel);
const recallDispatchMock = vi.mocked(recallDispatch);

const EMPTY_SLOTS: Record<LoadoutSlot, string | null> = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

function cleanResult(slots: Record<LoadoutSlot, string | null>) {
  return {
    applied: true,
    outcomes: (Object.entries(slots) as Array<[LoadoutSlot, string | null]>).map(([slot, itemId]) => ({
      slot,
      item_id: itemId,
      outcome: itemId ? 'equipped' : 'empty',
      listing_id: null,
      mission_id: null,
      returns_at: null,
      job_id: null,
      job_kind: null,
    })),
  };
}

function setLoadout(
  slots: Partial<Record<LoadoutSlot, string | null>>,
  consumables: Partial<Record<'PreFight' | 'MidFight' | 'Emergency', string | null>> = {},
) {
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS, ...slots },
    consumables: { PreFight: null, MidFight: null, Emergency: null, ...consumables },
  });
}

describe('loadoutPresets — SB-1 truthful apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketCancelMock.mockResolvedValue({});
    recallDispatchMock.mockResolvedValue({} as never);
    useLoadoutPresetsStore.setState({
      presets: [],
      activePresetId: null,
      presetLoadError: null,
      lastApplyReport: null,
    });
    setLoadout({});
  });

  it('applies through ONE server call carrying every slot, the vehicle included (defect 1)', async () => {
    setLoadout({ primary: 'w-1', shield: 's-1', vehicle: 'v-1' });
    const presetId = useLoadoutPresetsStore.getState().savePreset('Runner');
    if (!presetId) throw new Error('preset save failed');
    // The player wanders off and wears something else entirely.
    setLoadout({ primary: 'w-9' });
    applyBuildMock.mockResolvedValue(cleanResult({ ...EMPTY_SLOTS, primary: 'w-1', shield: 's-1', vehicle: 'v-1' }));

    await useLoadoutPresetsStore.getState().loadPreset(presetId);

    expect(applyBuildMock).toHaveBeenCalledTimes(1);
    expect(applyBuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ primary: 'w-1', shield: 's-1', vehicle: 'v-1', relic: null }),
    );
    expect(useLoadoutPresetsStore.getState().activePresetId).toBe(presetId);
    expect(useLoadoutPresetsStore.getState().lastApplyReport).toMatchObject({
      presetId,
      applied: true,
    });
  });

  it('a partial apply leaves the active marker where it was and stores the report (defect 3)', async () => {
    setLoadout({ primary: 'w-a' });
    const aId = useLoadoutPresetsStore.getState().savePreset('Alpha');
    setLoadout({ primary: 'w-b', vehicle: 'v-b' });
    const bId = useLoadoutPresetsStore.getState().savePreset('Bravo');
    if (!aId || !bId) throw new Error('preset save failed');
    useLoadoutPresetsStore.setState({ activePresetId: aId });

    applyBuildMock.mockResolvedValue({
      applied: false,
      outcomes: [
        { slot: 'primary', item_id: 'w-b', outcome: 'equipped', listing_id: null, mission_id: null, returns_at: null, job_id: null, job_kind: null },
        { slot: 'vehicle', item_id: 'v-b', outcome: 'in_service', listing_id: null, mission_id: 'm-1', returns_at: '2026-10-30T08:00:00.000Z', job_id: null, job_kind: null },
      ],
    });

    await useLoadoutPresetsStore.getState().loadPreset(bId);

    const state = useLoadoutPresetsStore.getState();
    expect(state.activePresetId).toBe(aId); // the marker did NOT move
    expect(state.lastApplyReport?.applied).toBe(false);
    const vehicle = state.lastApplyReport?.outcomes.find((o) => o.slot === 'vehicle');
    expect(vehicle).toMatchObject({
      outcome: 'in_service',
      missionId: 'm-1',
      returnsAt: '2026-10-30T08:00:00.000Z',
    });
    // Slots the server did not list still read truthfully from the build.
    const shield = state.lastApplyReport?.outcomes.find((o) => o.slot === 'shield');
    expect(shield?.outcome).toBe('empty');
  });

  it('the belt applies only after the server op returns — and never when it fails', async () => {
    setLoadout({ primary: 'w-1' }, { PreFight: 'stim-1' });
    const presetId = useLoadoutPresetsStore.getState().savePreset('Belted');
    if (!presetId) throw new Error('preset save failed');
    setLoadout({ primary: 'w-2' }, { PreFight: null });
    useLoadoutPresetsStore.setState({ activePresetId: null });

    applyBuildMock.mockRejectedValue(new Error('network down'));
    await useLoadoutPresetsStore.getState().loadPreset(presetId);
    let state = useLoadoutPresetsStore.getState();
    expect(state.presetLoadError).toBe('network down');
    expect(state.lastApplyReport).toBeNull();
    expect(state.activePresetId).toBeNull();
    expect(useLoadoutStore.getState().consumables.PreFight).toBeNull(); // belt untouched

    applyBuildMock.mockResolvedValue(cleanResult({ ...EMPTY_SLOTS, primary: 'w-1' }));
    await useLoadoutPresetsStore.getState().loadPreset(presetId);
    state = useLoadoutPresetsStore.getState();
    expect(state.presetLoadError).toBeNull();
    expect(useLoadoutStore.getState().consumables.PreFight).toBe('stim-1'); // belt landed with the build
    expect(state.activePresetId).toBe(presetId);
  });

  it('delist & equip cancels the listing, then re-applies the build', async () => {
    setLoadout({ primary: 'w-1' });
    const presetId = useLoadoutPresetsStore.getState().savePreset('Listed');
    if (!presetId) throw new Error('preset save failed');
    applyBuildMock.mockResolvedValue(cleanResult({ ...EMPTY_SLOTS, primary: 'w-1' }));

    await useLoadoutPresetsStore.getState().delistAndReapply(presetId, 'listing-9');

    expect(marketCancelMock).toHaveBeenCalledWith('listing-9');
    expect(applyBuildMock).toHaveBeenCalledTimes(1);
  });

  it('recall & re-apply recalls the mission, then re-applies the build', async () => {
    setLoadout({ vehicle: 'v-1' });
    const presetId = useLoadoutPresetsStore.getState().savePreset('Dispatched');
    if (!presetId) throw new Error('preset save failed');
    applyBuildMock.mockResolvedValue(cleanResult({ ...EMPTY_SLOTS, vehicle: 'v-1' }));

    await useLoadoutPresetsStore.getState().recallAndReapply(presetId, 'mission-7');

    expect(recallDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: 'mission-7' }),
    );
    expect(applyBuildMock).toHaveBeenCalledTimes(1);
  });

  it('still caps builds at five, free and ungated', () => {
    const { savePreset } = useLoadoutPresetsStore.getState();
    for (let i = 0; i < 5; i += 1) {
      expect(savePreset(`Build ${i + 1}`)).not.toBeNull();
    }
    expect(savePreset('One too many')).toBeNull();
    expect(useLoadoutPresetsStore.getState().presets).toHaveLength(5);
  });
});
