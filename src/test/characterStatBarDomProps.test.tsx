import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    {
      key: 'health',
      label: 'Health',
      value: 100,
      display: '100',
      detail: 'Base health',
      tone: 'green',
      contributions: [],
    },
    {
      key: 'dps',
      label: 'DPS',
      value: 10,
      display: '10',
      detail: 'Damage',
      tone: 'amber',
      contributions: [],
    },
    {
      key: 'boss',
      label: 'Boss',
      value: 5,
      display: '5',
      detail: 'Boss damage',
      tone: 'red',
      contributions: [],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CharacterStatBar DOM props', () => {
  it('does not leak internal HP props onto DOM nodes', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<CharacterStatBarBody summary={summary} currentHp={42} maxHp={100} />);

    expect(screen.getByTestId('hud-metric-health')).not.toHaveAttribute('currentHp');
    expect(screen.getByTestId('hud-metric-health')).not.toHaveAttribute('maxHp');
    expect(screen.getByText('Health')).toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('React does not recognize the `currentHp` prop'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('React does not recognize the `maxHp` prop'));
  });
});
