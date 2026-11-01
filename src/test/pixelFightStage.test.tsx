import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { buildInitialTimeline, type FightOutcome, type FightTimeline } from '@/lib/animation/fightTimeline';
import type { PhaseAnalysis } from '@/types/boss';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const PHASES: PhaseAnalysis[] = ['Ignition', 'Shield Wall', 'Overdrive', 'Core Breach'].map((phaseName, i) => ({
  phaseId: `phase-${i + 1}`,
  phaseName,
  score: 0.8,
  status: 'safe' as const,
  currentAnswers: ['weapon'],
  missingCounters: [],
  relevantConsumables: [],
  explanation: 'Test phase',
}));

const outcome = (victory: boolean): FightOutcome => ({
  result: { victory, winChance: 0.75, bossHpRemaining: victory ? 0 : 42 },
  creditsDelta: victory ? 1500 : -250,
  bonusLootRolls: victory ? 1 : 0,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
});

const midFightTimeline = (victory: boolean): FightTimeline => {
  const base = buildInitialTimeline(outcome(victory), 1000, 5, 0);
  return {
    ...base,
    currentPhaseIndex: 0,
    bossHp: 750,
    playerHp: 260,
    damageLog: [
      { id: 'b-0', target: 'boss', value: 250, phaseName: 'Ignition' },
      { id: 'p-0', target: 'player', value: 60, phaseName: 'Ignition' },
    ],
  };
};

describe('BossFightStage (P2 movement system)', () => {
  it('renders both actors on the pixel stage during a fight', () => {
    render(<BossFightStage timeline={midFightTimeline(true)} phases={PHASES} />);
    expect(screen.getByTestId('boss-fight-stage')).toBeTruthy();
    expect(screen.getByTestId('boss-fight-pixel-stage')).toBeTruthy();
    expect(screen.getByTestId('boss-stage-hunter')).toBeTruthy();
    expect(screen.getByTestId('boss-stage-boss')).toBeTruthy();
  });

  it('stages the phase exchange from the timeline damage log: shot FX + damage number', () => {
    render(<BossFightStage timeline={midFightTimeline(true)} phases={PHASES} />);
    expect(screen.getByTestId('boss-fight-beats')).toBeTruthy();
    expect(screen.getByTestId('fx-muzzle-flash')).toBeTruthy();
    expect(screen.getByTestId('fx-tracer')).toBeTruthy();
    expect(screen.getByTestId('fx-shell-casing')).toBeTruthy();
    expect(screen.getByTestId('fx-impact-sparks')).toBeTruthy();
    // 250 of 1000 max HP = 25% ≥ crit fraction → oversized crit number + flash.
    expect(screen.getByTestId('fx-damage-number-crit')).toBeTruthy();
    expect(screen.getByTestId('fx-crit-flash')).toBeTruthy();
    // The boss answers: telegraph glow for the counter.
    expect(screen.getByTestId('fx-telegraph')).toBeTruthy();
  });

  it('a small hit renders a normal (non-crit) damage number and no crit flash', () => {
    const timeline = midFightTimeline(true);
    timeline.damageLog = [{ id: 'b-0', target: 'boss', value: 40, phaseName: 'Ignition' }];
    render(<BossFightStage timeline={timeline} phases={PHASES} />);
    expect(screen.getByTestId('fx-damage-number')).toBeTruthy();
    expect(screen.queryByTestId('fx-crit-flash')).toBeNull();
  });

  it('the killing phase adds the death dust ring', () => {
    const timeline = { ...midFightTimeline(true), currentPhaseIndex: 3, bossHp: 0 };
    timeline.damageLog = [{ id: 'b-3', target: 'boss', value: 300, phaseName: 'Core Breach' }];
    render(<BossFightStage timeline={timeline} phases={PHASES} />);
    expect(screen.getByTestId('fx-dust-ring')).toBeTruthy();
  });

  it('finished victory shows the banner and no live beat layer', () => {
    const timeline = { ...midFightTimeline(true), currentPhaseIndex: 4, bossHp: 0, finishedAt: performance.now() };
    render(<BossFightStage timeline={timeline} phases={PHASES} />);
    const banner = screen.getByTestId('boss-fight-banner');
    expect(banner.textContent).toContain('Victory');
    expect(screen.queryByTestId('boss-fight-beats')).toBeNull();
  });

  it('finished defeat shows the defeat banner', () => {
    const timeline = { ...midFightTimeline(false), currentPhaseIndex: 4, playerHp: 0, finishedAt: performance.now() };
    render(<BossFightStage timeline={timeline} phases={PHASES} />);
    expect(screen.getByTestId('boss-fight-banner').textContent).toContain('Defeated');
  });

  it('reduced motion: actors and banner still render, FX and embers do not', () => {
    const timeline = { ...midFightTimeline(true), currentPhaseIndex: 4, bossHp: 0, finishedAt: performance.now() };
    render(<BossFightStage timeline={timeline} phases={PHASES} reduced />);
    expect(screen.getByTestId('boss-stage-hunter')).toBeTruthy();
    expect(screen.getByTestId('boss-stage-boss')).toBeTruthy();
    expect(screen.getByTestId('boss-fight-banner')).toBeTruthy();
    expect(screen.queryByTestId('boss-fight-beats')).toBeNull();
    expect(screen.queryByTestId('fx-embers')).toBeNull();
    // This stage's hunter carries no weapon, so the real-item
    // invariant renders the gun-free rig (no entrance choreography)
    // instead of the baked-gun whole sprite.
    expect(screen.getByTestId('boss-stage-hunter').getAttribute('data-rig')).toBe('hunter-unarmed');
  });
});

describe('GhostHpBar', () => {
  it('renders a real fill and a ghost fill at the same pct', () => {
    render(<GhostHpBar pct={62} color="#F87171" testId="ghb" />);
    const real = screen.getByTestId('ghb-real');
    const ghost = screen.getByTestId('ghb-ghost');
    expect(real).toBeTruthy();
    expect(ghost).toBeTruthy();
    expect(real.style.background).toBe('rgb(248, 113, 113)');
  });

  it('clamps out-of-range pcts', () => {
    render(<GhostHpBar pct={140} color="#fff" testId="ghb2" />);
    expect(screen.getByTestId('ghb2')).toBeTruthy();
  });
});
