import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CharacterStatBar } from '@/components/stats/CharacterStatBar';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
    { key: 'effectiveHp', label: 'Effective HP', value: 120, display: '120', detail: '', tone: 'cyan', contributions: [] },
    { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
    { key: 'shieldBreak', label: 'Shield Break', value: 30, display: '30', detail: '', tone: 'cyan', contributions: [] },
    { key: 'craftingSpeed', label: 'Craft Speed', value: 0.2, display: '+20%', detail: '', tone: 'amber', contributions: [] },
    { key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: '', tone: 'amber', contributions: [] },
  ],
};

describe('CharacterStatBar rotating chips', () => {
  it('renders the 4 combat-core chips when activityKind is undefined', () => {
    render(<CharacterStatBar summary={summary} activityKind={undefined} />);
    expect(screen.getByTestId('hud-metric-health')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-effectiveHp')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-dps')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-shieldBreak')).toBeInTheDocument();
  });

  it('still renders the combat-core chips when activityKind is "crafting"', () => {
    // Headline chips are now pinned to combat-core regardless of activity.
    render(<CharacterStatBar summary={summary} activityKind="crafting" />);
    expect(screen.getByTestId('hud-metric-health')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-effectiveHp')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-dps')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-shieldBreak')).toBeInTheDocument();
    // Activity-module sub-stats no longer appear in the headline chips.
    expect(screen.queryByTestId('hud-metric-craftingSpeed')).toBeNull();
  });

  it('shows an activity override indicator when overrideActivity is set', () => {
    const onChange = vi.fn();
    render(<CharacterStatBar summary={summary} activityKind="roaming_loot" overrideActivity="crafting" onChangeOverride={onChange} />);
    expect(screen.getByTestId('hud-activity-override')).toHaveTextContent(/crafting/i);
    // Headline chips stay combat-core even with override.
    expect(screen.getByTestId('hud-metric-health')).toBeInTheDocument();
    expect(screen.getByTestId('hud-metric-dps')).toBeInTheDocument();
  });

  it('does not show the override indicator when no onChangeOverride handler is provided', () => {
    render(<CharacterStatBar summary={summary} activityKind="roaming_loot" overrideActivity="crafting" />);
    // Without a handler, the dismiss affordance has nowhere to call — don't tease the user with a no-op X.
    expect(screen.queryByTestId('hud-activity-override')).toBeNull();
  });
});
