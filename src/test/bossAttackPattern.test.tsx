/**
 * Attack Pattern prep block (slice C1) — Boss Intel Law on the prep
 * surface: the block prints the BOSS's authored rhythm (hit cadence,
 * special name/cycle/share, wind-up) and nothing about the player.
 * Driven through the real panel + stores with a mocked Chef
 * transport, the same boundary as bossEncounterFlow.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import { RiskSetting } from '@/types/game';
import { useActivityStore, useBossStore, useLoadoutStore, usePlayerStore } from '@/store';
import type { BossDef } from '@/types/boss';

vi.mock('@/lib/chef/chefClient', () => ({
  verifyBossFight: vi.fn(),
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0,
      chargeMax: 100,
      charged: false,
      selection: null,
      selected: null,
      qualified: [],
      signatures: [],
      noKeystoneNote: 'No action skill yet.',
    },
  })),
}));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

const mirror = REGION_1_BOSSES.find((b) => b.id === 'mnemosyne_mirror')!;

function renderPrep(boss: BossDef) {
  usePlayerStore.setState({ id: 'test-player', level: 60, credits: 100000, consumables: {} });
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, shield: null, ordnance: null, classMod: null, relic: null, vehicle: null },
  });
  useBossStore.setState({
    currentBossId: boss.id,
    unlockedBossIds: [boss.id],
    defeatedBossIds: [],
    pityCounters: {},
    preparedConsumables: {},
    selectedRisk: RiskSetting.Balanced,
    attemptHistory: [],
  });
  const builtActivity = buildBossFightActivity(boss, null, 'prep');
  useActivityStore.setState({
    current: {
      ...builtActivity,
      bossPhase: 'prep',
      targetType: builtActivity.targetType ?? null,
      targetId: builtActivity.targetId ?? null,
      targetLabel: builtActivity.targetLabel ?? null,
      sceneKey: builtActivity.sceneKey ?? null,
      notes: builtActivity.notes ?? null,
      activityPayload: builtActivity.activityPayload ?? {},
      publicPayload: builtActivity.publicPayload ?? {},
      publicVisible: builtActivity.publicVisible ?? true,
      startedAt: null,
      completesAt: null,
      lastHeartbeatAt: null,
      schemaVersion: 1,
      updatedAt: null,
    },
    pending: false,
  });
  return render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BossEncounterPanel — Attack Pattern block (C1)', () => {
  it('prints the boss rhythm: hits, special + cycle + share, wind-up', () => {
    renderPrep(mirror);
    const block = screen.getByTestId('boss-attack-pattern');
    expect(block).toBeTruthy();
    expect(block.textContent).toContain('Attack Pattern');
    expect(block.textContent).toContain('Every 5s');
    expect(block.textContent).toContain('Refraction Burst');
    expect(block.textContent).toContain('every 15s');
    expect(block.textContent).toContain('~40% of damage');
    expect(block.textContent).toContain('3s telegraph');
    expect(block.textContent).toContain('shields recharge in them');
  });

  it('a swarm-cadence boss shows the pattern without the quiet line', () => {
    const ashgut = REGION_1_BOSSES.find((b) => b.id === 'ashgut')!;
    renderPrep(ashgut);
    const block = screen.getByTestId('boss-attack-pattern');
    expect(block.textContent).toContain('Eruption');
    expect(block.textContent).not.toContain('shields recharge in them');
  });

  it('a cadence-less boss renders no pattern block', () => {
    const bare: BossDef = { ...mirror };
    delete bare.cadence;
    renderPrep(bare);
    expect(screen.queryByTestId('boss-attack-pattern')).toBeNull();
  });
});
