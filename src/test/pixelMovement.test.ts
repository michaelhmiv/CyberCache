import { describe, expect, it } from 'vitest';
import {
  MOVEMENT,
  FIGHT_MAX_PHASES,
  FIGHT_TOTAL_BUDGET_MS,
  fightBudgetMs,
  classifyTickBeat,
  derivePhaseBeats,
  isTickHit,
  actorAnchorPoint,
  tracerGeometry,
  particleField,
  shakeKeyframes,
  hashSeed,
} from '@/lib/pixel/movement';
import { requirePixelSprite } from '@/lib/pixel/manifest';
import type { TickEvent } from '@/store/slices/tickSlice';

const event = (partial: Partial<TickEvent>): TickEvent => ({
  id: 'tick:test',
  at: 1000,
  tone: 'xp',
  label: '',
  detail: '',
  ...partial,
});

describe('MOVEMENT — Sample B pacing law (spec §1/§4)', () => {
  it('boss phases pace at ~1.15 s', () => {
    expect(MOVEMENT.PHASE_INTERVAL_MS).toBe(1150);
  });

  it('hit reactions live inside the 350–500 ms window', () => {
    expect(MOVEMENT.HIT_REACTION_MS).toBeGreaterThanOrEqual(350);
    expect(MOVEMENT.HIT_REACTION_MS).toBeLessThanOrEqual(500);
  });

  it('ghost HP drains in ~480 ms', () => {
    expect(MOVEMENT.GHOST_HP_DRAIN_MS).toBe(480);
  });

  it('crit flash lives inside the 60–180 ms window', () => {
    expect(MOVEMENT.CRIT_FLASH_MS).toBeGreaterThanOrEqual(60);
    expect(MOVEMENT.CRIT_FLASH_MS).toBeLessThanOrEqual(180);
  });

  it('breathing loops live inside 2.3–3.2 s', () => {
    expect(MOVEMENT.BREATHE_MIN_MS).toBe(2300);
    expect(MOVEMENT.BREATHE_MAX_MS).toBe(3200);
  });

  it('fight budget is phases × Sample B interval + settle, capped for 8 phases', () => {
    expect(fightBudgetMs(4)).toBe(4 * 1150 + MOVEMENT.FIGHT_SETTLE_MS);
    expect(FIGHT_TOTAL_BUDGET_MS).toBe(fightBudgetMs(FIGHT_MAX_PHASES));
  });

  it('a full phase of beats fits inside the phase interval', () => {
    const beats = derivePhaseBeats({ bossDamage: 10, playerDamage: 10, bossMaxHp: 1000, bossDies: false, playerDies: false });
    const last = beats[beats.length - 1];
    expect(last.atMs + MOVEMENT.DODGE_MS).toBeLessThanOrEqual(MOVEMENT.PHASE_INTERVAL_MS + 100);
  });
});

describe('classifyTickBeat', () => {
  it('ignores the idle sentinel and missing events', () => {
    expect(classifyTickBeat(undefined, 100)).toBeNull();
    expect(classifyTickBeat(event({ id: 'idle-loop-ready', tone: 'kill' }), 100)).toBeNull();
  });

  it('kill events beat as kill', () => {
    expect(classifyTickBeat(event({ tone: 'kill', value: 40 }), 100)?.kind).toBe('kill');
  });

  it('hit events beat as shot, or crit at/above the damage fraction of target max HP', () => {
    const hit = event({ tone: 'loot', label: '-30', value: 30 });
    expect(isTickHit(hit)).toBe(true);
    expect(classifyTickBeat(hit, 1000)?.kind).toBe('shot'); // 3% of max
    expect(classifyTickBeat(hit, 100)?.kind).toBe('crit'); // 30% of max
    expect(classifyTickBeat(hit, 0)?.kind).toBe('shot'); // unknown max: never crit
  });

  it('non-hit loot labels are loot, not shots', () => {
    const drop = event({ tone: 'loot', label: 'Vortex SMG', gear: undefined });
    expect(isTickHit(drop)).toBe(false);
    expect(classifyTickBeat(drop, 100)?.kind).toBe('loot');
  });

  it('damage events beat as playerHit; unrelated tones are null', () => {
    expect(classifyTickBeat(event({ tone: 'damage', value: 12 }), 100)?.kind).toBe('playerHit');
    expect(classifyTickBeat(event({ tone: 'xp', value: 12 }), 100)).toBeNull();
    expect(classifyTickBeat(event({ tone: 'heal', value: 12 }), 100)).toBeNull();
  });

  it('is deterministic: same event, same beat', () => {
    const hit = event({ tone: 'loot', label: '-90', value: 90 });
    expect(classifyTickBeat(hit, 300)).toEqual(classifyTickBeat(hit, 300));
  });
});

