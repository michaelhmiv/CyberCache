/**
 * CAPTURE-ONLY harness (branch dash/hunters-r2 — NEVER merged).
 * Drives the REAL shipped components with the ?painting= figure swap:
 *   ?page=roam      LiveTurfDiorama roam (renderer=dom|pixi via main),
 *                   scene=camp renders camp idle (activity cleared).
 *   ?page=boss      BossFightStageDom at rest — the real 228px strip.
 *   ?page=endless   LiveTurfDiorama endless fight (DEPTH chip rides
 *                   the embedded BossFightStage depthBadge).
 *   ?page=huntertab The REAL ProfileScreen (Hunter tab): stop=hub|
 *                   trees|wardrobe via its own focusSection deep-link.
 *   ?page=roster    PROPOSED roster stop — does not exist in the
 *                   shipped app; composed in the HunterPlates register
 *                   and labeled PROPOSED on the plate itself.
 */
import React, { useEffect, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { Bolts, PlateFootStrip } from '@/components/profile/HunterPlates';
import { AMBER, BONE, BONE_FAINT, plateShell } from '@/components/profile/hunterPlateTheme';
import { PaintedHunterFigure } from './paintingSwap';
import { PAINTINGS } from './paintingData';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useBossStore, useKillCycleStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { FIXTURE_BOSS_ID, FIXTURE_PHASES, FIXTURE_WEAPON, freezeSnapshot } from './fightFixture';

const WEAPON: Weapon = {
  id: 'roam-harness-weapon', name: 'Harness Carbine', weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood, rarity: Rarity.Epic, element: Element.Fire, level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } }, { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } }, { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } }, { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ], pixelSeed: 42,
} as unknown as Weapon;
void DropSource;

const Roam: React.FC<{ camp: boolean }> = ({ camp }) => {
  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 80, currentTargetHpMax: 100 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
  }, []);
  return (
    <LiveTurfDiorama
      area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
      weapon={WEAPON}
      playerLevel={5}
      equippedCount={4}
      activityKind={camp ? undefined : 'roaming_loot'}
    />
  );
};

const Endless: React.FC = () => {
  useState(() => {
    const store = useBossStore.getState() as unknown as {
      setEndlessPresentation?: (p: unknown) => void;
    };
    store.setEndlessPresentation?.({
      timeline: freezeSnapshot(2),
      phases: FIXTURE_PHASES,
      runId: 'run-1',
      depth: 3,
      encounterId: 'dune_tyrant',
      band: 0,
      weapon: FIXTURE_WEAPON,
      signatureFire: null,
    });
    return true;
  });
  return (
    <LiveTurfDiorama
      area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
      weapon={FIXTURE_WEAPON}
      playerLevel={20}
      equippedCount={7}
      activityKind="endless_run"
      endlessRunId="run-1"
    />
  );
};

const ROSTER: Array<{ key: string; name: string; tree: string; color: string }> = [
  { key: 'vesper', name: 'VESPER COLE', tree: 'GUNSLINGER', color: '#FF4B5C' },
  { key: 'silas', name: 'SILAS BOONE', tree: 'DEMOLITION', color: '#FF9000' },
  { key: 'josie', name: 'JOSIE LODE', tree: 'SCAVENGER', color: '#7CFC00' },
  { key: 'doc', name: 'DOC SUTTER', tree: 'FIXER', color: '#2EC4B6' },
];

const Roster: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div className="relative overflow-hidden" style={plateShell}>
      <Bolts />
      <div className="relative px-4 py-3">
        <div style={{ color: BONE, fontWeight: 900, letterSpacing: '0.08em', fontSize: 15 }}>ROSTER</div>
        <div style={{ color: AMBER, fontWeight: 800, fontSize: 11, letterSpacing: '0.06em' }}>PROPOSED — NOT IN SHIPPED APP</div>
      </div>
      <PlateFootStrip color={AMBER} />
    </div>
    {ROSTER.map((h) => (
      <div key={h.key} className="relative overflow-hidden" style={plateShell}>
        <Bolts />
        <div className="relative" style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ position: 'relative', width: 92, height: 128, flexShrink: 0 }}>
            <PaintedHunterFigure painting={PAINTINGS[h.key]} xPct={50} heightPct={94} groundY={0.97} />
          </div>
          <div style={{ padding: '14px 6px' }}>
            <div style={{ color: BONE, fontWeight: 900, fontSize: 14, letterSpacing: '0.05em' }}>{h.name}</div>
            <div style={{ color: BONE_FAINT, fontWeight: 800, fontSize: 11, letterSpacing: '0.06em', marginTop: 4 }}>{h.tree}</div>
          </div>
        </div>
        <PlateFootStrip color={h.color} />
      </div>
    ))}
  </div>
);

export const HuntersCapturePage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const page = params.get('page') ?? 'roam';
  const stop = params.get('stop') ?? 'hub';
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box', minHeight: '100vh' }} data-testid="hunters-capture-root">
      {page === 'roam' && <Roam camp={params.get('scene') === 'camp'} />}
      {page === 'boss' && (
        <BossFightStageDom timeline={freezeSnapshot(0)} phases={FIXTURE_PHASES} bossId={FIXTURE_BOSS_ID} weapon={FIXTURE_WEAPON} />
      )}
      {page === 'endless' && <Endless />}
      {page === 'huntertab' && (
        <ProfileScreen focusSection={stop === 'trees' ? 'skills' : stop === 'wardrobe' ? 'wardrobe' : null} />
      )}
      {page === 'roster' && <Roster />}
    </div>
  );
};
