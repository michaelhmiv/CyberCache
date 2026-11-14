import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { HeatChip, HeatStrip, StageHeat, type HeatSpot } from './HeatField';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import {
  EXTRACTION_LEVER_DEFAULTS,
  EXTRACTION_MASTERY_XP_PER_PASS,
  extractionGearFactor,
  extractionPassDraws,
  extractionPassXp,
} from '@/content/extraction';
import { useExtractionFeedStore } from '@/store/slices/extractionFeedSlice';
import { useKillCycleStore, useLoadoutStore } from '@/store';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * HEAT FIELD — gathering / extraction (THROWAWAY harness
 * prototype, iter-09). The REAL LiveTurfDiorama in its shipped
 * extraction mode (stake line, sift rig, crates) with heat at the
 * sift rig — the pass's work point:
 *
 *   heat intensity = finds settled / draws in the pass.
 *
 * Every number is computed IN THIS PAGE from the shipped defs
 * (src/content/extraction.ts) for a Surface pass in Dustwaste
 * Frontier by the fixture hunter (L5, no shield equipped):
 * gear factor via extractionGearFactor, draws via
 * extractionPassDraws (192 finds/h base over the 10-min pass),
 * pass XP via extractionPassXp, mastery +20 / pass
 * (EXTRACTION_MASTERY_XP_PER_PASS). At the yield beat the settled
 * pass is pushed into the real extraction feed, so the stage
 * plays its own shipped rises off the rig. The pass's per-type
 * split is staged (the server folds ~32 draws into per-type
 * counts and discards the order — extractionRise.ts); the TOTAL
 * is the def-computed draws, exact.
 *
 * Drive: window.__setBeat(n): 0 start / 1 flow (half the finds) /
 * 2 yield (pass settles, rises play).
 */

const FIXTURE_WEAPON: Weapon = {
  id: 'roam-harness-weapon',
  name: 'Harness Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [],
  pixelSeed: 42,
} as unknown as Weapon;

const RIG = { x: 58, y: 55 }; // set-extract-rig seat (xPct 58)

export const HeatGatherPage: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);
  const levers = EXTRACTION_LEVER_DEFAULTS;
  const gearFactor = extractionGearFactor({ level: 5, shield: null, area, levers });
  const drawMath = extractionPassDraws({
    method: 'surface',
    masteryLevel: 1,
    gearFactor,
    isHot: false,
    levers,
  });
  const draws = drawMath.draws;
  const passXp = extractionPassXp(5, levers);
  const scrap = draws - Math.floor(draws / 3);
  const ballistic = Math.floor(draws / 3);

  const [finds, setFinds] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
    useLoadoutStore.getState().setSlot('vehicle', null);
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (n: number) => {
      if (n === 0) {
        setFinds(0);
        setSettled(false);
      } else if (n === 1) {
        setFinds(Math.floor(draws / 2));
        setSettled(false);
      } else if (n === 2) {
        setFinds(draws);
        setSettled(true);
        useExtractionFeedStore.getState().pushPass({
          index: 9001,
          areaId: area.id,
          method: 'surface',
          draws,
          gearFactor,
          deepDegraded: false,
          xpAwarded: passXp,
          materials: { Scrap: scrap, BallisticParts: ballistic },
          essences: {},
          signatureUnits: 0,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heat = draws > 0 ? finds / draws : 0;
  const spots: HeatSpot[] =
    heat > 0.01 ? [{ id: 'rig', xPct: RIG.x, yPct: RIG.y, peak: heat, radius: 124, bornAt: 0 }] : [];

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <LiveTurfDiorama
          area={area}
          weapon={FIXTURE_WEAPON}
          playerLevel={5}
          equippedCount={4}
          activityKind="extraction"
        />
        <StageHeat wrapRef={wrapRef} spots={spots} hold tauMs={1100} />
      </div>
      <HeatStrip intensity={heat} scaleLabel={`FULL = ${draws} FINDS`}>
        <HeatChip label="SURFACE PASS" value="Dustwaste Frontier" />
        <HeatChip label="GEAR FACTOR" value={gearFactor.toFixed(2)} />
        <HeatChip label="FINDS" value={`${finds} / ${draws}`} hot={settled} />
        {settled ? (
          <>
            <HeatChip label="SCRAP" value={`+${scrap}`} />
            <HeatChip label="BALLISTICPARTS" value={`+${ballistic}`} />
            <HeatChip label="XP" value={`+${passXp}`} />
            <HeatChip label="MASTERY" value={`+${EXTRACTION_MASTERY_XP_PER_PASS}`} hot />
          </>
        ) : (
          <HeatChip label="PASS" value="10 MIN · 200 TICKS" />
        )}
      </HeatStrip>
    </div>
  );
};
