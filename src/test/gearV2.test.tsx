/**
 * Gear v2 (redesign Wave D, DESIGN.md §2/§3/§6) — the Gear tab.
 *
 * What this pins:
 *  - The Gear tab is ONE merged Loadout page. The Grid and Items
 *    stops retired into it as sections (Exec C, 2026-11-03), and
 *    the Workshop stop retired into Home's Craft workspace
 *    (crafting consolidation, owner ruling 2026-11-04): there is
 *    no gear rail at all — the page foot carries a Workshop
 *    STATUS STRIP (bench counts + Craft state) that doors to
 *    Home's bench.
 *  - F1 successor (owner ruling 2026-11-02, superseding the
 *    original §11 F1): the Garage is NOT a rail stop — it folds
 *    into the Loadout page as the vehicle section. The Loadout
 *    carries the vehicle slot's status line, whose Open Garage
 *    toggle expands the full Garage panel in place; a garage
 *    intent lands on Loadout with the section already expanded.
 *  - Grid cards print the item instance's REAL affixes on the card
 *    face (real-item invariant), not just affix counts.
 *  - The Belt & Stacks section prints the stacks with quality %
 *    per batch (DESIGN.md §3), from the player's actual batch
 *    records.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { useInventoryStore, usePlayerStore, useWorkshopStore } from '@/store';
import { InventoryScreen } from '@/screens/InventoryScreen';

function makeWeapon(id: string, name: string, affixTexts: string[] = []): Weapon {
  return {
    id, name, level: 5, rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [],
    affixes: affixTexts.map((displayText, i) => ({
      id: `${id}-aff-${i}`, category: 'combat' as const, stat: 'weaponDamage', value: 0.1, displayText,
    })),
    sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 50, bossPower: 50, farmPower: 50, economyScore: 0,
  };
}

// The Workshop stop mounts ChipRail (IntersectionObserver) — the
// repo convention (ChipRail.test.tsx) is to install the mock in
// files whose screens need it.
let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;
beforeAll(() => {
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn(function (this: IntersectionObserver, callback: IntersectionObserverCallback) {
    this.observe = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this);
    this.unobserve = () => undefined;
    this.disconnect = () => undefined;
  }) as unknown as typeof IntersectionObserver;
});
afterAll(() => {
  if (originalIntersectionObserver) globalThis.IntersectionObserver = originalIntersectionObserver;
});

describe('Gear v2 — the merged page, no rail', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
    useWorkshopStore.setState({ server: null });
    usePlayerStore.setState({ consumables: {}, consumableBatches: [], materials: {}, essences: {} });
  });

  it('renders no gear rail and no stops — the Loadout page stands alone', () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // Crafting consolidation (2026-11-04): the Workshop stop
    // retired to Home, and the one-stop rail went with it.
    expect(screen.queryByTestId('gear-rail')).toBeNull();
    expect(screen.queryByTestId('gear-stop-loadout')).toBeNull();
    expect(screen.queryByTestId('gear-stop-workshop')).toBeNull();
    // Owner ruling 2026-11-02: there is no Garage stop either —
    // the Garage folded into Loadout (§11 F1 as amended).
    expect(screen.queryByTestId('gear-stop-garage')).toBeNull();
    expect(screen.queryByTestId('gear-stop-grid')).toBeNull();
    expect(screen.queryByTestId('gear-stop-items')).toBeNull();
    // The bench's trace on Gear is the status strip at the foot.
    expect(screen.getByTestId('gear-workshop-strip')).toBeTruthy();
  });

  it('opens on the Loadout page; the Garage folds in under the vehicle line (F1 successor — owner ruling 2026-11-02)', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // F5 successor landmark: the Loadout page's old intro sentence
    // ("Your seven gear slots…") was removed per the fidelity audit;
    // the panel header's "Tap a slot to equip" hint is its marker now.
    expect(await screen.findByText('Tap a slot to equip')).toBeTruthy();
    // Collapsed: the Garage panel is not rendered yet — the vehicle
    // slot shows as its status line with the expansion toggle.
    expect(screen.queryByTestId('garage-panel')).toBeNull();
    expect(screen.getByTestId('vehicle-status')).toBeTruthy();
    // One tap expands the full Garage IN PLACE — there is no
    // Garage stop to navigate to.
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
  });

  it('a garage intent lands on Loadout with the vehicle section already expanded', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} tabIntent={{ tab: 'loadout', expandVehicle: true, seq: 3 }} />);
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close Garage' })).toBeTruthy();
  });

  it('the merged Loadout page mounts the doll, the Inventory grid, and the belt as sections', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // No stop-hopping: the whole page is here on arrival — the
    // former Grid as § Inventory, the former Items stop as
    // § Belt & Stacks.
    expect(await screen.findByText('Inventory', { selector: '.text-base' })).toBeTruthy();
    expect(screen.getByText('Belt & Stacks')).toBeTruthy();
    expect(screen.getByText('How the belt works')).toBeTruthy();
    // And the Workshop status strip rides at the page foot.
    expect(screen.getByTestId('gear-workshop-strip')).toBeTruthy();
  });

  it('the bench-family signposts retired with the Workshop stop', () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // The reforge/salvage signposts existed to route Workshop-stop
    // visitors back to the Loadout page; with the stop gone they
    // have nothing to route. Their canonical doors (inspect sheet,
    // Inventory section) never moved.
    expect(screen.queryByText('Also at the bench')).toBeNull();
    expect(screen.queryByText(/Reforge an affix — pick the item/)).toBeNull();
    expect(screen.queryByText(/Salvage & recycle — in Inventory/)).toBeNull();
  });

  it('the status strip prints the bench counts from the workshop view', () => {
    useWorkshopStore.setState({
      server: {
        benches: 1,
        tools: {} as never,
        masteries: {},
        activeActionKind: null,
        recentCompletions: [{ jobId: 'job-done' } as never],
        jobs: [
          { state: 'running' } as never,
          { state: 'queued' } as never,
          { state: 'paused' } as never,
        ],
      },
    });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId('gear-workshop-strip-counts').textContent).toContain('1 running · 2 queued · 1 ready');
    // Jobs waiting while Craft doesn't hold the slot: paused truth.
    expect(screen.getByTestId('gear-workshop-strip-state').textContent).toBe('Bench paused');
  });
});

describe('Gear v2 — real data on the card face', () => {
  beforeEach(() => {
    useWorkshopStore.setState({ server: null });
  });

  it('a Grid card prints the item instance’s rolled affixes, not just a count', async () => {
    const weapon = makeWeapon('w-aff', 'Affix Pistol', ['+12% Weapon Damage', '+8% Crit Chance', '+5% Boss Damage']);
    useInventoryStore.setState({ items: [weapon] });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // The grid is the merged page's Inventory section — no stop
    // switch stands between the player and the card. The section
    // opens in LIST view, which since the true-list ruling
    // (2026-11-04) prints no affix lines at all. The invariant
    // this test pins — the face prints THIS instance's rolled
    // affixes, not just a count — now lives on the GRID face,
    // which prints the first rolled line…
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle inventory layout' }));
    expect(await screen.findByText('+12% Weapon Damage')).toBeTruthy();
    // …and the remaining rolled lines live in inspect, where the
    // old list face's "+N more affixes" pointer used to send the
    // player anyway.
    fireEvent.click(screen.getByText('Affix Pistol'));
    // The remaining lines must print on the sheet's own affix list
    // (the "Affixes (3)" section). The Trade tape further down the
    // same sheet ALSO restates the candidate's rolled affixes as
    // swap gains, by displayText — a second, different surface in
    // the same scene — so these two queries are scoped to the
    // affix-list section itself. The assertions are unchanged in
    // strength: the exact rolled lines, printed in full there.
    const affixList = screen.getByText(/Affixes \(3\)/).closest('section');
    if (!affixList) throw new Error('inspect affix-list section not found');
    expect(await within(affixList).findByText('+8% Crit Chance')).toBeTruthy();
    expect(within(affixList).getByText('+5% Boss Damage')).toBeTruthy();
  });
});

describe('Gear v2 — Items stacks with quality printed', () => {
  beforeEach(() => {
    useWorkshopStore.setState({ server: null });
    useInventoryStore.setState({ items: [] });
  });

  it('prints consumable batches at their real quality, plus materials and essences', async () => {
    usePlayerStore.setState({
      consumables: { MedKit: 5 },
      consumableBatches: [
        { id: 'b1', consumable_type: 'MedKit', quality_percent: 100, quantity: 2, origin: 'vendor' },
        { id: 'b2', consumable_type: 'MedKit', quality_percent: 137, quantity: 3, origin: 'crafted' },
      ],
      materials: { Scrap: 42 },
      essences: { VoidEssence: 3 },
    });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    // Belt & Stacks is a section of the merged page — mounted with it.
    expect(await screen.findByText(/×3 at 137% quality/)).toBeTruthy();
    expect(screen.getByText(/×2 at 100% quality/)).toBeTruthy();
    expect(screen.getByText('Scrap')).toBeTruthy();
    expect(screen.getByText('Void Essence')).toBeTruthy();
  });
});
