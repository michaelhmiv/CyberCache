/**
 * Glow-repaint gallery harness (dev only) — the ACTION_SETS
 * compositions that have no live panel scene, rendered with the
 * production stage shell (PixelStage + PixelActor + the painted
 * hunter) at the golden scenes' placements (src/test/golden/
 * goldenScenes.ts is the layout authority: groupings, x-centres,
 * ground line, area vistas), aspect-true as production draws.
 * Exists so the glow-family set repaint can be reviewed IN SCENE
 * before any swap ships. Driven by ?scene=:
 *
 *   bench-lab    ACTION_SETS.craftingLab (golden 'bench-lab'):
 *                lab bench + refinery furnace, Blastforge vista,
 *                hunter at work.
 *   research     ACTION_SETS.research (golden 'research-study'):
 *                war-room table, research terminal, research
 *                shelf, Helixworks vista, hunter at work.
 *   dispatch     ACTION_SETS.dispatch (golden 'dispatch-pad'):
 *                pad + board + route marker + rover, Dustwaste.
 *   rep-desk     ACTION_SETS.vendor (golden 'rep-desk'): vendor
 *                stall + hanging sign, Dustwaste interior wash,
 *                hunter at rest.
 *   collections  golden 'collections-shelf': the war-room table
 *                fronting the trophy stage, Dustwaste wash.
 *   resurrection ACTION_SETS.resurrection: the pod alone on the
 *                Dustwaste stage — no shipped scene consumes the
 *                set today (grammar declaration only).
 *
 * Nothing here is imported by the app bundle; glow-harness.html
 * is served by the Vite dev server only.
 */
import React from 'react';
import { PixelStage, PixelActor } from '@/components/pixelArt/PixelStage';
import { PixelPaintedHunterActor } from '@/components/pixelArt/PixelPaintedHunterActor';
import { requirePixelSprite } from '@/lib/pixel/manifest';
import { vistaSceneForBackground } from '@/lib/pixel/vistaScenes';

const params = new URLSearchParams(window.location.search);
const scene = params.get('scene') ?? 'research';

const GROUND = 0.86;

const Stage: React.FC<{ backgroundId: string; wash?: boolean; children: React.ReactNode }> = ({ backgroundId, wash, children }) => (
  <div className="relative h-[228px] w-full overflow-hidden border-2 border-border bg-bg" data-testid={`glow-${scene}`}>
    <PixelStage backgroundId={backgroundId} groundY={GROUND} reduced vistaScene={vistaSceneForBackground(backgroundId)} testId={`glow-${scene}-stage`}>
      {wash && <div className="pointer-events-none absolute inset-0 z-[5] bg-black/40" />}
      {children}
    </PixelStage>
  </div>
);

const Hunter: React.FC<{ xPct: number; heightPct?: number }> = ({ xPct, heightPct = 57 }) => (
  <PixelPaintedHunterActor
    sprite={requirePixelSprite('hunter-josie-lode')}
    xPct={xPct}
    heightPct={heightPct}
    groundY={GROUND}
    reduced
    breathe={false}
  />
);

const SCENES: Record<string, React.ReactNode> = {
  'bench-lab': (
    <Stage backgroundId="zone-blastforge-bg">
      <PixelActor spriteId="set-bench-lab" xPct={58} heightPct={36} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-refinery-furnace" xPct={86} heightPct={30} groundY={GROUND} reduced breathe={false} />
      <Hunter xPct={30} />
    </Stage>
  ),
  research: (
    <Stage backgroundId="zone-helixworks-bg">
      <PixelActor spriteId="set-war-room-table" xPct={19} heightPct={26} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-research-terminal" xPct={55} heightPct={36} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-research-shelf" xPct={88} heightPct={44} groundY={GROUND} reduced breathe={false} />
      <Hunter xPct={30} />
    </Stage>
  ),
  dispatch: (
    <Stage backgroundId="zone-dustwaste-bg">
      <PixelActor spriteId="set-dispatch-pad" xPct={50} heightPct={40} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-dispatch-board" xPct={90} heightPct={30} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-dispatch-route" xPct={11.7} heightPct={21} groundY={0.266} reduced breathe={false} />
      <PixelActor spriteId="vehicle-utility-rover" xPct={50} heightPct={17} groundY={GROUND} reduced breathe={false} />
    </Stage>
  ),
  'rep-desk': (
    <Stage backgroundId="zone-dustwaste-bg" wash>
      <PixelActor spriteId="set-vendor-stall" xPct={74} heightPct={34} groundY={GROUND} reduced breathe={false} />
      <PixelActor spriteId="set-vendor-sign" xPct={75} heightPct={20} groundY={0.618} reduced breathe={false} />
      <Hunter xPct={10} heightPct={46} />
    </Stage>
  ),
  collections: (
    <Stage backgroundId="zone-dustwaste-bg" wash>
      <PixelActor spriteId="set-war-room-table" xPct={47} heightPct={20} groundY={GROUND} reduced breathe={false} />
      <Hunter xPct={11} heightPct={46} />
    </Stage>
  ),
  resurrection: (
    <Stage backgroundId="zone-dustwaste-bg">
      <PixelActor spriteId="set-resurrection-pod" xPct={50} heightPct={62} groundY={GROUND} reduced breathe={false} />
    </Stage>
  ),
};

export const GlowHarnessPage: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#0B0B10', padding: 12, boxSizing: 'border-box' }}>
    <div style={{ width: 390, margin: '0 auto' }} data-testid="glow-harness-root">
      {SCENES[scene] ?? SCENES.research}
    </div>
  </div>
);
