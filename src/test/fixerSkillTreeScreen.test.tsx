/**
 * Fixer skill tree — the shipped SkillTreeScreen surface (Profile-embedded).
 *
 * The fourth tree renders with the same spend/affordance patterns
 * as the other trees: nodes render per tier, an affordable
 * prereq-free node trains through verifiedOps.trainSkill (the
 * server-authoritative op), and a gated node (the keystone, whose
 * majors are unmet) does not train on tap.
 *
 * Reshape slice (b): there is no tree selector on the stop — the
 * board binds to the FIELDED hunter's tree. This suite fields Doc
 * Sutter (the Fixer hunter) in the skill store, which is exactly
 * the state the Roster switch produces.
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
  // Doc Sutter fielded — his tree is the board (slice (b) binding).
  useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} }, activeHunterId: 'doc' });
});

afterEach(() => {
  cleanup();
});

describe('SkillTreeScreen — Fixer board (Doc Sutter fielded)', () => {
  // Render-heavy (the full board mounts every tree's motion components):
  // ~4s standalone, so the default 5s test timeout is too tight under
  // full-suite parallel load — explicit budget, same as other UI suites.
  it('renders the Fixer board with all tiers and trains through the verified op', async () => {
    render(<SkillTreeScreen embedded />);

    // The board is the fielded hunter's tree — no selector tap.
    expect(screen.getByText('Fixer Board')).toBeTruthy();
    expect(screen.getByText(/Doc Sutter's tree/)).toBeTruthy();

    // Nodes across the tree, smalls through the keystone. (A name can
    // render in both the node button and the detail affordance.)
    for (const name of [
      'Assembly Rhythm', 'Parallel Hands', 'Calibrated Eye',
      'Rig Tuning', "Appraiser's Eye", 'Master Artificer',
      'Fleet Engineer', 'House Brand', 'Second Shift', "Sutter's Hands",
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
    // but never trains. (Audit COPY-03: a lone tier node renders in
    // exactly one grid slot — it used to render twice.)
    fireEvent.click(screen.getAllByRole('button', { name: /Sutter's Hands/ })[0]);
    expect(mockTrain).toHaveBeenCalledTimes(1);
  }, 30_000);
});
