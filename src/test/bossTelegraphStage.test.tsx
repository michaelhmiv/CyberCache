/**
 * Boss special telegraphs — slice C3, stage rendering.
 *
 * The DOM boss stage (the Pixi stage's fallback twin, rendering the
 * identical treatment through the shared SpecialTelegraphFx) mounts
 * the big-attack warning on the phase the cadence schedule assigns
 * the special to, and only there: the harness fixture fight (Dune
 * Tyrant, 'Sand Slam' every 18s over 5 presented phases) specials
 * phase index 3 — phases 0–2 and the death phase keep the generic
 * telegraph or none.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { FIXTURE_PHASES, FIXTURE_WEAPON, freezeSnapshot } from '@/harness/fightFixture';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

describe('BossFightStageDom — C3 special telegraph', () => {
  it('the special phase mounts the name callout, charge glow, and danger ring — and not the generic glow', () => {
    render(
      <BossFightStageDom
        timeline={freezeSnapshot(3)}
        phases={FIXTURE_PHASES}
        bossId="dune_tyrant"
        weapon={FIXTURE_WEAPON}
      />,
    );
    const callout = screen.getByTestId('boss-special-telegraph');
    expect(callout.textContent).toContain('Sand Slam');
    expect(screen.getByTestId('boss-special-charge')).toBeTruthy();
    expect(screen.getByTestId('boss-special-danger')).toBeTruthy();
    expect(screen.queryByTestId('fx-telegraph')).toBeNull();
  });

  it('a light counter phase keeps the generic telegraph and mounts no special warning', () => {
    render(
      <BossFightStageDom
        timeline={freezeSnapshot(0)}
        phases={FIXTURE_PHASES}
        bossId="dune_tyrant"
        weapon={FIXTURE_WEAPON}
      />,
    );
    expect(screen.getByTestId('fx-telegraph')).toBeTruthy();
    expect(screen.queryByTestId('boss-special-telegraph')).toBeNull();
    expect(screen.queryByTestId('boss-special-danger')).toBeNull();
    expect(screen.queryByTestId('boss-special-charge')).toBeNull();
  });

  it('a cadence-less presentation (no boss id) never mounts a special warning', () => {
    render(
      <BossFightStageDom timeline={freezeSnapshot(3)} phases={FIXTURE_PHASES} weapon={FIXTURE_WEAPON} />,
    );
    expect(screen.queryByTestId('boss-special-telegraph')).toBeNull();
  });
});
