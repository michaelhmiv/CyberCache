import React from 'react';
import { motion } from 'framer-motion';
import { PixelStage, PixelActor } from './PixelStage';
import { PixelRigActor } from './PixelRigActor';
import { HUNTER_POSES, hunterRigWithHead } from '@/lib/pixel/rig';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { getPixelSprite, requirePixelSprite } from '@/lib/pixel/manifest';

/**
 * Action scenes (visual overhaul brief §5/§6, gate G4) — every system
 * speaks the shared grammar: G-4 the hunter rig at work, G-5 the
 * system's set dressing, G-3 a progress bar that names its cause, G-6
 * the two-beat result flash. The crafting bench scene dresses the
 * diorama's crafting mode; the repair bay scene ships here complete —
 * its screen wiring belongs to the mechanics & repair slice, which
 * mounts this component unchanged.
 */

export interface ActionSceneProps {
  /** 0..1 progress of the current job. */
  progress: number;
  /** G-3: what fills the bar ("Tempering · 3m 12s left"). */
  causeLabel: string;
  /** G-3: what the bar buys ("→ Forgeheart Ingots ×2"). */
  buysLabel?: string;
  result?: 'success' | 'failure' | null;
  /** Crafted quality %: tints the result flash edge (G-6). */
  qualityPct?: number;
  reduced?: boolean;
}

const ResultFlash: React.FC<{ result: 'success' | 'failure'; qualityPct?: number }> = ({ result, qualityPct }) => (
  <motion.div
    className="pointer-events-none absolute inset-0 z-30"
    style={{
      background: result === 'success' ? `${GRAMMAR.successColor}30` : `${GRAMMAR.failureColor}30`,
      boxShadow: `inset 0 0 0 3px ${qualityPct != null ? GRAMMAR.qualityEdge(qualityPct) : result === 'success' ? GRAMMAR.successColor : GRAMMAR.failureColor}`,
    }}
    initial={{ opacity: 0 }}
    animate={{ opacity: [0, 1, 1, 0] }}
    transition={{
      duration: (GRAMMAR.resultFlash.inMs + GRAMMAR.resultFlash.holdMs + GRAMMAR.resultFlash.outMs) / 1000,
      times: [0, GRAMMAR.resultFlash.inMs / 880, (GRAMMAR.resultFlash.inMs + GRAMMAR.resultFlash.holdMs) / 880, 1],
    }}
  />
);

const CauseProgress: React.FC<{ progress: number; causeLabel: string; buysLabel?: string }> = ({ progress, causeLabel, buysLabel }) => (
  <div className="absolute inset-x-3 bottom-2 z-20">
    <div className="flex items-baseline justify-between text-[10px] font-bold">
      <span className="text-text-primary">{causeLabel}</span>
      {buysLabel && <span className="text-amber">{buysLabel}</span>}
    </div>
    <div className="mt-1 border border-black bg-black/70" style={{ height: GRAMMAR.progress.heightPx }}>
      <div
        className="h-full bg-amber-400 transition-[width] duration-500"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
      />
    </div>
  </div>
);

const SceneShell: React.FC<{
  backgroundId: string;
  testId: string;
  reduced?: boolean;
  result?: 'success' | 'failure' | null;
  qualityPct?: number;
  progress: number;
  causeLabel: string;
  buysLabel?: string;
  children: React.ReactNode;
}> = ({ backgroundId, testId, reduced = false, result, qualityPct, progress, causeLabel, buysLabel, children }) => {
  const groundY = requirePixelSprite(backgroundId).anchors.groundLine?.y ?? 0.86;
  return (
    <div className="relative h-[228px] w-full overflow-hidden border-2 border-border bg-bg" data-testid={testId}>
      <PixelStage backgroundId={backgroundId} groundY={groundY} reduced={reduced} testId={`${testId}-stage`}>
        {children}
        <CauseProgress progress={progress} causeLabel={causeLabel} buysLabel={buysLabel} />
        {result && <ResultFlash result={result} qualityPct={qualityPct} />}
      </PixelStage>
    </div>
  );
};

export const CraftingBenchScene: React.FC<ActionSceneProps & { backgroundId?: string; benchSpriteId?: string }> = ({
  backgroundId = 'zone-blastforge-bg',
  benchSpriteId = 'set-bench-forge',
  reduced = false,
  ...rest
}) => {
  const groundY = requirePixelSprite(backgroundId).anchors.groundLine?.y ?? 0.86;
  return (
    <SceneShell backgroundId={backgroundId} testId="crafting-bench-scene" reduced={reduced} {...rest}>
      <PixelActor spriteId={benchSpriteId} xPct={58} heightPct={36} groundY={groundY} reduced={reduced} breathe={false} testId="crafting-bench-set" />
      <PixelActor spriteId="set-refinery-crusher" xPct={86} heightPct={30} groundY={groundY} reduced={reduced} breathe={false} />
      <PixelRigActor
        rig={hunterRigWithHead('visor')}
        xPct={30}
        heightPct={57}
        groundY={groundY}
        feetX={0.27}
        reduced={reduced}
        pose={HUNTER_POSES.work}
        testId="crafting-bench-hunter"
      />
    </SceneShell>
  );
};

export const RepairBayScene: React.FC<ActionSceneProps & { backgroundId?: string; vehicleSpriteId?: string }> = ({
  backgroundId = 'zone-throwtech-bg',
  vehicleSpriteId = 'vehicle-dune-buggy',
  reduced = false,
  ...rest
}) => {
  const groundY = requirePixelSprite(backgroundId).anchors.groundLine?.y ?? 0.86;
  const vehicle = getPixelSprite(vehicleSpriteId);
  return (
    <SceneShell backgroundId={backgroundId} testId="repair-bay-scene" reduced={reduced} {...rest}>
      <PixelActor spriteId="set-bay-lift" xPct={62} heightPct={38} groundY={groundY} reduced={reduced} breathe={false} testId="repair-bay-lift" />
      <PixelActor spriteId="set-bay-wall-listing" xPct={16} heightPct={30} groundY={groundY} reduced={reduced} breathe={false} />
      {vehicle && (
        <img
          src={vehicle.url}
          alt=""
          draggable={false}
          data-testid="repair-bay-vehicle"
          className="absolute"
          style={{ left: '44%', bottom: `${(1 - groundY) * 100 + 4}%`, width: '30%', imageRendering: 'pixelated', zIndex: 6 }}
        />
      )}
      <PixelActor spriteId="set-bay-tray" xPct={34} heightPct={16} groundY={groundY} reduced={reduced} breathe={false} />
      <PixelRigActor
        rig={hunterRigWithHead('visor')}
        xPct={24}
        heightPct={57}
        groundY={groundY}
        feetX={0.27}
        reduced={reduced}
        pose={HUNTER_POSES.work}
        testId="repair-bay-hunter"
      />
    </SceneShell>
  );
};
