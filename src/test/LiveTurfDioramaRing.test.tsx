import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';

const weapon = { id: 'w1', name: 'Test Gun' } as unknown as Weapon;
const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);

describe('LiveTurfDiorama — visualization-only surface', () => {
  it('renders the SVG scene without the HUD overlays (ring, stat bar moved to DashboardScreen)', () => {
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
    // under the stage). With no title-click opener wired, the
    // stage renders no buttons at all; its furniture is the area
    // plate + the status ribbon (DESIGN.md §1).
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('diorama-stage-plate')).toBeTruthy();
    expect(screen.getByTestId('diorama-status-ribbon')).toBeTruthy();
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
    expect(screen.getByTestId('diorama-status-ribbon').textContent).toContain('Crafting');
  });
});