describe('derivePhaseBeats', () => {
  it('a quiet phase has no beats', () => {
    expect(derivePhaseBeats({ bossDamage: 0, playerDamage: 0, bossMaxHp: 100, bossDies: false, playerDies: false })).toEqual([]);
  });

  it('shot lands first; the counter is telegraphed, lunges, and is dodged', () => {
    const beats = derivePhaseBeats({ bossDamage: 50, playerDamage: 20, bossMaxHp: 1000, bossDies: false, playerDies: false });
    expect(beats.map((b) => b.kind)).toEqual(['shot', 'telegraph', 'lunge', 'dodge']);
    expect(beats[0].atMs).toBe(0);
    expect(beats[1].atMs).toBe(MOVEMENT.BEAT_COUNTER_AT_MS);
    expect(beats[2].atMs).toBe(MOVEMENT.BEAT_LUNGE_AT_MS);
    expect(beats[3].value).toBe(20);
  });

  it('a heavy shot presents as crit', () => {
    const beats = derivePhaseBeats({ bossDamage: 400, playerDamage: 0, bossMaxHp: 1000, bossDies: false, playerDies: false });
    expect(beats[0].kind).toBe('crit');
  });

  it('a killing blow ends the phase: death beat after the hit reaction, no counter', () => {
    const beats = derivePhaseBeats({ bossDamage: 500, playerDamage: 90, bossMaxHp: 1000, bossDies: true, playerDies: false });
    expect(beats.map((b) => b.kind)).toEqual(['crit', 'death']);
    expect(beats[1].atMs).toBe(MOVEMENT.HIT_REACTION_MS);
  });

  it('a fatal counter is a playerHit, not a dodge', () => {
    const beats = derivePhaseBeats({ bossDamage: 10, playerDamage: 80, bossMaxHp: 1000, bossDies: false, playerDies: true });
    expect(beats.map((b) => b.kind)).toEqual(['shot', 'telegraph', 'lunge', 'playerHit']);
  });
});

describe('actorAnchorPoint', () => {
  const hunter = requirePixelSprite('hunter');
  const placement = { xPct: 22, heightPct: 57, groundY: 0.86 };

  it("the feet anchor lands exactly on the placement point", () => {
    const p = actorAnchorPoint(hunter, 'feet', placement);
    expect(p.xPct).toBeCloseTo(22, 6);
    expect(p.yPct).toBeCloseTo(86, 6);
  });

  it('the muzzle sits up and to the right of the feet for a right-facing sprite', () => {
    const muzzle = actorAnchorPoint(hunter, 'muzzle', placement);
    const feet = actorAnchorPoint(hunter, 'feet', placement);
    expect(muzzle.xPct).toBeGreaterThan(feet.xPct);
    expect(muzzle.yPct).toBeLessThan(feet.yPct);
    // Muzzle y is the anchor fraction of the actor height above the box top.
    expect(muzzle.yPct).toBeCloseTo(86 - 57 + hunter.anchors.muzzle.y * 57, 4);
  });

  it('falls back to centerMass for unknown anchors (manifest contract)', () => {
    const a = actorAnchorPoint(hunter, 'nope', placement);
    const b = actorAnchorPoint(hunter, 'centerMass', placement);
    expect(a).toEqual(b);
  });
});

describe('tracerGeometry', () => {
  it('a level shot has zero angle and spans the x distance', () => {
    const g = tracerGeometry({ xPct: 10, yPct: 50 }, { xPct: 60, yPct: 50 });
    expect(g.angleDeg).toBeCloseTo(0, 6);
    expect(g.widthPct).toBeCloseTo(50, 6);
    expect(g.leftPct).toBe(10);
    expect(g.topPct).toBe(50);
  });

  it('a downward shot angles down and is longer than its x span', () => {
    const g = tracerGeometry({ xPct: 10, yPct: 20 }, { xPct: 60, yPct: 70 });
    expect(g.angleDeg).toBeGreaterThan(0);
    expect(g.widthPct).toBeGreaterThan(50);
  });
});

describe('particleField / shakeKeyframes determinism', () => {
  it('same seed → identical field; different seed → different field', () => {
    const a = particleField('dustwaste', 14);
    const b = particleField('dustwaste', 14);
    const c = particleField('redline', 14);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(14);
    for (const p of a) {
      expect(p.xPct).toBeGreaterThanOrEqual(0);
      expect(p.xPct).toBeLessThan(100);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('shake starts and ends at rest and never exceeds the intensity', () => {
    const s = shakeKeyframes('beat-1', 6);
    expect(s.x[0]).toBe(0);
    expect(s.y[0]).toBe(0);
    expect(s.x[s.x.length - 1]).toBe(0);
    expect(s.y[s.y.length - 1]).toBe(0);
    for (const v of s.x) expect(Math.abs(v)).toBeLessThanOrEqual(6);
    expect(shakeKeyframes('beat-1', 6)).toEqual(s);
    expect(shakeKeyframes('beat-2', 6)).not.toEqual(s);
  });

  it('hashSeed is stable', () => {
    expect(hashSeed('cybercache')).toBe(hashSeed('cybercache'));
    expect(hashSeed('cybercache')).not.toBe(hashSeed('pittech'));
  });
});
