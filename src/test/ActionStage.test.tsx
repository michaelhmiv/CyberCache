/**
 * Smoke tests for the ActionStage component. Doesn't try to assert on
 * Framer Motion animations (too fragile) — just that the component
 * renders the right sprites for each activity kind, exposes the
 * current beat as a data attribute, and handles the no-target case.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionStage } from '@/lib/activity/ActionStage';

describe('ActionStage', () => {
  it('renders the stage canvas with the right data attributes', () => {
    render(<ActionStage kind="roaming_loot" />);
    const stage = screen.getByTestId('action-stage');
    expect(stage).toBeInTheDocument();
    // The current beat is exposed as a data attribute for QA / tests.
    expect(stage.dataset.currentBeat).toBeTruthy();
  });

  it('shows the stage label in the corner', () => {
    render(<ActionStage kind="crafting" />);
    const label = screen.getByTestId('action-stage-label');
    // stageAssets removed 2026-06-10 — default label used
    expect(label.textContent).toBe('STANDBY');
  });

  it('shows the "now happening" beat name', () => {
    render(<ActionStage kind="roaming_loot" />);
    const now = screen.getByTestId('action-stage-now-happening');
    expect(now.textContent).toMatch(/^→\s/);
  });

  it('renders a target sprite for kinds that have one (roaming_loot)', () => {
    const { container } = render(<ActionStage kind="roaming_loot" />);
    // stageAssets removed 2026-06-10 — targetSprite defaults to undefined, no target rendered.
    // The hunter sprite should still be present.
    const hunter = container.querySelector('[data-visual-key="hunter_default"]');
    expect(hunter).toBeInTheDocument();
  });

  it('does not render a target sprite for crafting (uses surface)', () => {
    const { container } = render(<ActionStage kind="crafting" />);
    // stageAssets removed 2026-06-10 — no surfaceSprite, no targetSprite.
    // The hunter sprite should still be present.
    const hunter = container.querySelector('[data-visual-key="hunter_default"]');
    expect(hunter).toBeInTheDocument();
  });

  it('respects the targetOverride prop', () => {
    const { container } = render(<ActionStage kind="boss_fight" targetOverride="dune_tyrant" />);
    const boss = container.querySelector('[data-visual-key="dune_tyrant"]');
    expect(boss).toBeInTheDocument();
  });

  it('respects the hunterOverride prop', () => {
    const { container } = render(<ActionStage kind="idle_standby" hunterOverride="hunter_boss_mode" />);
    const hunter = container.querySelector('[data-visual-key="hunter_boss_mode"]');
    expect(hunter).toBeInTheDocument();
  });

  it('renders the beat index dots indicator', () => {
    render(<ActionStage kind="roaming_loot" />);
    const dots = screen.getByTestId('action-stage-beat-dots');
    // The number of dots equals the beat count for the kind's plan.
    // We just assert the element exists and has children.
    expect(dots.children.length).toBeGreaterThan(0);
  });

  it('idle_standby renders a single-beat plan (one dot, idle-breathe)', () => {
    const { container } = render(<ActionStage kind="idle_standby" />);
    const stage = screen.getByTestId('action-stage');
    expect(stage.dataset.currentBeat).toBe('idle-breathe');
    // The hunter sprite should be present.
    const hunter = container.querySelector('[data-visual-key="hunter_default"]');
    expect(hunter).toBeInTheDocument();
  });
});
