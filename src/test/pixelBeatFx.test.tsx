import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { getRoamingArea, DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import type { TickEvent } from '@/store/slices/tickSlice';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const pushEvent = (event: Partial<TickEvent>) => {
  useTickFeedStore.getState().push([
    {
      id: `tick:${Math.random().toString(36).slice(2)}`,
      at: Date.now(),
      tone: 'xp',
      label: '',
      detail: '',
      ...event,
    } as TickEvent,
  ]);
};

describe('LiveTurfDiorama — P2 beat FX on the pixel scene', () => {
  beforeEach(() => {
    useTickFeedStore.getState().clear();
  });

  it('a hit tick event stages muzzle flash, tracer, sparks and a damage number', () => {
    pushEvent({ tone: 'loot', label: '-45', value: 45 });
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="roaming_loot" playerLevel={5} equippedCount={3} />);
    expect(screen.getByTestId('diorama-beat-fx')).toBeTruthy();
    expect(screen.getByTestId('fx-muzzle-flash')).toBeTruthy();
    expect(screen.getByTestId('fx-tracer')).toBeTruthy();
    expect(screen.getByTestId('fx-shell-casing')).toBeTruthy();
    expect(screen.getByTestId('fx-impact-sparks')).toBeTruthy();
    expect(screen.getByTestId('fx-damage-number')).toBeTruthy();
    // Ambient ember life is part of the idle-life layer — since
    // the V1 vista landing it is the area's AUTHORED ember row
    // drawn in the stage's ambient canvas (the Dustwaste ember
    // row is the ember spec), and the generic span overlay stands
    // down on vista scenes.
    expect(screen.getByTestId('pixel-ambient-stage')).toBeTruthy();
    expect(screen.queryByTestId('fx-embers')).toBeNull();
  });

  it('a kill tick event stages the dust ring', () => {
    pushEvent({ tone: 'kill', label: 'Raider down', value: 30 });
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="roaming_loot" playerLevel={5} equippedCount={3} />);
    expect(screen.getByTestId('fx-dust-ring')).toBeTruthy();
  });

  it('a damage tick event stages the telegraph glow for the enemy lunge', () => {
    pushEvent({ tone: 'damage', label: '-18', value: 18 });
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="roaming_loot" playerLevel={5} equippedCount={3} />);
    expect(screen.getByTestId('fx-telegraph')).toBeTruthy();
  });

  it('no events → no beat FX layer, actors still placed by anchors', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="roaming_loot" playerLevel={5} equippedCount={3} />);
    expect(screen.queryByTestId('diorama-beat-fx')).toBeNull();
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
  });
});
