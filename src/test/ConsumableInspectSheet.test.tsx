import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsumableInspectSheet } from '@/components/consumables/ConsumableInspectSheet';
import { CONSUMABLES } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';

describe('ConsumableInspectSheet', () => {
  it('renders a decision brief with mechanic and visibility information', () => {
    render(
      <ConsumableInspectSheet
        consumable={CONSUMABLES[ConsumableType.AdrenalineShot]}
        open
        onClose={() => {}}
      />
    );
    const brief = screen.getByTestId('consumable-decision-brief');
    expect(brief).toHaveTextContent(/Decision Brief/i);
    expect(brief).toHaveTextContent(/Use When/i);
    expect(brief).toHaveTextContent(/Visibility/i);
    expect(brief).toHaveTextContent(/survival repair|survival boost/i);
  });
});
