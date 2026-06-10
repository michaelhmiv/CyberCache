/**
 * Tick-feed rendering safety: every `TickEventTone` must have a display
 * mapping, and unknown future tones must fall back to a safe default
 * instead of crashing the app.
 *
 * The original blank-screen bug was caused by `DashboardScreen` maintaining
 * a stale local union of display tones while the canonical `TickEventTone`
 * (from `tickSlice.ts`) had already added `damage`, `heal`, and `death`.
 */
import { describe, it, expect } from 'vitest';
import type { TickEvent, TickEventTone } from '@/store/slices/tickSlice';

// ---------------------------------------------------------------------------
// 1. Canonical tones must include all currently-used values
// ---------------------------------------------------------------------------
const CURRENT_TONES: TickEventTone[] = [
  'xp',
  'loot',
  'cash',
  'cache',
  'level',
  'kill',
  'material',
  'essence',
  'fragment',
  'damage',
  'heal',
  'death',
];

describe('TickEventTone (canonical)', () => {
  it('includes all 12 current tones', () => {
    // If you add a new tone, add it to CURRENT_TONES above.
    expect(CURRENT_TONES).toHaveLength(12);
  });

  for (const tone of CURRENT_TONES) {
    it(`"${tone}" is a valid TickEventTone`, () => {
      const event: TickEvent = {
        id: 'test-1',
        at: Date.now(),
        tone,
        label: `Test ${tone}`,
        detail: 'A test event',
      };
      expect(event.tone).toBe(tone);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Display mapping: every tone must resolve to a class, unknown must not throw
// ---------------------------------------------------------------------------
type DisplayTone = TickEventTone | 'unknown';

// Replica of DashboardScreen's gainToneClass — the real one lives in
// DashboardScreen.tsx and must be kept in sync when tones are added.
const gainToneClass: Record<DisplayTone, { text: string; bg: string; border: string; fill: string }> = {
  xp: { text: 'text-green', bg: 'bg-green/10', border: 'border-green/70', fill: 'bg-green' },
  loot: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  cash: { text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/70', fill: 'bg-cyan' },
  cache: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-400/70', fill: 'bg-blue-400' },
  level: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/70', fill: 'bg-red' },
  kill: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
  material: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  essence: { text: 'text-purple', bg: 'bg-purple/10', border: 'border-purple/70', fill: 'bg-purple' },
  fragment: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-400/70', fill: 'bg-blue-400' },
  damage: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/70', fill: 'bg-red' },
  heal: { text: 'text-green', bg: 'bg-green/10', border: 'border-green/70', fill: 'bg-green' },
  death: { text: 'text-red', bg: 'bg-red/15', border: 'border-red/80', fill: 'bg-red' },
  unknown: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
};

const getGainToneClass = (tone?: string) =>
  gainToneClass[(tone ?? 'unknown') as DisplayTone] ?? gainToneClass.unknown;

describe('Tick event display mapping', () => {
  for (const tone of CURRENT_TONES) {
    it(`"${tone}" tone resolves to a non-empty display class`, () => {
      const cls = getGainToneClass(tone);
      expect(cls).toBeDefined();
      expect(cls.text).toBeTruthy();
      expect(cls.bg).toBeTruthy();
      expect(cls.border).toBeTruthy();
    });
  }

  it('undefined tone resolves to unknown fallback', () => {
    const cls = getGainToneClass(undefined);
    expect(cls).toBe(gainToneClass.unknown);
  });

  it('null tone resolves to unknown fallback', () => {
    const cls = getGainToneClass(null as unknown as string);
    expect(cls).toBe(gainToneClass.unknown);
  });

  it('arbitrary string resolves to unknown fallback', () => {
    const cls = getGainToneClass('some_future_tone');
    expect(cls).toBe(gainToneClass.unknown);
  });

  it('empty string resolves to unknown fallback', () => {
    const cls = getGainToneClass('');
    // `''` is falsy, so the `tone ?? 'unknown'` picks 'unknown'
    expect(cls).toBe(gainToneClass.unknown);
  });

  it('display mapping has entries for all 12 current tones plus unknown', () => {
    const keys = Object.keys(gainToneClass);
    // 12 tones + 'unknown' = 13 entries
    expect(keys).toHaveLength(13);
    for (const tone of CURRENT_TONES) {
      expect(gainToneClass[tone]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Building TickEvent objects with each tone must not throw
// ---------------------------------------------------------------------------
describe('TickEvent construction', () => {
  it('constructs events for every tone without throwing', () => {
    const events: TickEvent[] = CURRENT_TONES.map((tone) => ({
      id: `test-${tone}`,
      at: Date.now(),
      tone,
      label: `+1 ${tone}`,
      detail: `${tone} event detail`,
      value: tone === 'cash' ? 10 : tone === 'fragment' ? 1 : undefined,
      gear: tone === 'loot' ? { id: 'g1', name: 'Test Gun', level: 1, rarity: 'Common' } as TickEvent['gear'] : undefined,
    }));

    expect(events).toHaveLength(12);
    for (const event of events) {
      expect(event.tone).toBeTruthy();
      expect(event.id).toBeTruthy();
      expect(event.label).toBeTruthy();
    }
  });
});
