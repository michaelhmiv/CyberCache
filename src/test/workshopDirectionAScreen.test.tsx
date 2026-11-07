/**
 * Workshop Direction A — screen render tests at the mock's fixture.
 *
 * The page must answer, in its first controls and sections: what is
 * this for, what can I make right now (with a real count), and —
 * on every gated card — ALL the gates, in human words, with doors.
 * Zero feature loss: the incumbent's queue / activity / benches /
 * tools / materials / tint surfaces all still render.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkshopScreen } from '../screens/WorkshopScreen';
import { usePlayerStore, useWorkshopStore } from '../store';
import { ALL_CRAFT_RECIPES, isDelistedRecipe } from '../content/crafting';
import { countCraftableNow, type WorkshopPlayerContext } from '../lib/workshop/readiness';

// jsdom has no IntersectionObserver; ChipRail needs one. Same stub
// shape as auditDisplayFixes.test.tsx.
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

const MASTERIES = {
  crafting_consumables: { level: 9, xp: 0 },
  'crafting.refining': { level: 6, xp: 0 },
  'crafting.gear': { level: 4, xp: 0 },
  'crafting.cosmetics': { level: 2, xp: 0 },
};

const MATERIALS = { Scrap: 42, ReactiveComponents: 17, BallisticParts: 9, TechFragments: 6, RefinedAlloy: 3 };
const ESSENCES = { IgnitionFluid: 2 };

function seedStores() {
  usePlayerStore.setState({
    level: 14,
    credits: 6420,
    scrap: 1240,
    materials: { ...MATERIALS },
    essences: { ...ESSENCES },
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
}

function fixtureCtx(): WorkshopPlayerContext {
  return {
    playerLevel: 14,
    scrap: 1240,
    materials: { ...MATERIALS },
    essences: { ...ESSENCES },
    consumables: {},
    benchesOwned: 2,
    masteries: { ...MASTERIES },
    standingRanks: {},
    researchCompletedIds: new Set<string>(),
    activeJobs: [],
  };
}

const card = (recipeId: string) => {
  const el = document.getElementById(`workshop-recipe-${recipeId}`);
  if (!el) throw new Error(`card not rendered: ${recipeId}`);
  return within(el as HTMLElement);
};

// Suite timeout: each test renders the full Workshop (87 cards,
// stores, motion) — far heavier than the 5s default under shared CI
// load; the endless suite sets the same precedent (per-test timeouts
// for heavy subjects). Assertions are unchanged.
describe('Workshop Direction A — the page at the mock fixture', { timeout: 60_000 }, () => {
  beforeEach(() => {
    seedStores();
  });

  it('leads with the purpose header and the first controls', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/Turn raw drops into kits, ammo and real gear/)).toBeTruthy();
    expect(screen.getByText(/over 100% beats the Vendor’s flat 100/)).toBeTruthy();
    // The screen's counts cover the BROWSABLE catalog: delisted
    // recipes (Hero Pass H1 — the retired maker helms) leave the
    // shelf and the counts while staying resolvable by id.
    const browsable = ALL_CRAFT_RECIPES.filter((r) => !isDelistedRecipe(r));
    const expected = countCraftableNow(browsable.filter((r) => !r.tintCraft), fixtureCtx());
    const chip = await screen.findByTestId('craftable-now-chip');
    expect(chip.textContent).toContain(`Craftable now ${expected}`);
    expect(screen.getByTestId('all-recipes-chip').textContent).toContain(`All ${browsable.length}`);
    expect(screen.getByPlaceholderText('Search name, job or material…')).toBeTruthy();
  });

  it('prints standing and the bench card — one bench, its relics named', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    expect(screen.getByText('Your standing — the gates read these')).toBeTruthy();
    expect(screen.getByText(/Mastery · Consumables/)).toBeTruthy();
    expect(await screen.findByText(/Research · Production Systems/)).toBeTruthy();
    // Slice 9: the three-tier bench strip (dots legend, prices) is
    // replaced by the Bench card — one bench, always ready, and
    // the craft relics listed as its permanent modifiers.
    expect(screen.getAllByText('The Bench').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/One bench, always ready/)).toBeTruthy();
    expect(screen.getAllByText(/Precision Calipers/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Prime Laboratory/).length).toBeGreaterThanOrEqual(1);
    // Nothing is for sale and nothing cites a hunter level.
    expect(screen.queryByText(/25,000cr · 10 Void Dust/)).toBeNull();
    expect(screen.queryByText(/Bench dots:/)).toBeNull();
    expect(screen.queryByText(/Lv\.30/)).toBeNull();
  });

  it('sections run Craftable now → One gate away → Locked, each with its count', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const sections = await screen.findAllByTestId(/^workshop-section-/);
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'workshop-section-craftable',
      'workshop-section-one-gate',
      'workshop-section-locked',
    ]);
    const bandKey = screen.getByTestId('quality-band-key');
    expect(bandKey.textContent).toContain('100% is the Vendor’s flat baseline');
    expect(bandKey.textContent).toContain('Anomalous');
    expect(bandKey.textContent).toContain('160+');
  });

  it('a craftable card face is identity + numbers + actions, with a live QUEUE JOB', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const medkit = card('recipe_medkit');
    // Detail behind inspect: no purpose prose, no quality line on the face.
    expect(medkit.queryByText(/emergency heal/)).toBeNull();
    expect(medkit.queryByText(/100% = Vendor strength/)).toBeNull();
    expect(medkit.getByText(/Total for/)).toBeTruthy();
    expect(medkit.getByText(/inputs held when you queue/)).toBeTruthy();
    expect(screen.getByTestId('recipe-info-recipe_medkit')).toBeTruthy();
    const cta = medkit.getByRole('button', { name: 'QUEUE JOB' });
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cta);
    const enqueue = useWorkshopStore.getState().enqueue as unknown as ReturnType<typeof vi.fn>;
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipeId: 'recipe_medkit', units: 1 }));
  });

  it('the inspect sheet carries the description + quality detail for the item', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recipe-info-recipe_medkit'));
    const sheet = await screen.findByTestId('recipe-inspect-sheet');
    const inSheet = within(sheet);
    expect(inSheet.getByText(/emergency heal/)).toBeTruthy();
    expect(inSheet.getByText(/Quality rolls|Your roll:/)).toBeTruthy();
    expect(inSheet.getByText(/\d+–\d+%/)).toBeTruthy();
    expect(inSheet.getByText(/Heal amount scales directly with quality/)).toBeTruthy();
    expect(inSheet.getByText(/100% is exactly Vendor strength/)).toBeTruthy();
  });

  it('a materials-only block renders NO summary banner — the line is the reason', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const fuel = card('recipe_fuel_cell');
    expect(fuel.getByText(/short 1/)).toBeTruthy();
    expect(fuel.getByText('Get it:')).toBeTruthy();
    expect(fuel.getByRole('button', { name: /Roam Redline Circuit/ })).toBeTruthy();
    // No re-narration: no "Missing …" banner anywhere on the card,
    // and the disabled button reads QUEUE JOB, not a reason.
    expect(fuel.queryByText(/Missing Nitrocell Gel/)).toBeNull();
    expect(fuel.queryByText(/its only shortage/)).toBeNull();
    const cta = fuel.getByRole('button', { name: 'QUEUE JOB' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  it('the research gate renders in human words with its door — never the raw code', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const batch = card('recipe_patch_kit_batch');
    expect(await batch.findByText(/Research — Production Systems not taken/)).toBeTruthy();
    expect(batch.getByRole('button', { name: /Research, Hunter tab/ })).toBeTruthy();
    const cta = batch.getByRole('button', { name: 'QUEUE JOB' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain('research_required');
    expect(document.body.textContent).not.toContain('standing_required');
  });

  it('a locked card prints its NON-material gates — met ones included — and never re-narrates materials', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const master = card('recipe_master_patch_kit');
    expect(master.getByText(/Level 1 — met/)).toBeTruthy();
    expect(master.getByText(/Mastery — Consumables 15\. Yours is 9\./)).toBeTruthy();
    // The Void Dust shortage lives on its input line (+ source), and
    // ONLY there — no "Missing Void Dust" banner in the gate block.
    expect(master.getByText(/short 1/)).toBeTruthy();
    expect(master.queryByText(/Missing Void Dust/)).toBeNull();
    const cta = master.getByRole('button', { name: 'QUEUE JOB' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    const calipers = card('tool_precision_calipers');
    // Pre-collapse the card narrated the Lab in its source lines
    // ('made in the Lab furnace'); the tier is gone — the furnace
    // is a station on the one bench, and no card names a Lab.
    expect(calipers.getByText(/Circuit Lattice/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Lab furnace');
    expect((calipers.getByRole('button', { name: 'QUEUE JOB' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the craftable-only chip filters to the craftable section alone', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('craftable-now-chip'));
    expect(screen.getByTestId('workshop-section-craftable')).toBeTruthy();
    expect(screen.queryByTestId('workshop-section-locked')).toBeNull();
    expect(document.getElementById('workshop-recipe-recipe_master_patch_kit')).toBeNull();
    expect(document.getElementById('workshop-recipe-recipe_medkit')).not.toBeNull();
  });

  it('search finds a batch recipe by its natural multi-word name', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search name, job or material…'), { target: { value: 'patch kit batch' } });
    expect(document.getElementById('workshop-recipe-recipe_patch_kit_batch')).not.toBeNull();
    expect(document.getElementById('workshop-recipe-recipe_medkit')).toBeNull();
  });

  it('search finds a recipe by its material', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search name, job or material…'), { target: { value: 'nitrocell' } });
    expect(document.getElementById('workshop-recipe-recipe_fuel_cell')).not.toBeNull();
    expect(document.getElementById('workshop-recipe-recipe_medkit')).toBeNull();
  });

  it('zero feature loss: activity, the bench, materials, and tinting all render', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    expect(screen.getByText('Workshop Activity')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Work the Bench' })).toBeTruthy();
    // Slice 9: 'Benches & Tools' (the purchase/fit panel) is
    // replaced by the Bench card; its relic list renders instead.
    expect(screen.getAllByText('The Bench').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Benches & Tools')).toBeNull();
    expect(screen.getByText(/Materials & Essences/)).toBeTruthy();
    expect(await screen.findByTestId('tint-panel')).toBeTruthy();
    // No bench can be locked, so no unlock remedy exists to name.
    expect(document.body.textContent).not.toContain('(locked — unlock at Benches & Tools above)');
  });
});
