/**
 * Fixer skill tree — the shipped SkillTreeScreen surface (Profile-embedded).
 *
 * The fourth tree renders with the same spend/affordance patterns
 * as the other trees: nodes render per tier on the icon board, and
 * training runs through the node sheet — tap selects + opens the
 * sheet, the sheet's Spend button trains through
 * verifiedOps.trainSkill (the server-authoritative op). A gated
 * node (the keystone, whose majors are unmet) opens its sheet with
 * the spend disabled and never trains.
 *
 * Icon-tree build (owner-approved 2026-11-18): the board is icons,
 * not text cards — a node's name is its button's accessible name,
 * and the sheet is the only spend surface. This suite pins that
 * flow for the Fixer tree.
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

    // Nodes across the tree, smalls through the keystone — on the
    // icon board a node is a button carrying its name as the
    // accessible name (the glyph itself is the label's picture).
    for (const name of [
      'Assembly Rhythm', 'Parallel Hands', 'Calibrated Eye',
      'Rig Tuning', "Appraiser's Eye", 'Master Artificer',
      'Fleet Engineer', 'House Brand', 'Second Shift', "Sutter's Hands",
    ]) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
    expect(screen.getByText('Tier 9')).toBeTruthy();

    // A prereq-free small: tap opens its sheet (no spend yet), the
    // sheet's Spend trains optimistically + through the op.
    fireEvent.click(screen.getByRole('button', { name: /Assembly Rhythm/ }));
    expect(mockTrain).not.toHaveBeenCalled();
    const spend = await screen.findByRole('button', { name: 'Spend 1 Point' });
    fireEvent.click(spend);
    expect(mockTrain).toHaveBeenCalledTimes(1);
    expect(mockTrain).toHaveBeenCalledWith('fix_craft_time_1');
    await waitFor(() => {
      expect(screen.getByTestId('trees-node-sheet').textContent).toContain('1/5');
    });

    // The keystone is gated: its majors are unmet, so its sheet
    // opens with the spend disabled and never trains. (Audit
    // COPY-03: a lone tier node renders in exactly one grid slot —
    // it used to render twice; the board node testid pins the one
    // board rendering, distinct from the Next Unlock shortcut.)
    expect(screen.getAllByTestId('trees-icon-node-fix_keystone')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('trees-icon-node-fix_keystone'));
    const keystoneSpend = await screen.findByRole('button', { name: 'Spend 5 Points' });
    expect((keystoneSpend as HTMLButtonElement).disabled).toBe(true);
    expect(mockTrain).toHaveBeenCalledTimes(1);
  }, 30_000);
});
