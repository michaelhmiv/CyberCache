/**
 * Boss identity — the Arena Plate system (audit census C-4).
 *
 * Pins the contract that replaced the procedural SVG emblems
 * (BossPortrait/BossSigil + the bossVisuals registry, all deleted):
 * identity derives from the boss's own shipped sprite — a generated
 * detail-crop window and a two-tone silhouette stamp — and the plate's
 * scrim type fits inside its panel by a measured ladder.
 *
 * The golden values below are the generator's output
 * (scripts/generate-boss-identity.py). If a boss sprite changes, the
 * generator is re-run and these pins move deliberately with it.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { BOSS_IDENTITY_DATA } from '@/lib/pixel/bossIdentityData';
import {
  arenaCellSlice,
  bgCropStyle,
  fitPlateName,
  fitPlateTierLine,
  type PlateMeasure,
} from '@/lib/pixel/bossIdentity';
import { BossArenaPlate } from '@/components/common/BossArenaPlate';
import { BossCell } from '@/components/common/BossCell';
import { BossStamp } from '@/components/common/BossStamp';

const GOLDEN: Record<string, {
  window: [number, number, number];
  rows: number;
  filled: number;
  core: number;
  bodyTone: string;
  coreTone: string;
}> = {
  dune_tyrant: { window: [88, 68, 268], rows: 9, filled: 52, core: 48, bodyTone: '#563d15', coreTone: '#ad8130' },
  siltstalker: { window: [256, 72, 268], rows: 9, filled: 79, core: 0, bodyTone: '#5f381c', coreTone: '#a1511a' },
  heap_guard: { window: [240, 80, 264], rows: 12, filled: 95, core: 9, bodyTone: '#582e1b', coreTone: '#985933' },
  ashgut: { window: [240, 84, 264], rows: 12, filled: 97, core: 7, bodyTone: '#513625', coreTone: '#955f3d' },
  mirage_duster: { window: [80, 140, 268], rows: 16, filled: 114, core: 78, bodyTone: '#225582', coreTone: '#0a9cad' },
  rust_prophet: { window: [128, 68, 268], rows: 16, filled: 109, core: 34, bodyTone: '#462926', coreTone: '#8b5d41' },
  scrap_bishop: { window: [272, 88, 268], rows: 12, filled: 81, core: 17, bodyTone: '#433510', coreTone: '#906d1e' },
  spinneret_widow: { window: [380, 96, 264], rows: 8, filled: 54, core: 50, bodyTone: '#1b5a45', coreTone: '#12977a' },
  mnemosyne_mirror: { window: [0, 0, 268], rows: 16, filled: 107, core: 59, bodyTone: '#592c8d', coreTone: '#8f56d1' },
  static_choir: { window: [68, 80, 268], rows: 16, filled: 143, core: 26, bodyTone: '#442725', coreTone: '#90564f' },
  verdant_maw: { window: [88, 80, 268], rows: 16, filled: 111, core: 86, bodyTone: '#512c18', coreTone: '#855a2e' },
  sister_null: { window: [8, 4, 264], rows: 16, filled: 102, core: 0, bodyTone: '#332042', coreTone: '#6d478c' },
  vaultkeeper_omega: { window: [0, 0, 268], rows: 16, filled: 136, core: 129, bodyTone: '#643c10', coreTone: '#a4681b' },
};

describe('boss identity data — generated from the shipped sprites', () => {
  it('covers exactly the Region 1 roster', () => {
    expect(Object.keys(BOSS_IDENTITY_DATA).sort()).toEqual(REGION_1_BOSSES.map((b) => b.id).sort());
  });

  it('pins every boss window, stamp shape, and tones (golden)', () => {
    for (const boss of REGION_1_BOSSES) {
      const golden = GOLDEN[boss.id];
      const data = BOSS_IDENTITY_DATA[boss.id];
      expect(golden, `${boss.id} golden pin`).toBeTruthy();
      expect(data.window, `${boss.id} window`).toEqual(golden.window);
      expect(data.stamp.cols, `${boss.id} stamp cols`).toBe(14);
      expect(data.stamp.rows, `${boss.id} stamp rows`).toBe(golden.rows);
      const joined = data.stamp.cells.join('');
      expect(joined.replace(/[^B]/g, '').length + joined.replace(/[^C]/g, '').length, `${boss.id} filled`).toBe(golden.filled);
      expect(joined.replace(/[^C]/g, '').length, `${boss.id} core cells`).toBe(golden.core);
      expect(data.stamp.bodyTone, `${boss.id} body tone`).toBe(golden.bodyTone);
      expect(data.stamp.coreTone, `${boss.id} core tone`).toBe(golden.coreTone);
      for (const row of data.stamp.cells) {
        expect(row, `${boss.id} stamp row width`).toHaveLength(14);
        expect(row, `${boss.id} stamp alphabet`).toMatch(/^[.BC]+$/);
      }
    }
  });
});

describe('boss identity procedures', () => {
  it('bgCropStyle maps a crop rect to background size/position', () => {
    const style = bgCropStyle('sprite.png', 776, 512, { x: 88, y: 68, w: 268, h: 268 });
    expect(style.backgroundImage).toBe('url(sprite.png)');
    expect(style.backgroundSize).toBe(`${(776 / 268) * 100}% ${(512 / 268) * 100}%`);
    expect(style.backgroundPosition).toBe(`${(88 / (776 - 268)) * 100}% ${(68 / (512 - 268)) * 100}%`);
  });

  it('arenaCellSlice takes the center square, 30% anchor when it fits', () => {
    expect(arenaCellSlice(960, 320)).toEqual({ x: 320, y: 0, w: 320, h: 320 });
    expect(arenaCellSlice(960, 640)).toEqual({ x: 160, y: 0, w: 640, h: 640 });
    expect(arenaCellSlice(400, 1000)).toEqual({ x: 0, y: 300, w: 400, h: 400 });
  });
});

describe('plate type fitting — scrim text never leaves its panel', () => {
  const measure06: PlateMeasure = (text, size) => text.length * size * 0.6;
  const SCRIM_TEXT_MAX = 142;

  it('keeps a short name on one line at Poster size', () => {
    expect(fitPlateName('Ashgut', SCRIM_TEXT_MAX, measure06)).toEqual({ lines: ['ASHGUT'], fontSize: 23 });
  });

  it('splits a comma name at its own seam', () => {
    const fit = fitPlateName('Gromm, The Heap Guard', SCRIM_TEXT_MAX, measure06);
    expect(fit.lines).toEqual(['GROMM,', 'THE HEAP GUARD']);
    expect(fit.fontSize).toBe(16);
  });

  it('splits a long name at a word boundary', () => {
    const fit = fitPlateName('The Mnemosyne Mirror', SCRIM_TEXT_MAX, measure06);
    expect(fit.lines).toEqual(['THE MNEMOSYNE', 'MIRROR']);
    // Two-line forms cap at 16 (vertical budget — see the stack test
    // below); at the old 18–20 cap this fit horizontally and still
    // pushed the mechanic line under the plate's foot strip.
    expect(fit.fontSize).toBe(16);
  });

  it('the full scrim stack fits the plate height for every roster boss', () => {
    // Vertical model of BossArenaPlate's scrim (CSS px, plate height
    // 118, foot strip 4): top padding 10 + name lines at 1.04 line
    // height + tier margin 3 + tier 11px at 1.2 + chip margin 7 +
    // chip (11px at 1.2 + 4 padding + 3 border) + mechanic margin 7 +
    // mechanic 11px at 1.2. The mechanic line's box must end above
    // the foot strip (118 - 4 = 114).
    const stackHeight = (lines: number, fontSize: number) =>
      10 + lines * fontSize * 1.04 + 3 + 11 * 1.2 + 7 + (11 * 1.2 + 4 + 3) + 7 + 11 * 1.2;
    for (const boss of REGION_1_BOSSES) {
      const fit = fitPlateName(boss.name, SCRIM_TEXT_MAX, measure06);
      expect(
        stackHeight(fit.lines.length, fit.fontSize),
        `${boss.id} stack at ${fit.fontSize}px x${fit.lines.length}`,
      ).toBeLessThanOrEqual(114);
      if (fit.lines.length > 1) {
        expect(fit.fontSize, `${boss.id} two-line cap`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('every roster name fits the scrim under a realistic measure', () => {
    for (const boss of REGION_1_BOSSES) {
      const fit = fitPlateName(boss.name, SCRIM_TEXT_MAX, measure06);
      for (const line of fit.lines) {
        expect(measure06(line, fit.fontSize), `${boss.id} line "${line}"`).toBeLessThanOrEqual(SCRIM_TEXT_MAX);
      }
    }
  });

  it('tier line compacts along its ladder only as far as needed', () => {
    const narrow: PlateMeasure = (text, size) => text.length * size * 0.5;
    expect(fitPlateTierLine(1, 5, 1, SCRIM_TEXT_MAX, narrow)).toBe('TIER 1 · LV 5 · 1 PHASE');
    const wide: PlateMeasure = (text, size) => text.length * size * 0.55;
    expect(fitPlateTierLine(13, 75, 3, SCRIM_TEXT_MAX, wide)).toBe('T13 · LV75 · 3 PHASES');
  });
});

describe('boss identity components', () => {
  const bossById = (id: string) => REGION_1_BOSSES.find((b) => b.id === id)!;

  it('the Arena Plate presents the boss: name, weakness chip, mechanic', () => {
    render(<BossArenaPlate boss={bossById('dune_tyrant')} />);
    expect(screen.getByTestId('boss-arena-plate')).toBeTruthy();
    expect(screen.getByText('DUNE TYRANT')).toBeTruthy();
    expect(screen.getByText('WEAK: KINETIC')).toBeTruthy();
    expect(screen.getByText('No Special Mechanic')).toBeTruthy();
  });

  it('the Arena Plate splits Sister Null at her name seam', () => {
    render(<BossArenaPlate boss={bossById('sister_null')} />);
    expect(screen.getByText('SISTER NULL,')).toBeTruthy();
    expect(screen.getByText('THE VOID ANCHOR')).toBeTruthy();
    expect(screen.getByText('WEAK: VOID')).toBeTruthy();
    expect(screen.getByText('Rift Anchor')).toBeTruthy();
  });

  it('the cell renders at encounter and defeat sizes', () => {
    const { rerender } = render(<BossCell bossId="dune_tyrant" size={48} />);
    const cell = screen.getByTestId('boss-cell');
    expect(cell.style.width).toBe('48px');
    rerender(<BossCell bossId="dune_tyrant" size={38} />);
    expect(screen.getByTestId('boss-cell').style.width).toBe('38px');
  });

  it('the stamp holds its grid footprint', () => {
    const { container } = render(<BossStamp bossId="dune_tyrant" size={20} />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.style.width).toBe('20px');
    // 14x9 grid at 20px wide -> 13px tall.
    expect(mark.style.height).toBe('13px');
  });
});
