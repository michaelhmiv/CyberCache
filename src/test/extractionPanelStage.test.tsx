/**
 * One-stage law (owner ruling 2026-11-04) — the Extraction
 * workspace panel carries NO animated scene.
 *
 * The owner's screenshot: the Home stage playing his boss scene
 * up top, and below it the Extraction workspace rendering its
 * OWN full animated scene (paused desert panorama, hunter, pass
 * progress) — two living scenes stacked on one screen. Home has
 * exactly ONE animated stage: the diorama, which now carries
 * the extraction scene while extraction is the active action
 * (pinned in pixelDiorama.test.tsx). The panel keeps the scene's
 * information — pass state, time left, expected draws/XP,
 * progress — in a compact STILL poster header: the site's
 * backdrop plate as a plain image, no actors, no PixelStage.
 *
 * Pins:
 *  - No scene machinery renders inside the panel in any pass
 *    state (no extraction-scene, no pixel-stage, no actors).
 *  - The static header prints the cause line for each state:
 *    unclaimed / active (time left) / paused (pennant + paused
 *    at), plus the preview's draws/XP and the progress bar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getExtractionState: vi.fn(),
}));
vi.mock('@/lib/api/activityService', () => ({
  startActiveActivity: vi.fn(async () => ({})),
}));

import { ExtractionPanel } from '@/components/fight/ExtractionPanel';
import { getExtractionState } from '@/lib/chef/chefClient';
import type { ChefExtractionState } from '@/lib/chef/chefClient';

const baseState: ChefExtractionState = {
  active: false,
  hasState: false,
  areaId: null,
  method: 'surface',
  passAreaId: null,
  passMethod: 'surface',
  accruedMs: 0,
  passMs: 600_000,
  pendingPasses: 0,
  finalizedPasses: 0,
  totalXpAwarded: 0,
  mastery: { level: 1, xp: 0 },
  preview: {
    areaId: 'dustwaste_frontier',
    areaName: 'Dustwaste Frontier',
    method: 'surface',
    gearFactor: 1,
    survivalPool: 500,
    expectedPassDamage: 40,
    drawsPerPass: 32,
    xpPerPass: 120,
    deepDegraded: false,
    deepUnlocked: false,
    isHot: false,
  },
  settled: { advancedMs: 0, xpAwarded: 0, materials: {}, essences: {}, passes: [] },
};

const mockState = (state: ChefExtractionState) => {
  vi.mocked(getExtractionState).mockResolvedValue({ verified: true, extraction: state });
};

beforeEach(() => {
  vi.mocked(getExtractionState).mockReset();
});

describe('ExtractionPanel — one-stage law (2026-11-04)', () => {
  it('unclaimed: static header only — no scene, cause reads "No site claimed yet"', async () => {
    mockState(baseState);
    render(<ExtractionPanel />);
    const header = await screen.findByTestId('extraction-panel-header');
    expect(screen.getByTestId('extraction-panel-cause').textContent).toBe('No site claimed yet');
    // The still poster is a plain image — no stage machinery,
    // no actors, no animated scene anywhere in the panel.
    expect(header.querySelector('img')).toBeTruthy();
    expect(screen.queryByTestId('extraction-scene')).toBeNull();
    expect(screen.queryByTestId('pixel-stage')).toBeNull();
    expect(screen.queryByTestId('extraction-hunter')).toBeNull();
    expect(screen.queryByTestId('extraction-panel-paused')).toBeNull();
    // The preview's draws/XP — the scene's buys line — rides the header.
    expect(header.textContent).toContain('~32 draws · 120 XP');
  });

  it('active pass: header prints pass number, time left, and progress — still no scene', async () => {
    mockState({
      ...baseState,
      active: true,
      hasState: true,
      areaId: 'dustwaste_frontier',
      passAreaId: 'dustwaste_frontier',
      accruedMs: 150_000,
      finalizedPasses: 1,
    });
    render(<ExtractionPanel />);
    await screen.findByTestId('extraction-panel-header');
    // Pass 2 (1 finalized + 0 pending + 1), 7:30 of the 10:00 pass left.
    expect(screen.getByTestId('extraction-panel-cause').textContent).toBe('Pass 2 · 7:30 left');
    const bar = screen.getByRole('progressbar', { name: 'Pass progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.queryByTestId('extraction-scene')).toBeNull();
    expect(screen.queryByTestId('pixel-stage')).toBeNull();
    expect(screen.queryByTestId('extraction-panel-paused')).toBeNull();
  });

  it('paused (viewed while another action is active): pennant + "paused at" — the owner’s screenshot state', async () => {
    mockState({
      ...baseState,
      active: false,
      hasState: true,
      areaId: 'dustwaste_frontier',
      passAreaId: 'dustwaste_frontier',
      accruedMs: 150_000,
      finalizedPasses: 1,
    });
    render(<ExtractionPanel onLeave={() => {}} />);
    await screen.findByTestId('extraction-panel-header');
    expect(screen.getByTestId('extraction-panel-cause').textContent).toBe('Pass 2 · paused at 7:30 left');
    expect(screen.getByTestId('extraction-panel-paused')).toBeTruthy();
    expect(screen.queryByTestId('extraction-scene')).toBeNull();
    expect(screen.queryByTestId('pixel-stage')).toBeNull();
  });
});
