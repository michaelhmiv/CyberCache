import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CharacterStatBar } from '@/components/stats/CharacterStatBar';
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

describe('CharacterStatBar rotating chips', () => {
  it('renders the 4 universal chips when activityKind is undefined', () => {
    render(<CharacterStatBar summary={summary} activityKind={undefined} />);
    expect(screen.getByTestId('hud-metric-health')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-dps')).toBeInTheDocument();
  });

  it('renders crafting chips when activityKind is "crafting"', () => {
    render(<CharacterStatBar summary={summary} activityKind="crafting" />);
    // Universal chips are NOT shown — crafting's roster is shown instead.
    expect(screen.queryByTestId('hud-metric-health')).toBeNull();
    expect(screen.getByTestId('hud-metric-craftingSpeed')).toBeInTheDocument();
  });

  it('shows an activity override indicator when overrideActivity is set', () => {
    const onChange = vi.fn();
    render(<CharacterStatBar summary={summary} activityKind="roaming_loot" overrideActivity="crafting" onChangeOverride={onChange} />);
    expect(screen.getByTestId('hud-activity-override')).toHaveTextContent(/crafting/i);
    // The override should switch the chip set to the override activity's roster, not the current activity's.
    expect(screen.getByTestId('hud-metric-craftingSpeed')).toBeInTheDocument();
  });

  it('does not show the override indicator when no onChangeOverride handler is provided', () => {
    render(<CharacterStatBar summary={summary} activityKind="roaming_loot" overrideActivity="crafting" />);
    // Without a handler, the dismiss affordance has nowhere to call — don't tease the user with a no-op X.
    expect(screen.queryByTestId('hud-activity-override')).toBeNull();
  });
});
