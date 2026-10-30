/**
 * Phase 0 Slice 5 — UN-SUPPRESS & ALIGN, client half.
 *
 * Respec: cc_retrain always worked server-side, but SkillTreeScreen
 * is only ever rendered embedded in Profile, and the embedded render
 * suppressed the header + stats that held the Respec button and the
 * points summary — no player could ever respec. This test renders
 * the embedded view the way Profile does, with the verified-op mocked
 * to perform the same store sync the real op performs
 * (syncVerifiedResult applies the returned profile's skill_spends),
 * and proves the button is exposed with its cost and that completing
 * a respec refunds the points in the UI. The refund itself (credits
 * charged, spends zeroed) is proven at the route level in
 * chefWrites.test.ts ('trains within budget... then retrain refunds
 * points for credits').
 *
 * Mastery: the Profile Mastery section is masteryService's first UI
 * caller. With the service mocked to return rows, the section must
 * render each mastery's label, level, and XP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
  },
}));

vi.mock('@/lib/api/masteryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/masteryService')>();
  return { ...actual, getMyMasterySummary: vi.fn(async () => []) };
});

import { SkillTreeScreen } from '@/screens/SkillTreeScreen';
import { MasterySection } from '@/components/profile/MasterySection';
import { usePlayerStore, useSkillStore } from '@/store';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { getMyMasterySummary, masteryLevelProgress, type MasterySummaryRow } from '@/lib/api/masteryService';

const mockRetrain = vi.mocked(verifiedOps.retrain);
const mockSummary = vi.mocked(getMyMasterySummary);

beforeEach(() => {
  vi.clearAllMocks();
  // Level 6 -> 5 points earned; 3 spent on Calibrated Iron.
  usePlayerStore.setState({ level: 6, credits: 1000 });
  useSkillStore.setState({ spent: { gs_dmg_1: 3 }, classModBoosts: { nodeBoosts: {} } });
});

afterEach(() => {
  cleanup();
});

describe('embedded Skill Trees (Profile) — respec reachable', () => {
  it('exposes the Respec button with its cost and the points summary', () => {
    render(<SkillTreeScreen embedded />);
    expect(screen.getByRole('button', { name: /respec/i })).toBeTruthy();
    // Cost = total spent x 100cr, the cc_retrain rule.
    expect(screen.getByText('300cr')).toBeTruthy();
    expect(screen.getByText('Respec refunds every spent point for 300cr.')).toBeTruthy();
  });

  it('completing a respec refunds the points in the UI via the profile sync', async () => {
    // The real op posts to /api/ops/retrain and syncVerifiedResult
    // then applies the returned profile (skill_spends = {}) to the
    // skill store. Mirror exactly that state transition.
    mockRetrain.mockImplementation(async () => {
      useSkillStore.setState({ spent: {} });
      return {};
    });

    render(<SkillTreeScreen embedded />);
    expect(screen.getByText('Spent').nextSibling?.textContent).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: /respec/i }));
    expect(mockRetrain).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByText('Spent').nextSibling?.textContent).toBe('0');
    });
    // All 5 earned points are available again, and respec is now free.
    expect(screen.getByText('Available').nextSibling?.textContent).toBe('5');
    expect(screen.getByText('Respec refunds every spent point for 0cr.')).toBeTruthy();
  });
});

describe('Profile Mastery section — renders the service rows', () => {
  it('lists each earned mastery with level and XP', async () => {
    const rows: MasterySummaryRow[] = [
      { mastery_id: 'locations.redline_circuit', category: 'locations', label: 'Redline Circuit Mastery', mastery_xp: 250, mastery_level: 2, rank: 1 },
      { mastery_id: 'weapons.pistol', category: 'weapons', label: 'Pistol Mastery', mastery_xp: 40, mastery_level: 1, rank: 0 },
    ];
    mockSummary.mockResolvedValue(rows);

    render(<MasterySection />);

    await waitFor(() => {
      expect(screen.getAllByTestId('mastery-row')).toHaveLength(2);
    });
    expect(screen.getByText('Redline Circuit Mastery')).toBeTruthy();
    expect(screen.getByText('Pistol Mastery')).toBeTruthy();
    expect(screen.getByText(/· 250 XP/)).toBeTruthy();
    expect(screen.getByText(/· 40 XP/)).toBeTruthy();
    // 250 XP on the server curve: level 2, 150 of 400 toward level 3.
    expect(screen.getByText(/150 \/ 400 XP to level 3/)).toBeTruthy();
  });

  it('shows the empty state before any mastery is earned', async () => {
    mockSummary.mockResolvedValue([]);
    render(<MasterySection />);
    await waitFor(() => {
      expect(screen.getByText(/No mastery earned yet/)).toBeTruthy();
    });
  });
});

describe('masteryLevelProgress — mirrors cc_mastery_level thresholds', () => {
  it('computes in-level progress on the L^2 x 100 curve', () => {
    expect(masteryLevelProgress(0)).toEqual({ intoLevel: 0, levelSpan: 100, fraction: 0 });
    expect(masteryLevelProgress(99)).toEqual({ intoLevel: 99, levelSpan: 100, fraction: 0.99 });
    expect(masteryLevelProgress(100)).toEqual({ intoLevel: 0, levelSpan: 400, fraction: 0 });
    expect(masteryLevelProgress(250)).toEqual({ intoLevel: 150, levelSpan: 400, fraction: 0.375 });
    // Level 3 starts at 100 + 400 = 500; level 4 at 500 + 900 = 1400.
    expect(masteryLevelProgress(1400)).toEqual({ intoLevel: 0, levelSpan: 1600, fraction: 0 });
  });
});
