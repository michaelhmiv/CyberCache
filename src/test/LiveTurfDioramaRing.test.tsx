import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';

const weapon = { id: 'w1', name: 'Test Gun' } as unknown as Weapon;
const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);

describe('LiveTurfDiorama — visualization-only surface', () => {
  it('renders the SVG scene without the HUD overlays (ring, stat bar moved to DashboardScreen)', { timeout: 20_000 }, () => {
    render(
      <LiveTurfDiorama
        area={area}
        weapon={weapon}
        playerLevel={5}
        equippedCount={3}
       
        activityKind="roaming_loot"
       
       
      />
    );
    // The consumable ring and stat bar are now in DashboardScreen, not the diorama
    expect(screen.queryByTestId('active-buff-pills')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hunter-totals-bar')).not.toBeInTheDocument();
    // Diorama still renders its core SVG scene (at least one role="img")
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
    // Drift-fix F2: the stage is visualization-only — the in-stage
    // action bar is gone (the mode's actions live in the workspace
    // under the stage). The stage renders no buttons at all; its
    // furniture is the count plate (DESIGN.md §1) — the area plate
    // that once shared the top row was removed from the scene by
    // owner ruling 2026-11-02, and the status ribbon was retired
    // by the 2026-11-03 consolidation (the hero rundown attaches
    // to the stage's foot in the screen's flow, not in here).
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('diorama-stage-plate')).toBeNull();
    expect(screen.queryByTestId('diorama-status-ribbon')).toBeNull();
  });

  it('renders the SVG scene cleanly with crafting activityKind (no stat bar inside)', () => {
    render(
      <LiveTurfDiorama
        area={area}
        weapon={weapon}
        playerLevel={5}
        equippedCount={3}
       
        activityKind="crafting"
       
       
      />
    );
    // crafting metrics now live in DashboardScreen — not inside the diorama
    expect(screen.queryByTestId('hud-metric-craftingSpeed')).not.toBeInTheDocument();
    // Diorama still renders its core SVG scene
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
    // No in-stage action bar in any mode (drift-fix F2).
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // No ribbon, and the mode word prints nowhere on the stage
    // (consolidation 2026-11-03): the scene says it.
    expect(screen.queryByTestId('diorama-status-ribbon')).toBeNull();
    expect(document.body.textContent).not.toContain('Crafting');
  });
});
