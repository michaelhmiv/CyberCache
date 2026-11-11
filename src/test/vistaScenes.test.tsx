/**
 * Vista scenes — plain-background form (owner ruling 2026-11-11).
 *
 * Pins: every scene's background is ONE master painting (the
 * Top-Choice Wave 9.75 raw masters at shipping shape) whose sprite
 * resolves in the manifest; NO band sprite id resolves anywhere
 * (the V1 far/mid/near band stack is retired); scene selection
 * (area scene for zone backgrounds, camp for idle, null for
 * arenas); the manifest's vista family measures exactly the
 * 8 paintings + surviving ambient/props; ambient instancing from
 * data keeps every scene's elements rendering; sampling is
 * deterministic in the wall clock; motion families behave.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { getPixelManifest, getPixelSprite } from '@/lib/pixel/manifest';
import {
  CAMP_VISTA_SCENE,
  VISTA_SCENES,
  VISTA_STAGE_W,
  vistaSceneForBackground,
} from '@/lib/pixel/vistaScenes';
import {
  expandVistaAmbient,
  sampleVistaAmbient,
  vistaInstanceStageAnchor,
  vistaSpriteDesignSize,
} from '@/lib/pixel/vistaAmbient';
import { PixelStage } from '@/components/pixelArt/PixelStage';

const AREA_IDS = [
  'dustwaste_frontier',
  'redline_circuit',
  'ironwood_bastion',
  'blastforge_yards',
  'prismatek_reactor',
  'throwtech_dumpnet',
  'helixworks_labyrinth',
];

const SCENE_SLUGS: Record<string, string> = {
  dustwaste_frontier: 'dustwaste',
  redline_circuit: 'redline',
  ironwood_bastion: 'ironwood',
  blastforge_yards: 'blastforge',
  prismatek_reactor: 'prismatek',
  throwtech_dumpnet: 'throwtech',
  helixworks_labyrinth: 'helixworks',
};

describe('vista scene data', () => {
  it('every area has a scene whose painting and ambient sprites resolve in the manifest', () => {
    for (const areaId of AREA_IDS) {
      const scene = VISTA_SCENES[areaId];
      expect(scene, areaId).toBeDefined();
      // The one background painting: the shipped JPEG's own
      // dimensions (1440x960, the Scenario-S shipping shape).
      const bg = getPixelSprite(scene.backgroundId);
      expect(bg, `${areaId} bg`).toBeDefined();
      expect(bg!.width).toBe(1440);
      expect(bg!.height).toBe(960);
      expect(bg!.url.endsWith('.jpg')).toBe(true);
      // Zone ground line: actors anchor on the painted ground.
      expect(bg!.anchors.groundLine?.y).toBeCloseTo(0.86, 4);
      expect(scene.ambient.length).toBeGreaterThanOrEqual(7);
      for (const el of scene.ambient) {
        expect(el.anchorSpace, `${areaId} ${el.id}`).toBe('stage');
        expect(getPixelSprite(el.spriteId), `${areaId} ${el.id}`).toBeDefined();
        for (const v of el.variants ?? []) {
          expect(getPixelSprite(v), `${areaId} ${el.id} variant`).toBeDefined();
        }
      }
    }
  });

  it('no band sprite ids resolve (the band system is retired)', () => {
    for (const slug of [...Object.values(SCENE_SLUGS), 'camp']) {
      for (const layer of ['far', 'mid', 'near']) {
        expect(getPixelSprite(`${slug === 'camp' ? 'camp' : `zone-${slug}`}-${layer}`), `${slug}-${layer}`).toBeUndefined();
      }
    }
    expect(Object.keys(getPixelManifest().sprites).some((id) => /(^|-)far$|(^|-)mid$|(^|-)near$/.test(id) && (id.startsWith('zone-') || id.startsWith('camp-')))).toBe(false);
  });

  it('camp scene resolves with its props as separate sprites', () => {
    for (const id of ['camp-bg', 'camp-crate', 'camp-firepit', 'camp-fireglow', 'camp-supply', 'camp-flame', 'camp-smoke']) {
      expect(getPixelSprite(id), id).toBeDefined();
    }
    expect(CAMP_VISTA_SCENE.ambient.length).toBe(6);
    // Camp ground line: the seat record's hunter feet (600/640).
    expect(getPixelSprite('camp-bg')!.anchors.groundLine?.y).toBeCloseTo(0.9375, 4);
  });

  it('the vista family measures the 8 paintings plus the surviving ambient and props', () => {
    let familyBytes = 0;
    let paintingBytes = 0;
    for (const [id, entry] of Object.entries(getPixelManifest().sprites)) {
      if (id.startsWith('zone-') || id.startsWith('vista-') || id.startsWith('camp-')) {
        const size = statSync(join(process.cwd(), 'src/assets/pixel', entry.src)).size;
        expect(existsSync(join(process.cwd(), 'src/assets/pixel', entry.src))).toBe(true);
        familyBytes += size;
        if (id.endsWith('-bg')) {
          paintingBytes += size;
          // The backgrounds are the masters' JPEGs now.
          expect(entry.src.endsWith('.jpg'), `${id} not a painting`).toBe(true);
        }
      }
    }
    // Measured on the branch (2026-11-11): 8 master paintings at
    // Scenario-S shape (JPEG q88, 1440 wide) = 1,997,744 B; the
    // surviving ambient sprites + camp props = 10,318 B.
    expect(paintingBytes).toBe(1_997_744);
    expect(familyBytes).toBe(2_008_062);
  });

  it('scene selection: zone backgrounds resolve, arenas and unknowns do not', () => {
    expect(vistaSceneForBackground('zone-dustwaste-bg')?.id).toBe('dustwaste_frontier');
    expect(vistaSceneForBackground('zone-helixworks-bg')?.id).toBe('helixworks_labyrinth');
    expect(vistaSceneForBackground('camp-bg')?.id).toBe('camp');
    expect(vistaSceneForBackground('arena-dune-tyrant')).toBeNull();
    expect(vistaSceneForBackground('zone-nope-bg')).toBeNull();
    expect(vistaSceneForBackground(null)).toBeNull();
  });
});

describe('vista ambient sampler', () => {
  const scene = VISTA_SCENES.dustwaste_frontier;
  const instances = expandVistaAmbient(scene);

  it('instances expand from data rows: field counts and variants hold', () => {
    const embers = instances.filter((i) => i.el.id === 'dw-embers');
    expect(embers).toHaveLength(14);
    expect(new Set(embers.map((i) => i.spriteId)).size).toBe(2); // ember-a + ember-b variants
    const total = instances.length;
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it('sampling is deterministic in the clock', () => {
    const clock = { wallMs: 12_345 };
    for (const inst of instances) {
      expect(sampleVistaAmbient(inst, clock)).toEqual(sampleVistaAmbient(inst, clock));
    }
  });

  it('drift wraps: after exactly one span cycle a cloud is back where it started', () => {
    const cloud = instances.find((i) => i.el.id === 'dw-cloud-bank-1')!;
    const motion = cloud.el.motion;
    if (motion.kind !== 'drift') throw new Error('expected drift');
    const { w } = vistaSpriteDesignSize(cloud.spriteId, cloud.el.scale);
    // Span = stage width + 2x wrap margin + sprite width, at the
    // row's own speed.
    const cycleMs = ((VISTA_STAGE_W + 2 * motion.wrapMarginPx + w) / motion.speedPxS) * 1000;
    const early = sampleVistaAmbient(cloud, { wallMs: 0 });
    const later = sampleVistaAmbient(cloud, { wallMs: cycleMs });
    expect(Number.isFinite(early.cx)).toBe(true);
    expect(Math.abs(later.cx - early.cx)).toBeLessThan(0.01);
    // And it does travel in between.
    const mid = sampleVistaAmbient(cloud, { wallMs: cycleMs / 4 });
    expect(Math.abs(mid.cx - early.cx)).toBeGreaterThan(100);
  });

  it('converted rows keep their composed stage positions (band-era heroes)', () => {
    const prScene = VISTA_SCENES.prismatek_reactor;
    const prInstances = expandVistaAmbient(prScene);
    const core = prInstances.find((i) => i.el.id === 'pr-core-pulse')!;
    // Authored in band space at (682, 212) in the mid band; the
    // plain-bg conversion through the retired band's own display
    // transform at rest puts its stage bottom-edge at y 448.
    expect(core.el.anchorSpace).toBe('stage');
    expect(core.el.x).toBeCloseTo(888.8, 1);
    expect(core.el.y).toBeCloseTo(448, 1);
    const anchor = vistaInstanceStageAnchor(core);
    expect(anchor).toEqual({ cx: core.el.x, bottom: core.el.y });
    // And it still samples (renders) at that anchor.
    const sample = sampleVistaAmbient(core, { wallMs: 0 });
    expect(sample.visible).toBe(true);
    expect(sample.cx).toBeCloseTo(core.el.x, 0);
  });

  it('blink elements honor their duty cycle', () => {
    const ttScene = VISTA_SCENES.throwtech_dumpnet;
    const blink = expandVistaAmbient(ttScene).find((i) => i.el.id === 'tt-signal-blink')!;
    const on = sampleVistaAmbient(blink, { wallMs: 0 });
    const off = sampleVistaAmbient(blink, { wallMs: 1000 });
    expect(on.visible).toBe(true);
    expect(off.visible).toBe(false);
  });
});

describe('vista stage rendering (DOM)', () => {
  it('PixelStage renders the plain painting + ambient canvases for a vista scene, with no band nodes or aprops', () => {
    const scene = VISTA_SCENES.dustwaste_frontier;
    const { container, queryByTestId } = render(
      <PixelStage backgroundId={scene.backgroundId} areaId="dustwaste_frontier" vistaScene={scene}>
        <div data-testid="child" />
      </PixelStage>,
    );
    // No band strips of any kind.
    expect(container.querySelector('[data-vista-band]')).toBeNull();
    for (const layer of ['far', 'mid', 'near']) {
      expect(queryByTestId(`pixel-layer-${layer}`)).toBeNull();
      // The ambient canvases still render per paint layer.
      expect(queryByTestId(`pixel-ambient-${layer}`), layer).not.toBeNull();
    }
    expect(queryByTestId('pixel-ambient-stage')).not.toBeNull();
    // Authored ambient supersedes the aprop drift + generic embers.
    expect(container.querySelector('[data-testid^="pixel-aprop-"]')).toBeNull();
  });

  it('without a vista scene the stage renders no layer strips and no ambient canvases', () => {
    const { queryByTestId } = render(
      <PixelStage backgroundId="zone-dustwaste-bg" areaId="dustwaste_frontier" />,
    );
    expect(queryByTestId('pixel-layer-far')).toBeNull();
    expect(queryByTestId('pixel-layer-mid')).toBeNull();
    expect(queryByTestId('pixel-layer-near')).toBeNull();
    expect(queryByTestId('pixel-ambient-far')).toBeNull();
  });
});
