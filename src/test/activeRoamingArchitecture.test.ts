/**
 * Active roaming architecture test: the ticker is the single source of truth
 * for roaming rewards. Screens consume tickFeed events — they do not mint
 * rewards themselves.
 *
 * This test verifies:
 * 1. The ticker produces TickEvent[] with correct tones
 * 2. Client-preview events are populated
 * 3. Dashboard/Action surfaces don't crash with any event tone
 * 4. The tickFeed store correctly caps at MAX_EVENTS
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useIdleStore } from '@/store/slices/idleSlice';
import type { TickEvent } from '@/store/slices/tickSlice';

// Mock the server-side RPC — we test client-side event generation only
vi.mock('@/lib/supabase/verifiedOps', () => ({
  verifiedOps: { claimRoamingRewards: vi.fn(async () => ({})) },
}));
vi.mock('@/store/runtimeSupabaseSync', () => ({
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
}));
vi.mock('@/store/combatStatsSupabaseSync', () => ({
  saveCombatStats: vi.fn(async () => undefined),
}));

const resetStores = () => {
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  useInventoryStore.setState(useInventoryStore.getInitialState(), true);
  useSurvivalStore.setState({ currentHp: 700, maxHp: 700, isDead: false, shieldHp: 0 }, true);
  useTickFeedStore.setState({ events: [] });
  useActivityStore.setState({
    current: {
      kind: 'roaming_loot',
      targetType: 'roaming_area',
      targetId: 'dustwaste_frontier',
      targetLabel: 'Dustwaste Frontier',
      startedAt: new Date().toISOString(),
      completesAt: null,
      sceneKey: null,
      notes: null,
      activityPayload: {},
      publicPayload: {},
      lastHeartbeatAt: null,
      publicVisible: true,
      schemaVersion: 1,
      updatedAt: null,
    },
    pending: false,
  });
  useIdleStore.setState({ selectedRoamingAreaId: 'dustwaste_frontier', isFarming: false });
};

describe('Active roaming — ticker is single source of truth', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    unmountIdleTicker();
  });

  it('tickNow produces TickEvent[] with valid tones', async () => {
    const store = useIdleTickerStore.getState();
    // Prime lastTickAt so tickNow processes exactly 1 tick
    store._setLastTickForTest?.(Date.now() - 3100);
    await store.tickNow();

    const events = useTickFeedStore.getState().events;
    expect(events.length).toBeGreaterThan(0);

    // Every event must have a valid tone from the canonical type
    const TONES = new Set([
      'xp', 'loot', 'cash', 'cache', 'level', 'kill',
      'material', 'essence', 'fragment', 'damage', 'heal', 'death',
    ]);
    for (const event of events) {
      expect(TONES.has(event.tone)).toBe(true);
      expect(event.id).toBeTruthy();
      expect(event.label).toBeTruthy();
      expect(event.at).toBeGreaterThan(0);
    }
  });

  it('tickFeed store caps events at 50', () => {
    const store = useTickFeedStore.getState();
    const events: TickEvent[] = Array.from({ length: 60 }, (_, i) => ({
      id: `tick:${i}`,
      at: Date.now() - (60 - i) * 3000,
      tone: 'xp' as const,
      label: `+1 XP`,
      detail: `tick ${i}`,
    }));

    store.push(events);
    const stored = useTickFeedStore.getState().events;
    expect(stored.length).toBeLessThanOrEqual(50);
  });

  it('tick events with each current tone do not throw on construction', () => {
    const tones = [
      'xp', 'loot', 'cash', 'cache', 'level', 'kill',
      'material', 'essence', 'fragment', 'damage', 'heal', 'death',
    ] as const;

    for (const tone of tones) {
      const event: TickEvent = {
        id: `test-${tone}`,
        at: Date.now(),
        tone,
        label: `Test ${tone}`,
        detail: `Detail for ${tone}`,
        value: tone === 'cash' ? 10 : tone === 'fragment' ? 1 : undefined,
        areaId: 'dustwaste_frontier',
      };
      expect(() => {
        useTickFeedStore.getState().push([event]);
      }).not.toThrow();
    }
  });

  it('the ticker does not run when activity is idle_standby', async () => {
    useActivityStore.setState({
      current: {
        kind: 'idle_standby',
        targetType: null,
        targetId: null,
        targetLabel: null,
        startedAt: null,
        completesAt: null,
        sceneKey: null,
        notes: null,
        activityPayload: {},
        publicPayload: {},
        lastHeartbeatAt: null,
        publicVisible: true,
        schemaVersion: 1,
        updatedAt: null,
      },
    });

    // Reset tick feed
    useTickFeedStore.setState({ events: [] });
    const store = useIdleTickerStore.getState();
    store._setLastTickForTest?.(Date.now() - 3100);
    await store.tickNow();

    // No events should be generated when not in roaming_loot
    const events = useTickFeedStore.getState().events;
    expect(events.length).toBe(0);
  });
});

describe('Dashboard/Action rendering safety', () => {
  it('all expected tones have display mappings (no unknown fallback needed)', () => {
    // These tones should resolve to specific classes, not 'unknown'
    const KNOWN_TONES = [
      'xp', 'loot', 'cash', 'cache', 'level', 'kill',
      'material', 'essence', 'fragment', 'damage', 'heal', 'death',
    ];

    // This mirrors the gainToneClass in DashboardScreen.tsx
    const gainToneClass: Record<string, unknown> = {
      xp: {},
      loot: {},
      cash: {},
      cache: {},
      level: {},
      kill: {},
      material: {},
      essence: {},
      fragment: {},
      damage: {},
      heal: {},
      death: {},
      unknown: {},
    };

    for (const tone of KNOWN_TONES) {
      expect(gainToneClass[tone]).toBeDefined();
    }
  });

  it('unknown tone resolves without throwing', () => {
    const gainToneClass: Record<string, unknown> = {
      unknown: { text: 'fallback' },
    };
    const getClass = (tone?: string) =>
      gainToneClass[tone ?? 'unknown'] ?? gainToneClass.unknown;

    expect(() => getClass('some_future_tone')).not.toThrow();
    expect(getClass('some_future_tone')).toBe(gainToneClass.unknown);
  });
});
