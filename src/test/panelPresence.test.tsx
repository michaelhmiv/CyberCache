/**
 * Panel presence (Full Visual Program M4c) — the panel bay scenes
 * stop being static plates.
 *
 * The defect M4c exists to kill: the workshop's rooms rendered
 * their area's vista as a single frozen plate while the same area
 * on the Home stage had authored ambient life since V1.
 * These tests assert the shell-level contract:
 *  - every ActionScenes scene whose plate belongs to a vista
 *    scene renders that scene's four ambient canvases over the
 *    one background painting — instanced from the SAME vista data
 *    the Home stage consumes (vistaScenes.ts), never a
 *    panel-local fork;
 *  - the background imagery is the scene spec's own painting
 *    (data identity, not a look-alike);
 *  - a plate with no vista scene (an arena plate) keeps the
 *    plain plate — no canvases;
 *  - the ambient life is canvas paint: the scene gains no new
 *    animated DOM img nodes for it (composition budgets hold).
 * (Plain-bg form, 2026-11-11: the V1 band strips these tests once
 * asserted retired with the vista band system.)
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
  type VistaSceneSpec,
} from '@/lib/pixel/vistaScenes';
import { expandVistaAmbient } from '@/lib/pixel/vistaAmbient';

const expectVistaShell = (container: HTMLElement, scene: VistaSceneSpec) => {
  // No band strips anywhere (the band system is retired).
  expect(container.querySelector('[data-vista-band]')).toBeNull();
  // The background is the scene's own master painting (data
  // identity, not a look-alike).
  const stageImg = Array.from(container.querySelectorAll('img')).find((img) =>
    img.getAttribute('src')?.includes(requirePixelSprite(scene.backgroundId).url),
  );
  expect(stageImg, `${scene.id} painting`).toBeDefined();
  for (const layer of ['far', 'mid', 'near']) {
    expect(container.querySelector(`[data-testid="pixel-ambient-${layer}"]`), `${scene.id} ${layer} ambient`).not.toBeNull();
  }
  expect(container.querySelector('[data-testid="pixel-ambient-stage"]')).not.toBeNull();
  // The data the canvases paint from is real: this scene's ambient
  // set expands to instances (the sampler itself is pinned in
  // vistaScenes.test.tsx).
  expect(expandVistaAmbient(scene).length).toBeGreaterThan(0);
};

describe('panel scenes — vista presence (M4c)', () => {
  it('crafting bench scene stands in BlastForge: painting + ambient from the vista data', () => {
    const { container } = render(<CraftingBenchScene progress={0.45} causeLabel="Tempering" working />);
    expectVistaShell(container, VISTA_SCENES.blastforge_yards);
  });

  it('repair bay scene stands in ThrowTech: painting + ambient from the vista data', () => {
    const { container } = render(<RepairBayScene progress={0.45} causeLabel="Repairing" working />);
    expectVistaShell(container, VISTA_SCENES.throwtech_dumpnet);
  });

  it('shield-tech bay scene stands in ThrowTech: painting + ambient from the vista data', () => {
    const { container } = render(<ShieldTechBayScene progress={0.45} causeLabel="Calibrating" working />);
    expectVistaShell(container, VISTA_SCENES.throwtech_dumpnet);
  });

  it('extraction scene (shell parity; unmounted in production by the one-stage law) stands in Dustwaste', () => {
    const { container } = render(<ExtractionScene progress={0.45} causeLabel="Sifting" />);
    expectVistaShell(container, VISTA_SCENES.dustwaste_frontier);
  });

  it('a plate with no vista scene keeps the plain plate — no ambient canvases', () => {
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
