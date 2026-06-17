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
        cacheKeys={0}
        activityKind="roaming_loot"
        onFight={() => {}}
        onSecondary={() => {}}
      />
    );
    // The consumable ring and stat bar are now in DashboardScreen, not the diorama
    expect(screen.queryByTestId('active-buff-pills')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hunter-totals-bar')).not.toBeInTheDocument();
    // Diorama still renders its core SVG scene (at least one role="img")
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
    // Bottom action buttons still render
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the SVG scene cleanly with crafting activityKind (no stat bar inside)', () => {
    render(
      <LiveTurfDiorama
        area={area}
        weapon={weapon}
        playerLevel={5}
        equippedCount={3}
        cacheKeys={0}
        activityKind="crafting"
        onFight={() => {}}
        onSecondary={() => {}}
      />
    );
    // crafting metrics now live in DashboardScreen — not inside the diorama
    expect(screen.queryByTestId('hud-metric-craftingSpeed')).not.toBeInTheDocument();
    // Diorama still renders its core SVG scene
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
    // Bottom action buttons still render (2 buttons)
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  });
});
