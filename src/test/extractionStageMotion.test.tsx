/**
 * Extraction works — the stage presentation (Motion M4a).
 *
 * Extraction was the stage's last statue: the hunter tweened
 * into the `work` pose and held it for the whole 10-minute
 * pass, and a settled pass's finds died in the panel as a text
 * card — the stage never showed a thing landing. These tests
 * pin the M4a presentation:
 *  - the sift cycle executes on the M1 engine while extraction
 *    holds the stage (spec is a registry row; the rig's FX ride
 *    the same spec on the canvas vehicle), and under reduced
 *    motion the stage is the pre-M4a picture — held pose, no FX;
 *  - a pass settling mid-watch earns the bench lanes' beat
 *    grammar: its finds rise off the rig — one PixelMaterial
 *    rise per material/essence type at the EXACT settled count
 *    (the rise planner is a pure function of the same payload
 *    the panel prints, so stage and card can never disagree);
 *  - seen-set discipline: feed history at mount never replays,
 *    a pass settling under another mode earns no beat, an empty
 *    pass earns no beat, a duplicate announcement never fires
 *    twice, and a multi-pass settle sequences oldest first.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useExtractionFeedStore } from '@/store';
import {
  EXTRACTION_MAX_RISES,
  EXTRACTION_RISE_STAGGER_MS,
  extractionBeatDurationMs,
  extractionRisesForPass,
} from '@/lib/pixel/extractionRise';
import { MOVEMENT } from '@/lib/pixel/movement';
import { WORK_CYCLE_SPECS } from '@/lib/pixel/workCycle';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { ActivityKind } from '@/types/activity';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const motionHoist = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => motionHoist.reducedMotion };
});

const DIORAMA_WEAPON: Weapon = {
  id: 'm4a-weapon',
  name: 'M4a Test Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;

const pass = (over: Partial<ChefExtractionPass>): ChefExtractionPass => ({
  index: 1,
  areaId: 'dustwaste_frontier',
  method: 'surface',
  draws: 32,
  gearFactor: 1,
  deepDegraded: false,
  xpAwarded: 120,
  materials: {},
  essences: {},
  signatureUnits: 0,
  ...over,
});

const renderDiorama = (activityKind: ActivityKind) =>
  render(
    <LiveTurfDiorama
      area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
      weapon={DIORAMA_WEAPON}
      playerLevel={5}
      equippedCount={1}
      activityKind={activityKind}
    />,
  );

const pushPass = (p: ChefExtractionPass) => {
  act(() => {
    useExtractionFeedStore.getState().pushPass(p);
  });
};

afterEach(() => {
  motionHoist.reducedMotion = false;
  vi.useRealTimers();
  act(() => {
    useExtractionFeedStore.setState({ passes: [] });
  });
});

describe('the rise planner — a pure function of the settled payload', () => {
  it('merges materials and essences into rises at their exact counts, largest first', () => {
    const rises = extractionRisesForPass(pass({
      materials: { TechFragments: 5, BallisticParts: 3 },
      essences: { IgnitionFluid: 4 },
    }));
    expect(rises).toEqual([
      { id: 'TechFragments', kind: 'material', qty: 5 },
      { id: 'IgnitionFluid', kind: 'essence', qty: 4 },
      { id: 'BallisticParts', kind: 'material', qty: 3 },
    ]);
  });

  it('count ties break by id, so the fan is deterministic', () => {
    const rises = extractionRisesForPass(pass({
      materials: { TechFragments: 2, BallisticParts: 2 },
    }));
    expect(rises.map((r) => r.id)).toEqual(['BallisticParts', 'TechFragments']);
  });

  it('zero-count entries are not finds and never rise', () => {
    expect(extractionRisesForPass(pass({ materials: { TechFragments: 0 } }))).toEqual([]);
    expect(extractionRisesForPass(pass({}))).toEqual([]);
  });

  it('signature units ride inside their material — never a second rise', () => {
    // Server fact: signature draws substitute the material type
    // inside the draw, so the units are already counted in
    // materials; signatureUnits is an annotation over them.
    const rises = extractionRisesForPass(pass({
      materials: { Dustglass: 7 },
      signatureUnits: 3,
    }));
    expect(rises).toEqual([{ id: 'Dustglass', kind: 'material', qty: 7 }]);
  });

  it('caps the fan at EXTRACTION_MAX_RISES, keeping the largest finds', () => {
    const materials: Record<string, number> = {};
    for (let i = 0; i < EXTRACTION_MAX_RISES + 3; i += 1) materials[`Mat${i}`] = i + 1;
    const rises = extractionRisesForPass(pass({ materials }));
    expect(rises).toHaveLength(EXTRACTION_MAX_RISES);
    expect(rises[0].qty).toBe(EXTRACTION_MAX_RISES + 3);
    expect(rises[rises.length - 1].qty).toBe(4);
  });

  it('beat duration is the last rise’s full LOOT_RISE_MS after its stagger', () => {
    expect(extractionBeatDurationMs(0)).toBe(0);
    expect(extractionBeatDurationMs(1)).toBe(MOVEMENT.LOOT_RISE_MS);
    expect(extractionBeatDurationMs(3)).toBe(MOVEMENT.LOOT_RISE_MS + 2 * EXTRACTION_RISE_STAGGER_MS);
  });
});

describe('the feed — the settle’s stage signal', () => {
  it('keeps passes newest-first and can never hold the same pass twice', () => {
    pushPass(pass({ index: 4 }));
    pushPass(pass({ index: 5 }));
    pushPass(pass({ index: 4, xpAwarded: 999 }));
    const { passes } = useExtractionFeedStore.getState();
    expect(passes.map((e) => e.pass.index)).toEqual([5, 4]);
    expect(passes[1].pass.xpAwarded).toBe(120);
  });
});

describe('the cycle — extraction works the site', () => {
  it('mid-pass: the rig FX execute the sift spec on the canvas vehicle', () => {
    renderDiorama('extraction');
    const fx = screen.getByTestId('extraction-fx');
    expect(fx.getAttribute('data-fx-vehicle')).toBe('canvas');
    expect(fx.querySelector('canvas')).toBeTruthy();
    expect(fx.querySelector('svg')).toBeNull();
    // The bench lanes' FX stay dark — extraction runs its own row.
    expect(screen.queryByTestId('bench-fx')).toBeNull();
    // The hunter is present and unarmed (gathering, not combat).
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
  });

  it('the sift spec is a registry row the engine samples like any family', () => {
    const sift = WORK_CYCLE_SPECS.sift;
    expect(sift).toBeDefined();
    expect(sift.strikeAt).toBeGreaterThan(sift.liftAt);
    expect(sift.strikeAt + sift.holdFrac).toBeLessThan(1);
  });

  it('reduced motion: no rig FX — the held work pose is the whole picture', () => {
    motionHoist.reducedMotion = true;
    renderDiorama('extraction');
    expect(screen.queryByTestId('extraction-fx')).toBeNull();
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
  });
});

describe('the beat — settled passes appear on the stage', () => {
  it('a fresh pass rises off the rig: one rise per type at its exact count', () => {
    renderDiorama('extraction');
    pushPass(pass({
      index: 7,
      materials: { TechFragments: 5, BallisticParts: 3 },
      essences: { IgnitionFluid: 4 },
    }));
    const tray = screen.getByTestId('extraction-pass-rises');
    expect(tray.getAttribute('data-pass-key')).toBe('extraction-pass-7');
    const rises = screen.getAllByTestId('extraction-pass-rise');
    expect(rises.map((r) => [r.getAttribute('data-rise-id'), r.getAttribute('data-rise-kind'), r.getAttribute('data-rise-qty')])).toEqual([
      ['TechFragments', 'material', '5'],
      ['IgnitionFluid', 'essence', '4'],
      ['BallisticParts', 'material', '3'],
    ]);
    // Each rise renders the material itself — the real compositor
    // canvas for that id, not a letter tile.
    for (const rise of rises) {
      const art = rise.querySelector('canvas[data-material-id]');
      expect(art?.getAttribute('data-material-id')).toBe(rise.getAttribute('data-rise-id'));
    }
    // While the beat plays, the rig FX hold (the cycle pauses for
    // the celebration, the bench grammar).
    expect(screen.queryByTestId('extraction-fx')).toBeNull();
  });

  it('history at mount never replays: a pass settled before the stage mounted earns no beat', () => {
    pushPass(pass({ index: 3, materials: { TechFragments: 2 } }));
    renderDiorama('extraction');
    expect(screen.queryByTestId('extraction-pass-rises')).toBeNull();
  });

  it('an empty pass earns no beat', () => {
    renderDiorama('extraction');
    pushPass(pass({ index: 8 }));
    expect(screen.queryByTestId('extraction-pass-rises')).toBeNull();
  });

  it('the same pass announced twice fires once', () => {
    renderDiorama('extraction');
    pushPass(pass({ index: 9, materials: { TechFragments: 2 } }));
    expect(screen.getByTestId('extraction-pass-rises')).toBeTruthy();
    pushPass(pass({ index: 9, materials: { TechFragments: 2 } }));
    expect(screen.getAllByTestId('extraction-pass-rises')).toHaveLength(1);
  });

  it('a pass settling while another mode holds the stage earns no beat there — and none on return', () => {
    const { rerender } = renderDiorama('roaming_loot');
    pushPass(pass({ index: 11, materials: { TechFragments: 2 } }));
    expect(screen.queryByTestId('extraction-pass-rises')).toBeNull();
    // Back on the extraction stage: the pass that landed under
    // roam stays unplayed (it was marked seen; the panel is its
    // record) — only the NEXT fresh pass beats.
    rerender(
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={DIORAMA_WEAPON}
        playerLevel={5}
        equippedCount={1}
        activityKind="extraction"
      />,
    );
    pushPass(pass({ index: 12, materials: { BallisticParts: 1 } }));
    expect(screen.getByTestId('extraction-pass-rises').getAttribute('data-pass-key')).toBe('extraction-pass-12');
  });

  it('reduced motion: no beat, however fresh the pass', () => {
    motionHoist.reducedMotion = true;
    renderDiorama('extraction');
    pushPass(pass({ index: 12, materials: { TechFragments: 2 } }));
    expect(screen.queryByTestId('extraction-pass-rises')).toBeNull();
  });

  it('a multi-pass settle sequences one beat per pass, oldest first', () => {
    vi.useFakeTimers();
    renderDiorama('extraction');
    // One read settling two passes announces both together (the
    // panel pushes in settlement order; the feed holds newest
    // first — the stage must still play pass 20 before pass 21).
    act(() => {
      useExtractionFeedStore.getState().pushPass(pass({ index: 20, materials: { TechFragments: 1 } }));
      useExtractionFeedStore.getState().pushPass(pass({ index: 21, materials: { BallisticParts: 2 } }));
    });
    expect(screen.getByTestId('extraction-pass-rises').getAttribute('data-pass-key')).toBe('extraction-pass-20');
    // Pass 20's beat holds for its single rise's full duration…
    act(() => { vi.advanceTimersByTime(MOVEMENT.LOOT_RISE_MS + 10); });
    // …then pass 21's beat plays.
    expect(screen.getByTestId('extraction-pass-rises').getAttribute('data-pass-key')).toBe('extraction-pass-21');
    act(() => { vi.advanceTimersByTime(MOVEMENT.LOOT_RISE_MS + 10); });
    expect(screen.queryByTestId('extraction-pass-rises')).toBeNull();
  });
});
