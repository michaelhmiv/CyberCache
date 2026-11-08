/**
 * Panel presence (Full Visual Program M4c) — the panel bay scenes
 * stop being static plates.
 *
 * The defect M4c exists to kill: the workshop's rooms rendered
 * their area's vista as a single frozen plate while the same area
 * on the Home stage had authored bands + ambient life since V1.
 * These tests assert the shell-level contract:
 *  - every ActionScenes scene whose plate belongs to a vista
 *    scene renders that scene's bands (wrapped, repeat-x) and
 *    its four ambient canvases — instanced from the SAME vista
 *    data the Home stage consumes (vistaScenes.ts), never a
 *    panel-local fork;
 *  - the band imagery is the scene spec's own layer sprites
 *    (data identity, not a look-alike);
 *  - a plate with no vista scene (an arena plate) keeps the
 *    plain plate — no bands, no canvases;
 *  - the ambient life is canvas paint: the scene gains no new
 *    animated DOM img nodes for it (composition budgets hold).
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  CraftingBenchScene,
  ExtractionScene,
  RepairBayScene,
  ShieldTechBayScene,
} from '@/components/pixelArt/ActionScenes';
import { requirePixelSprite } from '@/lib/pixel/manifest';
import {
  VISTA_SCENES,
  vistaSceneForBackground,
  type VistaLayerId,
  type VistaSceneSpec,
} from '@/lib/pixel/vistaScenes';
import { expandVistaAmbient } from '@/lib/pixel/vistaAmbient';

const expectVistaShell = (container: HTMLElement, scene: VistaSceneSpec) => {
  for (const layer of ['far', 'mid', 'near'] as VistaLayerId[]) {
    const band = container.querySelector(`[data-vista-band="${layer}"]`);
    expect(band, `${scene.id} ${layer} band`).not.toBeNull();
    const el = band as HTMLDivElement;
    expect(el.style.backgroundRepeat).toBe('repeat-x');
    // Data identity: the band paints the spec's own layer sprite.
    expect(el.style.backgroundImage).toContain(requirePixelSprite(scene.layers[layer]).url);
    expect(container.querySelector(`[data-testid="pixel-ambient-${layer}"]`)).not.toBeNull();
  }
  expect(container.querySelector('[data-testid="pixel-ambient-stage"]')).not.toBeNull();
  // The data the canvases paint from is real: this scene's ambient
  // set expands to instances (the sampler itself is pinned in
  // vistaScenes.test.tsx).
  expect(expandVistaAmbient(scene).length).toBeGreaterThan(0);
};

describe('panel scenes — vista presence (M4c)', () => {
  it('crafting bench scene stands in BlastForge: bands + ambient from the vista data', () => {
    const { container } = render(<CraftingBenchScene progress={0.45} causeLabel="Tempering" working />);
    expectVistaShell(container, VISTA_SCENES.blastforge_yards);
  });

  it('repair bay scene stands in ThrowTech: bands + ambient from the vista data', () => {
    const { container } = render(<RepairBayScene progress={0.45} causeLabel="Repairing" working />);
    expectVistaShell(container, VISTA_SCENES.throwtech_dumpnet);
  });

  it('shield-tech bay scene stands in ThrowTech: bands + ambient from the vista data', () => {
    const { container } = render(<ShieldTechBayScene progress={0.45} causeLabel="Calibrating" working />);
    expectVistaShell(container, VISTA_SCENES.throwtech_dumpnet);
  });

  it('extraction scene (shell parity; unmounted in production by the one-stage law) stands in Dustwaste', () => {
    const { container } = render(<ExtractionScene progress={0.45} causeLabel="Sifting" />);
    expectVistaShell(container, VISTA_SCENES.dustwaste_frontier);
  });

  it('a plate with no vista scene keeps the plain plate — no bands, no ambient canvases', () => {
    expect(vistaSceneForBackground('arena-dune-tyrant')).toBeNull();
    const { container } = render(
      <CraftingBenchScene progress={0.45} causeLabel="Tempering" working backgroundId="arena-dune-tyrant" />,
    );
    expect(container.querySelector('[data-vista-band]')).toBeNull();
    expect(container.querySelector('[data-testid^="pixel-ambient-"]')).toBeNull();
  });

  it('ambient life is canvas paint, not DOM nodes: the treated scene adds no ambient img nodes', () => {
    const { container } = render(<CraftingBenchScene progress={0.45} causeLabel="Tempering" working />);
    // The only canvases in the stage are the four vista ambient
    // canvases (BenchFx draws on its own canvas, outside the
    // stage's ambient set — it is not matched by these testids).
    const ambientCanvases = container.querySelectorAll('canvas[data-testid^="pixel-ambient-"]');
    expect(ambientCanvases.length).toBe(4);
    expect(container.querySelector('[data-testid^="pixel-aprop-"]')).toBeNull();
  });
});
