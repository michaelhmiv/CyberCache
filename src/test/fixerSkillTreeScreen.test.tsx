/**
 * Fixer skill tree — the shipped SkillTreeScreen surface (Profile-embedded).
 *
 * The fourth tree must appear as a tab with the same spend/affordance
 * patterns as the other trees: nodes render per tier, an affordable
 * prereq-free node trains through verifiedOps.trainSkill (the
 * server-authoritative op), and a gated node (the keystone, whose
 * majors are unmet) does not train on tap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
  },
}));

import { SkillTreeScreen } from '@/screens/SkillTreeScreen';
import { usePlayerStore, useSkillStore } from '@/store';
import { verifiedOps } from '@/lib/api/verifiedOps';

const mockTrain = vi.mocked(verifiedOps.trainSkill);

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ level: 30, credits: 100_000 });
  useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });
});

afterEach(() => {
  cleanup();
});

describe('SkillTreeScreen — Fixer tab', () => {
  // Render-heavy (the full board mounts every tree's motion components):
  // ~4s standalone, so the default 5s test timeout is too tight under
  // full-suite parallel load — explicit budget, same as other UI suites.
  it('renders the Fixer board with all tiers and trains through the verified op', async () => {
    render(<SkillTreeScreen embedded />);

    // The Fixer tab exists alongside the three shipped trees.
    fireEvent.click(screen.getByRole('button', { name: /Crafting, repair, vehicles, trade/ }));
    expect(screen.getByText('Fixer Board')).toBeTruthy();

    // Nodes across the tree, smalls through the keystone. (A name can
    // render in both the node button and the detail affordance.)
    for (const name of [
      'Assembly Rhythm', 'Parallel Hands', 'Calibrated Eye',
      'Rig Tuning', "Appraiser's Eye", 'Master Artificer',
      'Fleet Engineer', 'House Brand', 'Second Shift', 'The Fixer',
    ]) {
      expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
    }
    expect(screen.getByText('Tier 9')).toBeTruthy();

    // A prereq-free small trains optimistically + through the op.
    fireEvent.click(screen.getByRole('button', { name: /Assembly Rhythm/ }));
    expect(mockTrain).toHaveBeenCalledTimes(1);
    expect(mockTrain).toHaveBeenCalledWith('fix_craft_time_1');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Assembly Rhythm/ }).textContent).toContain('1/5');
    });

    // The keystone is gated: its majors are unmet, so a tap selects
    // but never trains. (The shipped board renders a lone tier node
    // in two grid slots — same for every tree's keystone.)
    fireEvent.click(screen.getAllByRole('button', { name: /The Fixer/ })[0]);
    expect(mockTrain).toHaveBeenCalledTimes(1);
  }, 30_000);
});
