/**
 * Chest reveal-hold harness page (dash/reveal-hold-shots — dev
 * only) — the REAL ChestScreen for the held-reveal capture: the
 * stores are seeded exactly as the screen suites seed them
 * (cacheKeys 3, settled profile), the Chef transport is answered
 * by chestMain's fetch backstop (the open grants one fixed
 * Legendary — Emberfall), and the capture plan clicks the real
 * OPEN WITH KEY button, waits out the Sample B Legendary step
 * (2600 ms), and photographs the reveal HOLDING at settled.
 * Round 2 (2026-11-20): the reveal is ONE screen — no scrolling
 * anywhere on it — so the plan photographs the hold as it lands
 * (beam, risen item, full deck, and all three actions: Details /
 * Open Another / Collect), then clicks the real Details button
 * for the GearInspectSheet frame.
 *
 * Auth resolves through the harness stub (vite.shots.config.ts).
 * Nothing here is imported by the app bundle; chest-harness.html
 * is served by the capture rig only.
 */
import React from 'react';
import { ChestScreen } from '@/screens/ChestScreen';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore } from '@/store';

// Seed before first render (module scope): the lane's key stock
// and a settled profile, mirroring src/test's seedStores.
useInventoryStore.setState({ items: [] });
useLoadoutStore.setState({
  slots: {
    primary: null, secondary: null, heavy: null, ordnance: null,
    shield: null, classMod: null, relic: null, vehicle: null,
  },
  consumables: { PreFight: null, MidFight: null, Emergency: null },
});
usePlayerStore.setState({
  level: 30, credits: 100_000, scrap: 500, cacheKeys: 3,
  legendaryCores: 0, profileLoaded: true,
});
useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });

// Capture-plan seams: click the real open button; click the held
// reveal's real Details button (round 2). The round-1 scroll seam
// is gone — the revised reveal has no scrollable layer.
declare global {
  interface Window {
    __chestOpen?: () => boolean;
    __chestDetails?: () => boolean;
  }
}

window.__chestOpen = () => {
  const button = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('OPEN WITH KEY'),
  );
  if (!button || (button as HTMLButtonElement).disabled) return false;
  (button as HTMLButtonElement).click();
  return true;
};

window.__chestDetails = () => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === 'Details',
  );
  if (!button || (button as HTMLButtonElement).disabled) return false;
  (button as HTMLButtonElement).click();
  return true;
};

export const ChestHarnessPage: React.FC = () => (
  <div data-testid="chest-harness-root" className="min-h-dvh bg-bg">
    <ChestScreen />
  </div>
);
