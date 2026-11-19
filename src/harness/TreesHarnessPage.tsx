/**
 * Trees harness page (first-screen fix R1 render round, dev
 * only) — the FULL Hunter tab at phone width for the owner's
 * full-screen review: the real ProfileScreen inside the real
 * ScreenWrapper scroller with the real BottomNav under it
 * (Hunter active), landed directly on the Skill Trees stop via
 * the screen's own focusSection='skills' deep link — the same
 * landing the Home skill-points banner routes to.
 *
 * The seed is a realistic mid-game state on the owner's own
 * hunter: Doc Sutter fielded at level 18 (17 points earned),
 * 15 spent partway down the Fixer tree — Assembly Rhythm 5/5 and
 * Parallel Hands 5/5 (the craft-time pair maxed), Calibrated Eye
 * 3/5, Tolerance Stacking 1/5, Proof Loads 1/5 — leaving 2 points
 * available and Master Artificer (Tier 7 major, cost 3, both
 * prerequisites met) as the next unlock, 1 point short. Locked,
 * available-soon, spent, and maxed states all show.
 *
 * Driven by URL params (read by the seam in SkillTreeScreen,
 * not by this page):
 *   trees  1 | 2 | 3 — render a variant layout. Absent the
 *          param the screen is the shipped picture.
 *   sel    a node id to pre-select, so the inspect plate is
 *          populated in frame (captures pass sel=fix_major_1 —
 *          the NEXT unlock itself, so the datum and the inspect
 *          tell one story).
 *
 * Seeding follows the repo's screen tests: stores settled
 * directly, auth through the harness stub (vite.trees.config
 * .ts), Chef reads answered offline by treesMain's fetch
 * backstop (the action-skill read gets a real view built by
 * the content module's own actionSkillStateView from this
 * same seed). Nothing here is imported by the app bundle;
 * trees-harness.html is served by the Vite dev server only.
 */
import React from 'react';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { usePlayerStore, useSkillStore } from '@/store';

/** The seed spends — shared with treesMain's action-skill view. */
export const TREES_SEED_SPENT: Record<string, number> = {
  fix_craft_time_1: 5,
  fix_craft_time_2: 5,
  fix_quality_1: 3,
  fix_quality_2: 1,
  fix_ord_1: 1,
};

function seedStores() {
  usePlayerStore.setState({
    id: 'p1',
    level: 18,
    xp: 12837,
    credits: 72900,
    scrap: 198000,
    cacheKeys: 3,
    materials: {},
    essences: {},
    consumables: {},
    profileLoaded: true,
  } as never);
  useSkillStore.setState({
    spent: { ...TREES_SEED_SPENT },
    activeHunterId: 'doc',
  } as never);
}

seedStores();

export const TreesHarnessPage: React.FC = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="trees-harness-root"
  >
    <ScreenWrapper hidden={false}>
      <ProfileScreen focusSection="skills" onNavigate={() => {}} />
    </ScreenWrapper>
    <BottomNav activeTab="hunter" onChange={() => {}} />
  </div>
);
