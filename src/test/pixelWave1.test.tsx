import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { buildInitialTimeline, type FightOutcome, type FightTimeline } from '@/lib/animation/fightTimeline';
import {
  PIXEL_BOSS_SPRITES,
  PIXEL_ENEMY_SPRITES,
  getPixelSprite,
  pixelBackgroundForArea,
  pixelBossSpriteForBoss,
  pixelEnemySpriteForArchetype,
} from '@/lib/pixel/manifest';
import { ROAMING_AREAS, getRoamingArea } from '@/constants/roamingAreas';
import { MONSTERS } from '@/constants/monsters';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import type { PhaseAnalysis } from '@/types/boss';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

describe('P4 wave 1 — data maps cover the whole game', () => {
  it('every roaming area resolves a pixel background sprite', () => {
    for (const area of ROAMING_AREAS) {
      const spriteId = pixelBackgroundForArea(area.id);
      expect(spriteId, `area ${area.id} has no pixel background`).toBeTruthy();
      expect(getPixelSprite(spriteId!)?.kind).toBe('background');
    }
  });

  it('every monster archetype the game fields resolves an enemy sprite', () => {
    const fielded = new Set(MONSTERS.map((m) => m.archetype));
    // The roster fields five families today; the map also covers 'boss'.
    expect([...fielded].sort()).toEqual(['brute', 'elite', 'fodder', 'runner', 'sniper']);
    for (const archetype of Object.keys(PIXEL_ENEMY_SPRITES) as (keyof typeof PIXEL_ENEMY_SPRITES)[]) {
      const spriteId = pixelEnemySpriteForArchetype(archetype);
      expect(spriteId, `archetype ${archetype} has no pixel sprite`).toBeTruthy();
      expect(getPixelSprite(spriteId!)?.kind).toBe('enemy');
    }
    expect(pixelEnemySpriteForArchetype('brute')).toBe('brute');
    expect(pixelEnemySpriteForArchetype(undefined)).toBeUndefined();
  });

  it('every Region 1 boss resolves a bespoke boss sprite', () => {
    expect(Object.keys(PIXEL_BOSS_SPRITES).sort()).toEqual(REGION_1_BOSSES.map((b) => b.id).sort());
    for (const boss of REGION_1_BOSSES) {
      const spriteId = pixelBossSpriteForBoss(boss.id);
      expect(spriteId, `boss ${boss.id} has no pixel sprite`).toBeTruthy();
      expect(getPixelSprite(spriteId!)?.kind).toBe('enemy');
    }
    expect(pixelBossSpriteForBoss('not_a_boss')).toBeUndefined();
    expect(pixelBossSpriteForBoss(undefined)).toBeUndefined();
  });
});

const PHASES: PhaseAnalysis[] = ['Ignition', 'Shield Wall'].map((phaseName, i) => ({
  phaseId: `phase-${i + 1}`,
  phaseName,
  score: 0.8,
  status: 'safe' as const,
  currentAnswers: ['weapon'],
  missingCounters: [],
  relevantConsumables: [],
  explanation: 'Test phase',
}));

const victoryOutcome: FightOutcome = {
  result: { victory: true, winChance: 0.75, bossHpRemaining: 0 },
  creditsDelta: 1500,
  bonusLootRolls: 1,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
};

const midFightTimeline = (): FightTimeline => {
  const base = buildInitialTimeline(victoryOutcome, 1000, 5, 0);
  return {
    ...base,
    currentPhaseIndex: 0,
    bossHp: 750,
    playerHp: 260,
    damageLog: [{ id: 'b-0', target: 'boss', value: 250, phaseName: 'Ignition' }],
  };
};

describe('BossFightStage — bespoke boss sprites (P4 wave 1)', () => {
  it('stages the challenged boss’s own sprite when given its id', () => {
    render(<BossFightStage timeline={midFightTimeline()} phases={PHASES} bossId="dune_tyrant" />);
    expect(screen.getByTestId('boss-stage-boss').getAttribute('data-sprite')).toBe('boss-dune-tyrant');
  });

  it('falls back to the brute without a boss id or for an unknown one', () => {
    const { unmount } = render(<BossFightStage timeline={midFightTimeline()} phases={PHASES} />);
    expect(screen.getByTestId('boss-stage-boss').getAttribute('data-sprite')).toBe('brute');
    unmount();
    render(<BossFightStage timeline={midFightTimeline()} phases={PHASES} bossId="not_a_boss" />);
    expect(screen.getByTestId('boss-stage-boss').getAttribute('data-sprite')).toBe('brute');
  });
});

describe('LiveTurfDiorama — enemy sprite resolves from game data (P4 wave 1)', () => {
  afterEach(() => {
    useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
  });

  it('shows the current target’s archetype sprite while roaming', () => {
    // ironwood_ranger is the Bastion's sniper-archetype monster.
    // Overhaul: roaming enemies render as segmented rigs (brief §4.3),
    // so the contract is the rig id + its segment sprites, not a
    // single data-sprite actor.
    useKillCycleStore.setState({ currentTargetId: 'ironwood_ranger', currentTargetHp: 90, currentTargetHpMax: 180 });
    render(<LiveTurfDiorama area={getRoamingArea('ironwood_bastion')} activityKind="roaming_loot" />);
    const enemy = screen.getByTestId('pixel-enemy');
    expect(enemy.getAttribute('data-rig')).toBe('enemy-sniper');
    expect(enemy.querySelectorAll('img').length).toBeGreaterThanOrEqual(4);
  });

  it('shows the brute when no target is active (standing fallback)', () => {
    render(<LiveTurfDiorama area={getRoamingArea('throwtech_dumpnet')} activityKind="roaming_loot" />);
    expect(screen.getByTestId('pixel-enemy').getAttribute('data-rig')).toBe('enemy-brute');
  });

  it('renders the pixel stage for a boss-fight diorama (boss scene plumbing in place)', () => {
    // NOTE: the diorama's parent derives its scene mode from activityKind
    // alone today (bossPhase is not forwarded to modeFromActivity — a
    // pre-existing behavior shared with the vector scene), so a boss_fight
    // diorama presents the prep scene here. The scene layer's boss-sprite
    // resolution (bossSpriteId prop) activates with that mode; the live
    // boss surface, BossFightStage, is covered above.
    render(
      <LiveTurfDiorama
        area={getRoamingArea('dustwaste_frontier')}
        activityKind="boss_fight"
        bossPhase="fight"
        bossName="Gromm, the Heap Guard"
      />,
    );
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
  });
});
