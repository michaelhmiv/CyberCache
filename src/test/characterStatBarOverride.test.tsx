import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
    { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
    { key: 'craftingSpeed', label: 'Craft Speed', value: 0.2, display: '+20%', detail: '', tone: 'amber', contributions: [] },
    { key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: '', tone: 'amber', contributions: [] },
  ],
};

describe('CharacterStatBarBody cycle affordance', () => {
  it('does NOT show the cycle button when no onCycleActivity handler is provided', () => {
    render(<CharacterStatBarBody summary={summary} activityKind="roaming_loot" />);
    // No handler → no affordance — don't tease the user with a no-op click target.
    expect(screen.queryByTestId('hud-cycle-activity')).toBeNull();
  });

  it('shows the cycle button when onCycleActivity is provided and no override is active', () => {
    const onCycle = vi.fn();
    render(
      <CharacterStatBarBody
        summary={summary}
        activityKind="roaming_loot"
        onChangeOverride={vi.fn()}
        onCycleActivity={onCycle}
      />,
    );
    const cycleBtn = screen.getByTestId('hud-cycle-activity');
    expect(cycleBtn).toBeInTheDocument();
    expect(cycleBtn.tagName).toBe('BUTTON');
  });

  it('calls onCycleActivity exactly once when the cycle button is clicked', () => {
    const onCycle = vi.fn();
    render(
      <CharacterStatBarBody
        summary={summary}
        activityKind="roaming_loot"
        onChangeOverride={vi.fn()}
        onCycleActivity={onCycle}
      />,
    );
    fireEvent.click(screen.getByTestId('hud-cycle-activity'));
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it('does NOT show the cycle button when an override is already active (X-button takes over)', () => {
    const onCycle = vi.fn();
    const onChange = vi.fn();
    render(
      <CharacterStatBarBody
        summary={summary}
        activityKind="roaming_loot"
        overrideActivity="crafting"
        onChangeOverride={onChange}
        onCycleActivity={onCycle}
      />,
    );
    // Override indicator is visible → cycle is hidden. The X is the only affordance.
    expect(screen.getByTestId('hud-activity-override')).toBeInTheDocument();
    expect(screen.queryByTestId('hud-cycle-activity')).toBeNull();
  });
});