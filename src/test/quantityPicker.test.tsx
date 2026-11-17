/**
 * QuantityPicker (device-pass fix round, 2026-11-17) — the vendor
 * buy picker's core, shared:
 *
 *  - craftUnitsMax is the crafting MAX analogue (audit §7b): the
 *    per-job ceiling and the scarcest input bind; credits never do;
 *    the catalyst stock binds only while the toggle is on.
 *  - The picker component keeps the vendor grammar: chips past the
 *    max are disabled, never hidden; MAX and the slider agree.
 *  - The recipe card wires the picker to its own cost figures:
 *    MAX on the Med Kit card equals the helper's output for the
 *    card's resolved inputs, and QUEUE JOB carries the picked
 *    units through the existing enqueue op.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuantityPicker } from '../components/vendor/QuantityPicker';
import { craftUnitsMax } from '../lib/workshop/craftQuantity';
import { WorkshopScreen } from '../screens/WorkshopScreen';
import { usePlayerStore, useWorkshopStore } from '../store';
import { ALL_CRAFT_RECIPES } from '../content/crafting';
import { resolvedRecipeInputs } from '../lib/workshop/recipeCosts';

// jsdom has no IntersectionObserver; ChipRail needs one. Same stub
// shape as workshopDirectionAScreen.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return {
    ...actual,
    getStandingState: vi.fn(async () => ({ standing: { manufacturers: [] } })),
    getResearchState: vi.fn(async () => ({
      research: {
        courses: [{ id: 'production_systems', status: 'available' }],
      },
    })),
    getActionSkillState: vi.fn(async () => {
      throw new Error('no action skill state in tests');
    }),
  };
});

describe('craftUnitsMax — the crafting MAX analogue', () => {
  it('defaults to the per-job ceiling of 500 when nothing binds', () => {
    expect(craftUnitsMax({ inputs: [], catalystPerUnit: false, catalystHave: 0 })).toBe(500);
  });

  it('a recipe maxUnits caps below the ceiling', () => {
    expect(
      craftUnitsMax({ recipeMaxUnits: 50, inputs: [{ per: 1, have: 10_000 }], catalystPerUnit: false, catalystHave: 0 }),
    ).toBe(50);
  });

  it('the scarcest input binds: floor(have / per) per input, min wins', () => {
    expect(
      craftUnitsMax({
        inputs: [
          { per: 40, have: 1000 },
          { per: 8, have: 100 },
        ],
        catalystPerUnit: false,
        catalystHave: 0,
      }),
    ).toBe(12);
  });

  it('the catalyst stock binds only while the catalyst is on', () => {
    const base = { inputs: [{ per: 1, have: 1000 }], catalystHave: 3 };
    expect(craftUnitsMax({ ...base, catalystPerUnit: true })).toBe(3);
    expect(craftUnitsMax({ ...base, catalystPerUnit: false })).toBe(500);
  });

  it('a zero-cost input never binds, and an empty stock reads 0', () => {
    expect(craftUnitsMax({ inputs: [{ per: 0, have: 0 }], catalystPerUnit: false, catalystHave: 0 })).toBe(500);
    expect(craftUnitsMax({ inputs: [{ per: 2, have: 0 }], catalystPerUnit: false, catalystHave: 0 })).toBe(0);
  });
});

describe('QuantityPicker — the shared picker grammar', () => {
  it('chips past the max are disabled, MAX and slider drive onChange', () => {
    const onChange = vi.fn();
    render(<QuantityPicker value={1} max={37} onChange={onChange} testIdPrefix="t-qty" />);
    expect(screen.getByTestId('t-qty-value')).toHaveTextContent('1');
    expect(screen.getByTestId('t-qty-chip-20')).not.toBeDisabled();
    expect(screen.getByTestId('t-qty-chip-50')).toBeDisabled();
    expect(screen.getByTestId('t-qty-chip-1000')).toBeDisabled();
    fireEvent.click(screen.getByTestId('t-qty-chip-20'));
    expect(onChange).toHaveBeenCalledWith(20);
    fireEvent.click(screen.getByTestId('t-qty-chip-max'));
    expect(onChange).toHaveBeenCalledWith(37);
    fireEvent.change(screen.getByTestId('t-qty-slider'), { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it('a max of 0 disables the whole ladder', () => {
    const onChange = vi.fn();
    render(<QuantityPicker value={1} max={0} onChange={onChange} testIdPrefix="t-qty" />);
    expect(screen.getByTestId('t-qty-chip-1')).toBeDisabled();
    expect(screen.getByTestId('t-qty-chip-max')).toBeDisabled();
    expect(screen.getByTestId('t-qty-slider')).toBeDisabled();
  });
});

const MASTERIES = {
  crafting_consumables: { level: 9, xp: 0 },
  'crafting.refining': { level: 6, xp: 0 },
  'crafting.gear': { level: 4, xp: 0 },
  'crafting.cosmetics': { level: 2, xp: 0 },
};

describe('RecipeCard quantity picker — wired to the card cost figures', { timeout: 60_000 }, () => {
  beforeEach(() => {
    const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === 'recipe_medkit');
    if (!recipe) throw new Error('recipe_medkit missing from catalog');
    const stock: Record<string, number> = {};
    for (const key of Object.keys(resolvedRecipeInputs(recipe, undefined))) stock[key] = 1000;
    usePlayerStore.setState({
      level: 14,
      credits: 6420,
      scrap: 1240,
      materials: { ...stock },
      essences: { ...stock },
      consumables: {},
    });
    useWorkshopStore.setState({
      server: {
        benches: 2,
        tools: { owned: {}, fitted: {}, charges: {} },
        jobs: [],
        masteries: { ...MASTERIES },
        activeActionKind: null,
        recentCompletions: [],
      },
      error: null,
      loading: false,
      refresh: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => true),
    });
  });

  it('MAX on the card equals the helper output for its inputs, and QUEUE carries the picked units', async () => {
    const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === 'recipe_medkit');
    if (!recipe) throw new Error('recipe_medkit missing from catalog');
    const expected = craftUnitsMax({
      recipeMaxUnits: recipe.maxUnits,
      inputs: Object.entries(resolvedRecipeInputs(recipe, undefined)).map(([key, per]) => ({
        per,
        have: 1000,
        key,
      })),
      catalystPerUnit: false,
      catalystHave: 0,
    });
    expect(expected).toBeGreaterThan(1);
    expect(expected).toBeLessThan(1000);

    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const el = document.getElementById('workshop-recipe-recipe_medkit');
    if (!el) throw new Error('medkit card not rendered');
    const card = within(el as HTMLElement);

    expect(card.getByTestId('craft-qty-value')).toHaveTextContent('1');
    expect(card.getByTestId('craft-qty-chip-1000')).toBeDisabled();
    fireEvent.click(card.getByTestId('craft-qty-chip-max'));
    expect(card.getByTestId('craft-qty-value')).toHaveTextContent(expected.toLocaleString('en-US'));

    fireEvent.click(card.getByRole('button', { name: 'QUEUE JOB' }));
    const enqueue = useWorkshopStore.getState().enqueue as unknown as ReturnType<typeof vi.fn>;
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipeId: 'recipe_medkit', units: expected }));
  });
});
