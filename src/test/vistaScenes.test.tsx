/**
 * V1 vista landing — the authored vista scenes as data, their
 * wiring into the home stage, and the ambient sampler contract.
 *
 * Pins: every scene's sprites resolve in the manifest; the zone
 * paintings are gone; scene selection (area scene for zone
 * backgrounds, camp for idle, null for arenas); band wrap math
 * (seamless at any pan offset); ambient instancing from data;
 * band-anchored elements ride the pan while stage elements ignore
 * it (Layered-Motion Law); motion families behave.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { getPixelManifest, getPixelSprite } from '@/lib/pixel/manifest';
import {
  CAMP_VISTA_SCENE,
  VISTA_BAND_W,
  VISTA_SCENES,
  VISTA_STAGE_W,
  vistaBandDisplayW,
  vistaBandRestOffset,
  vistaPanOffsets,
  vistaSceneForBackground,
  type VistaLayerId,
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

describe('vista scene data', () => {
  it('every area has a scene whose bands and ambient sprites resolve in the manifest', () => {
    for (const areaId of AREA_IDS) {
      const scene = VISTA_SCENES[areaId];
      expect(scene, areaId).toBeDefined();
      for (const layer of ['far', 'mid', 'near'] as VistaLayerId[]) {
        expect(getPixelSprite(scene.layers[layer]), `${areaId} ${layer}`).toBeDefined();
        // Bands are the authored texel files: 360 file px wide.
        expect(getPixelSprite(scene.layers[layer])!.width).toBe(360);
      }
      expect(getPixelSprite(scene.backgroundId)!.width).toBe(240);
      expect(scene.ambient.length).toBeGreaterThanOrEqual(7);
      for (const el of scene.ambient) {
        expect(getPixelSprite(el.spriteId), `${areaId} ${el.id}`).toBeDefined();
        for (const v of el.variants ?? []) {
          expect(getPixelSprite(v), `${areaId} ${el.id} variant`).toBeDefined();
        }
      }
    }
  });

  it('camp scene resolves with its props as separate sprites', () => {
    for (const id of ['camp-bg', 'camp-far', 'camp-mid', 'camp-near', 'camp-crate', 'camp-firepit', 'camp-fireglow', 'camp-supply', 'camp-flame', 'camp-smoke']) {
      expect(getPixelSprite(id), id).toBeDefined();
    }
    expect(CAMP_VISTA_SCENE.ambient.length).toBe(6);
    // Camp ground line: the seat record's hunter feet (600/640).
    expect(getPixelSprite('camp-bg')!.anchors.groundLine?.y).toBeCloseTo(0.9375, 4);
  });

  it('the zone paintings are out of the bundle and the authored sets are tiny', () => {
    let zoneBytes = 0;
    for (const [id, entry] of Object.entries(getPixelManifest().sprites)) {
      if (id.startsWith('zone-')) {
        // Zone stacks are authored PNGs now (arenas keep their JPGs
        // — boss art is out of this slice's scope).
        expect(entry.src.endsWith('.png'), `${id} still a painting`).toBe(true);
      }
      if (id.startsWith('zone-') || id.startsWith('vista-') || id.startsWith('camp-')) {
        zoneBytes += statSync(join(process.cwd(), 'src/assets/pixel', entry.src)).size;
        expect(existsSync(join(process.cwd(), 'src/assets/pixel', entry.src))).toBe(true);
      }
    }
    // All eight authored sets (bands + ambient + camp props).
    expect(zoneBytes).toBe(66_305);
    expect(zoneBytes).toBeLessThan(100_000);
  });

  it('scene selection: zone backgrounds resolve, arenas and unknowns do not', () => {
    expect(vistaSceneForBackground('zone-dustwaste-bg')?.id).toBe('dustwaste_frontier');
    expect(vistaSceneForBackground('zone-helixworks-bg')?.id).toBe('helixworks_labyrinth');
    expect(vistaSceneForBackground('camp-bg')?.id).toBe('camp');
    expect(vistaSceneForBackground('arena-dune-tyrant')).toBeNull();
    expect(vistaSceneForBackground('zone-nope-bg')).toBeNull();
    expect(vistaSceneForBackground(null)).toBeNull();
  });

  it('bands are 1.5x the stage and the rest offset centers the crop', () => {
    expect(VISTA_BAND_W).toBe(VISTA_STAGE_W * 1.5);
    for (const layer of ['far', 'mid', 'near'] as VistaLayerId[]) {
      const dispW = vistaBandDisplayW(layer);
      expect(dispW).toBeGreaterThan(VISTA_STAGE_W);
      expect(vistaBandRestOffset(layer)).toBeCloseTo((dispW - VISTA_STAGE_W) / 2, 6);
    }
  });

  it('pan offsets grow with roam time and wrap seamlessly by displayed width', () => {
    const scene = VISTA_SCENES.dustwaste_frontier;
    const at0 = vistaPanOffsets(scene, 0);
    const at60 = vistaPanOffsets(scene, 60_000);
    for (const layer of ['far', 'mid', 'near'] as VistaLayerId[]) {
      expect(at0[layer]).toBeCloseTo(vistaBandRestOffset(layer), 6);
      expect(at60[layer] - at0[layer]).toBeCloseTo(scene.panPxS[layer] * 60, 6);
      // Wrapping by exactly one displayed band width is a no-op —
      // the renderer's mod arithmetic is seamless at any offset.
      const dispW = vistaBandDisplayW(layer);
      expect(((at60[layer] % dispW) + dispW) % dispW).toBeCloseTo(((at60[layer] + dispW) % dispW + dispW) % dispW, 6);
    }
    // Parallax law: near pans fastest, far slowest.
    expect(scene.panPxS.near).toBeGreaterThan(scene.panPxS.mid);
    expect(scene.panPxS.mid).toBeGreaterThan(scene.panPxS.far);
    // Camp never pans.
    expect(vistaPanOffsets(CAMP_VISTA_SCENE, 60_000)).toEqual(vistaPanOffsets(CAMP_VISTA_SCENE, 0));
  });
});

describe('vista ambient sampler', () => {
  const scene = VISTA_SCENES.dustwaste_frontier;
  const instances = expandVistaAmbient(scene);
  const noPan = vistaPanOffsets(scene, 0);

  it('instances expand from data rows: field counts and variants hold', () => {
    const embers = instances.filter((i) => i.el.id === 'dw-embers');
    expect(embers).toHaveLength(14);
    expect(new Set(embers.map((i) => i.spriteId)).size).toBe(2); // ember-a + ember-b variants
    const total = instances.length;
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it('sampling is deterministic in the clock', () => {
    const clock = { wallMs: 12_345, panMs: 0 };
    for (const inst of instances) {
      expect(sampleVistaAmbient(inst, clock, noPan)).toEqual(sampleVistaAmbient(inst, clock, noPan));
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
    const early = sampleVistaAmbient(cloud, { wallMs: 0, panMs: 0 }, noPan);
    const later = sampleVistaAmbient(cloud, { wallMs: cycleMs, panMs: 0 }, noPan);
    expect(Number.isFinite(early.cx)).toBe(true);
    expect(Math.abs(later.cx - early.cx)).toBeLessThan(0.01);
    // And it does travel in between.
    const mid = sampleVistaAmbient(cloud, { wallMs: cycleMs / 4, panMs: 0 }, noPan);
    expect(Math.abs(mid.cx - early.cx)).toBeGreaterThan(100);
  });

  it('band-anchored elements ride the pan; stage elements ignore it', () => {
    const prScene = VISTA_SCENES.prismatek_reactor;
    const prInstances = expandVistaAmbient(prScene);
    const core = prInstances.find((i) => i.el.id === 'pr-core-pulse')!;
    expect(core.el.anchorSpace).toBe('band');
    const shard = prInstances.find((i) => i.el.id === 'pr-shard-drift-1')!;
    expect(shard.el.anchorSpace).toBe('stage');
    const pan0 = vistaPanOffsets(prScene, 0);
    const pan10 = vistaPanOffsets(prScene, 10_000);
    const coreAt0 = vistaInstanceStageAnchor(core, pan0);
    const coreAt10 = vistaInstanceStageAnchor(core, pan10);
    // The core moves left by exactly the mid layer's pan growth.
    expect(coreAt0.cx - coreAt10.cx).toBeCloseTo(pan10.mid - pan0.mid, 6);
    const shardAt0 = vistaInstanceStageAnchor(shard, pan0);
    const shardAt10 = vistaInstanceStageAnchor(shard, pan10);
    expect(shardAt10).toEqual(shardAt0);
  });

  it('blink elements honor their duty cycle', () => {
    const ttScene = VISTA_SCENES.throwtech_dumpnet;
    const blink = expandVistaAmbient(ttScene).find((i) => i.el.id === 'tt-signal-blink')!;
    const pan = vistaPanOffsets(ttScene, 0);
    const on = sampleVistaAmbient(blink, { wallMs: 0, panMs: 0 }, pan);
    const off = sampleVistaAmbient(blink, { wallMs: 1000, panMs: 0 }, pan);
    expect(on.visible).toBe(true);
    expect(off.visible).toBe(false);
  });
});

describe('vista stage rendering (DOM)', () => {
  it('PixelStage renders wrapped bands + ambient canvases for a vista scene, with no paintings-era strips or aprops', () => {
    const scene = VISTA_SCENES.dustwaste_frontier;
    const { container, queryByTestId } = render(
      <PixelStage backgroundId={scene.backgroundId} areaId="dustwaste_frontier" vistaScene={scene} vistaPanActive>
        <div data-testid="child" />
      </PixelStage>,
    );
    for (const layer of ['far', 'mid', 'near'] as VistaLayerId[]) {
      const band = queryByTestId(`pixel-layer-${layer}`);
      expect(band, layer).not.toBeNull();
      expect(band!.getAttribute('data-vista-band')).toBe(layer);
      expect((band as HTMLDivElement).style.backgroundRepeat).toBe('repeat-x');
      expect((band as HTMLDivElement).style.backgroundImage).toContain('zone-dustwaste');
      expect(queryByTestId(`pixel-ambient-${layer}`)).not.toBeNull();
    }
    expect(queryByTestId('pixel-ambient-stage')).not.toBeNull();
    // Authored ambient supersedes the aprop drift + generic embers.
    expect(container.querySelector('[data-testid^="pixel-aprop-"]')).toBeNull();
  });

  it('without a vista scene the stage keeps the re-cut strips (no vista nodes)', () => {
    const { queryByTestId } = render(
      <PixelStage backgroundId="zone-dustwaste-bg" areaId="dustwaste_frontier" />,
    );
    const band = queryByTestId('pixel-layer-far');
    expect(band).not.toBeNull();
    expect(band!.getAttribute('data-vista-band')).toBeNull();
    expect(queryByTestId('pixel-ambient-far')).toBeNull();
  });
});
