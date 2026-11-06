/**
 * THE NO-PARAGRAPHS LAW, mechanically enforced (owner ruling
 * 2026-11-05; DESIGN.md Standing laws). This slice's machine-check
 * promotion: prose laws used to live only in comments and review —
 * this test makes the law executable on the screen that provoked
 * it, the Gear Loadout.
 *
 * The law: a screen carries no explanatory sentences/paragraphs.
 * A section gets its label, its controls, and a "?" beside the
 * label; explanations live in the pop-up behind the "?".
 *
 * The check renders the Loadout in the exact state that used to
 * print all three offending blocks at once (vehicle equipped and
 * out of fuel → the out-of-fuel paragraph; belt slots empty → the
 * remedy line; plus the always-printed belt caption), walks every
 * VISIBLE direct text node, and fails on anything shaped like
 * explanatory prose. Prose shape, pragmatically: item names, stat
 * lines, labels, and state words never end in sentence punctuation
 * after 6+ words, never carry two sentence terminators, and never
 * run 120+ characters — the retired blocks did all three (55–190
 * chars, 1–3 sentences each). Screen-reader-only text (sr-only)
 * is not screen text and is exempt, as is anything inside the
 * help pop-up — that is where prose is FOR.
 *
 * Teeth: this file imports nothing the pre-change screen didn't
 * have, and its first test FAILS on the pre-change tree (verified
 * against origin/master: the scan names the out-of-fuel
 * paragraph, the belt caption, and the remedy line).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { SyncedLoadoutScreen } from '@/screens/SyncedLoadoutScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1, tools: {}, jobs: [], masteries: {},
    activeActionKind: null, recentCompletions: [],
  })),
}));

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: 'veh-1',
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ consumables: {}, vehicleFuel: 0 });
  useVehicleStore.setState({ vehicles: [scrapBike()], lastClaimStatus: null });
});

/** Every visible direct-text block under root, minus the exempt
 *  zones (the help pop-up's subtree, screen-reader-only text).
 *  The text check runs first and the (expensive, cached) computed-
 *  style visibility walk only touches text-bearing elements —
 *  the pixel actor's DOM is thousands of textless nodes. */
function visibleDirectTexts(root: HTMLElement, { includePopUp = false } = {}): string[] {
  const out: string[] = [];
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = window.getComputedStyle(el as HTMLElement);
      styleCache.set(el, s);
    }
    return s;
  };
  root.querySelectorAll('*').forEach((el) => {
    let text = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!includePopUp && el.closest('[data-testid="help-hint-sheet"]')) return;
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) return;
    let node: Element | null = el;
    let hidden = false;
    while (node && node !== root) {
      const s = styleOf(node);
      if (s.display === 'none' || s.visibility === 'hidden') { hidden = true; break; }
      node = node.parentElement;
    }
    if (!hidden) out.push(text);
  });
  return out;
}

/** Explanatory-prose shape — see the header for the thresholds. */
function isParagraph(text: string): boolean {
  const terminators = (text.match(/[.!?…]/g) ?? []).length;
  const words = text.split(' ').filter(Boolean).length;
  if (terminators >= 2) return true;
  if (text.length >= 120 && terminators >= 1) return true;
  if (words >= 6 && /[.!?]$/.test(text)) return true;
  return false;
}

describe('no-paragraphs law — the Loadout screen', () => {
  // A full-screen render + DOM scan; the timeout is sized for a
  // loaded CI runner, the same reason heavy suites in this repo
  // carry explicit timeouts.
  it('no visible text on the Loadout is explanatory prose', () => {
    const { container } = render(<SyncedLoadoutScreen />);
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);

  it('the pop-up is the prose\'s home — the scan sees it there, and only there', async () => {
    const { container } = render(<SyncedLoadoutScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'About Consumable Belt' }));
    const sheet = await screen.findByTestId('help-hint-sheet');
    // Non-vacuity: pointed INSIDE the pop-up, the same detector
    // finds the explanation's sentences — it can see prose when
    // prose exists; the screen scan above is not passing blind.
    const inside = visibleDirectTexts(sheet, { includePopUp: true }).filter(isParagraph);
    expect(inside.length).toBeGreaterThanOrEqual(3);
    // And with the pop-up open, the screen behind it is still clean.
    const offenders = visibleDirectTexts(container).filter(isParagraph);
    expect(offenders).toEqual([]);
  }, 30000);
});
