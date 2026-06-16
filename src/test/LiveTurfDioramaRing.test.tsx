import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';

const weapon = { id: 'w1', name: 'Test Gun' } as unknown as Weapon;
const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);

describe('LiveTurfDiorama consumable ring + activity binding', () => {
  it('renders the consumable ring', () => {
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
    expect(screen.getByTestId('hud-consumable-ring')).toBeInTheDocument();
  });

  it('passes activityKind down to CharacterStatBar for rotating chips', () => {
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
    // crafting → craftingSpeed is in the headline
    expect(screen.getByTestId('hud-metric-craftingSpeed')).toBeInTheDocument();
  });
});
