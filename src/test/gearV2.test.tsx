/**
 * Gear v2 (redesign Wave D, DESIGN.md §2/§3/§6/§11-F1) — the Gear
 * tab as a rail of five stops.
 *
 * What this pins:
 *  - The rail carries exactly the §2 stops in order — Loadout ·
 *    Grid · Items · Workshop · Garage — at the §5 floor size with
 *    real tap targets (source shape), and the tab opens on Loadout,
 *    the rail's first stop.
 *  - F1: the Garage is a stop, not a Loadout section. The garage
 *    intent lands on it directly, and the Loadout stop no longer
 *    renders the Garage panel — it carries the vehicle slot's
 *    status line with the Open Garage door instead.
 *  - The Workshop stop badges its active job count on the rail and
 *    carries the bench-family doors (reforge/salvage signposts to
 *    their canonical Grid/inspect doors).
 *  - Grid cards print the item instance's REAL affixes on the card
 *    face (real-item invariant), not just affix counts.
 *  - The Items stop prints the stacks with quality % per batch
 *    (DESIGN.md §3), from the player's actual batch records.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('Gear v2 — the rail of stops', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
    useWorkshopStore.setState({ server: null });
    usePlayerStore.setState({ consumables: {}, consumableBatches: [], materials: {}, essences: {} });
  });

  it('renders exactly the five §2 stops in order, at floor size with real tap targets', () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    const rail = screen.getByTestId('gear-rail');
    const stops = [...rail.querySelectorAll('[data-testid^="gear-stop-"]')].map((el) => el.getAttribute('data-testid'));
    expect(stops).toEqual(['gear-stop-loadout', 'gear-stop-grid', 'gear-stop-items', 'gear-stop-workshop', 'gear-stop-garage']);
    for (const label of ['Loadout', 'Grid', 'Items', 'Workshop', 'Garage']) {
      expect(screen.getByTestId(`gear-stop-${label.toLowerCase() === 'grid' ? 'grid' : label.toLowerCase()}`)).toBeTruthy();
      expect(rail.textContent).toContain(label);
    }
    const railSource = readFileSync(resolve(__dirname, '../../src/components/gear/GearRail.tsx'), 'utf8');
    expect(railSource).toContain('min-h-[48px]');
    expect(railSource).toContain('text-[11px]');
    expect(railSource).not.toContain('text-[10px]');
    expect(railSource).not.toContain('text-[9px]');
  });

  it('opens on the Loadout stop; the Garage is NOT rendered under it anymore (F1)', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Your seven gear slots/)).toBeTruthy();
    expect(screen.queryByTestId('garage-panel')).toBeNull();
    // The vehicle slot still shows on Loadout — as its status line,
    // with the Open Garage door to the stop.
    expect(screen.getByTestId('vehicle-status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    expect(screen.getByTestId('gear-stop-garage').getAttribute('aria-selected')).toBe('true');
  });

  it('the Grid stop mounts the item grid; the Items stop mounts the belt', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gear-stop-grid'));
    expect(await screen.findByText('Item Grid')).toBeTruthy();
    fireEvent.click(screen.getByTestId('gear-stop-items'));
    expect(await screen.findByText('Items', { selector: '.text-lg' })).toBeTruthy();
    expect(screen.getByText('How the belt works')).toBeTruthy();
  });

  it('the Workshop stop carries the bench-family doors to the Grid', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gear-stop-workshop'));
    expect(await screen.findByText('Also at the bench', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText(/Reforge an affix/)).toBeTruthy();
    expect(screen.getByText(/Salvage & recycle/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Salvage & recycle/));
    expect(await screen.findByText('Item Grid', undefined, { timeout: 10_000 })).toBeTruthy();
  }, 30_000);

  it('badges the Workshop stop with the active job count', () => {
    useWorkshopStore.setState({
      server: {
        benches: 1,
        tools: {} as never,
        masteries: {},
        activeActionKind: null,
        recentCompletions: [],
        jobs: [
          { state: 'running' } as never,
          { state: 'queued' } as never,
          { state: 'done' } as never,
        ],
      },
    });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId('gear-workshop-badge').textContent).toBe('2');
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
    fireEvent.click(screen.getByTestId('gear-stop-grid'));
    expect(await screen.findByText('+12% Weapon Damage')).toBeTruthy();
    expect(screen.getByText('+8% Crit Chance')).toBeTruthy();
    expect(screen.getByText('+1 more affixes — tap to inspect')).toBeTruthy();
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
      materials: { ScrapAlloy: 42 },
      essences: { VoidEssence: 3 },
    });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gear-stop-items'));
    expect(await screen.findByText(/×3 at 137% quality/)).toBeTruthy();
    expect(screen.getByText(/×2 at 100% quality/)).toBeTruthy();
    expect(screen.getByText('Scrap Alloy')).toBeTruthy();
    expect(screen.getByText('Void Essence')).toBeTruthy();
  });
});
