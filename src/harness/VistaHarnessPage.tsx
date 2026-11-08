import React from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { FIXTURE_WEAPON } from '@/harness/fightFixture';

/**
 * Vista harness (dev-only page, served by the Vite dev server at
 * /vista-harness.html — never part of the production bundle).
 * Drives the REAL LiveTurfDiorama for the Full Visual Program V1
 * landing captures, isolating the STAGE:
 *
 *   ?area=<areaId>    the roaming area (default dustwaste_frontier)
 *   ?scene=roam|idle  roam = activityKind 'roaming_loot' (the Pixi
 *                     stage when WebGL is available, the DOM stage
 *                     under ?renderer=dom); idle = standby, which
 *                     on the landing build is the camp scene.
 *   ?width=<px>       stage width (default 390, phone width).
 *
 * The same file drives the BEFORE build (base master): there the
 * stage serves the zone paintings and idle is the current area
 * behind the lone crate — that contrast is the evidence.
 */
export const VistaHarnessPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene') ?? 'roam';
  const width = Number(params.get('width') ?? 390);
  const area = getRoamingArea(params.get('area') ?? DEFAULT_ROAMING_AREA_ID);
  return (
    <div style={{ width, margin: '0 auto', background: '#0b0e14', minHeight: '100vh' }}>
      <LiveTurfDiorama
        area={area}
        weapon={FIXTURE_WEAPON}
        playerLevel={20}
        equippedCount={7}
        activityKind={scene === 'idle' ? 'idle_standby' : 'roaming_loot'}
      />
    </div>
  );
};
