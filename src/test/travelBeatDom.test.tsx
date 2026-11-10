/**
 * Motion M2b — the travel beat on the DOM renderer (the no-WebGL
 * fallback path, which is also what jsdom mounts: WebGL detection
 * fails and PixelSceneLayer takes its real fallback).
 *
 * The proof contract: roaming with a target engages the stride
 * on the hunter actor (roam start); the beat settles back to the
 * held pose when its window closes; a target arriving mid-roam
 * engages it again (the between-enemy advance); and the Stop
 * interrupt — the activity leaving roaming mid-stride — leaves
 * no stuck stride anywhere on the stage.
 *
 * Timing note: activation lands ~900ms after mount in jsdom —
 * the chain is driver frame → state flip → the actor's own
 * SEGMENT start beat (320ms) — so the pumps below are sized to
 * the chain, not to the 850ms window alone.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const TRAVEL_WEAPON: Weapon = {
  id: 'travel-test-weapon',
  name: 'Travel Test Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;

const pump = async (ms: number) => {
  // Pump in act slices so React flushes the driver's state flips
  // (and the actor's engage) along the way, as a browser's frame
  // loop would — one long act starves the chain until its end.
  const SLICE = 150;
  for (let elapsed = 0; elapsed < ms; elapsed += SLICE) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, Math.min(SLICE, ms - elapsed)));
    });
  }
};

const seedTarget = (id: string | null, hp = 80, max = 100) =>
  useKillCycleStore.setState({
    currentTargetId: id,
    currentTargetHp: id ? hp : 0,
    currentTargetHpMax: id ? max : 0,
  });

const diorama = (activityKind?: string) => (
  <LiveTurfDiorama
    area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
    weapon={TRAVEL_WEAPON}
    playerLevel={5}
    equippedCount={4}
    activityKind={activityKind as never}
  />
);

const strideActive = () =>
  screen.getByTestId('pixel-hunter').getAttribute('data-stride-active') === 'true';

/** Pump until the condition holds (activation latency stretches
 *  under VM contention; the condition, not the clock, is the
 *  assertion). */
const pumpUntil = async (cond: () => boolean, maxMs: number) => {
  for (let t = 0; t < maxMs && !cond(); t += 300) await pump(300);
};

const mountRoam = (targetId: string | null) => {
  seedTarget(targetId);
  useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
  return render(diorama('roaming_loot'));
};

describe('LiveTurfDiorama — travel beat (M2b, DOM renderer)', () => {
  it('walks on roam start', async () => {
    mountRoam('dustwaste_raider');
    const hunter = screen.getByTestId('pixel-hunter');
    // The travel gait row (animation fix iteration: the stride
    // amplitudes with the window-tuned envelope).
    expect(hunter.getAttribute('data-stride-cycle')).toBe('travelStride');
    await pumpUntil(() => strideActive(), 3000);
    expect(strideActive()).toBe(true);
  });

  it('settles back to the held pose when the window closes', async () => {
    mountRoam('dustwaste_raider');
    await pumpUntil(() => strideActive(), 2400);
    expect(strideActive()).toBe(true);
    // Window (850ms) + the actor's one-period settle.
    await pumpUntil(() => !strideActive(), 2400);
    expect(strideActive()).toBe(false);
  });

  it('walks again on the between-enemy advance', async () => {
    mountRoam(null);
    await pump(400);
    expect(strideActive()).toBe(false);
    // The next enemy spawns mid-roam: the advance engages.
    act(() => seedTarget('dustwaste_drone', 60, 60));
    await pumpUntil(() => strideActive(), 3000);
    expect(strideActive()).toBe(true);
  });

  it('Stop mid-stride cancels the beat cleanly — no stuck stride', async () => {
    const view = mountRoam('dustwaste_raider');
    await pumpUntil(() => strideActive(), 3000);
    expect(strideActive()).toBe(true);
    // The Stop interrupt: the activity clears mid-stride.
    view.rerender(diorama('idle_standby'));
    await pump(200);
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(view.container.querySelector('[data-stride-active="true"]')).toBeNull();
  });
});
