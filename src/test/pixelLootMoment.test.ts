import { describe, expect, it } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Shield, Weapon } from '@/types/items';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  RARITY_RANK,
  gearDropFromEvent,
  initialLootMomentState,
  lootCardData,
  lootCelebrationForRarity,
  lootDeckData,
  lootDeckSchedule,
  lootMomentMode,
  lootMomentReducer,
  orderLootLadder,
  planLootMoment,
  shieldMitigationPct,
  splitAffixFigure,
  type LootMomentState,
} from '@/lib/pixel/lootMoment';
import type { TickEvent } from '@/store/slices/tickSlice';

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon =>
  ({
    id: 'w-1',
    name: 'Volt Carbine',
    level: 7,
    rarity: Rarity.Rare,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Prismatek,
    element: Element.Shock,
    rollQuality: 62,
    baseDamage: 2847,
    attackSpeed: 6.2,
    // Real item contract: critChance is a fraction (the card renders
    // ×100). This fixture carried 15 — the percent-scale value the old
    // buggy celebration formatter was written against (DISP-03).
    critChance: 0.15,
    critDamage: 150,
    statusChance: 20,
    statusDamage: 45,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 100,
    bossPower: 90,
    farmPower: 80,
    economyScore: 10,
    ...overrides,
  }) as Weapon;

const makeShield = (overrides: Partial<Shield> = {}): Shield =>
  ({
    id: 's-1',
    name: 'Aegis Plate',
    level: 4,
    rarity: Rarity.Epic,
    hp: 1250,
    rechargeRate: 42,
    // Real item contract: mitigation is a FRACTION (the generator rolls
    // 0.05–0.8; inspect/market surfaces print ×100). This fixture
    // carried 18 — the percent-scale value the old buggy loot-card
    // formatter was written against.
    mitigation: 0.18,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 3,
    ...overrides,
  }) as Shield;

describe('lootCelebrationForRarity — rarity → celebration tier mapping', () => {
  it('maps every rarity to its spec duration from MOVEMENT', () => {
    expect(lootCelebrationForRarity(Rarity.Common).durationMs).toBe(MOVEMENT.LOOT_COMMON_MS);
    expect(lootCelebrationForRarity(Rarity.Uncommon).durationMs).toBe(MOVEMENT.LOOT_UNCOMMON_MS);
    expect(lootCelebrationForRarity(Rarity.Rare).durationMs).toBe(MOVEMENT.LOOT_RARE_MS);
    expect(lootCelebrationForRarity(Rarity.Epic).durationMs).toBe(MOVEMENT.LOOT_EPIC_MS);
    expect(lootCelebrationForRarity(Rarity.Legendary).durationMs).toBe(MOVEMENT.LOOT_LEGENDARY_MS);
    // The spec §5 durations, pinned so the law cannot drift silently.
    expect(MOVEMENT.LOOT_COMMON_MS).toBe(900);
    expect(MOVEMENT.LOOT_RARE_MS).toBe(1100);
    expect(MOVEMENT.LOOT_EPIC_MS).toBe(1400);
    expect(MOVEMENT.LOOT_LEGENDARY_MS).toBe(2600);
  });

  it('scales beam width and flare monotonically with rarity', () => {
    const ladder = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary].map(lootCelebrationForRarity);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].beamWidthPx).toBeGreaterThan(ladder[i - 1].beamWidthPx);
      expect(ladder[i].flareScale).toBeGreaterThan(ladder[i - 1].flareScale);
    }
  });

  it('reserves the legendary surplus (dim, rays, shockwave) for Legendary only', () => {
    for (const rarity of [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic]) {
      const c = lootCelebrationForRarity(rarity);
      expect(c.dimWorld).toBe(false);
      expect(c.godRays).toBe(false);
      expect(c.shockwave).toBe(false);
    }
    const legendary = lootCelebrationForRarity(Rarity.Legendary);
    expect(legendary.tier).toBe('legendary');
    expect(legendary.dimWorld).toBe(true);
    expect(legendary.godRays).toBe(true);
    expect(legendary.shockwave).toBe(true);
    expect(MOVEMENT.LOOT_DIM_OPACITY).toBe(0.4); // spec: world dims ~40%
  });

  it('rises the item itself at every rarity (item-moment reveal, 2026-11-03)', () => {
    // The item is the moment: before the reveal redesign the rise was
    // legendary-only and 92% of cache opens never showed the item.
    for (const rarity of [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
      expect(lootCelebrationForRarity(rarity).weaponRise).toBe(true);
    }
  });

  it('uses the shared rarity identity colors', () => {
    expect(lootCelebrationForRarity(Rarity.Common).color).toBe('#A5A7B5');
    expect(lootCelebrationForRarity(Rarity.Rare).color).toBe('#5AA7FF');
    expect(lootCelebrationForRarity(Rarity.Epic).color).toBe('#FF9DF5');
    expect(lootCelebrationForRarity(Rarity.Legendary).color).toBe('#FFEA3A');
  });
});

describe('orderLootLadder — ascending rarity, best drop takes the finale', () => {
  it('sorts ascending by rarity rank and is stable within a rarity', () => {
    const epic = makeWeapon({ id: 'epic', name: 'Epic One', rarity: Rarity.Epic });
    const commonA = makeWeapon({ id: 'common-a', name: 'Common A', rarity: Rarity.Common });
    const legendary = makeWeapon({ id: 'leg', name: 'Leg', rarity: Rarity.Legendary });
    const commonB = makeWeapon({ id: 'common-b', name: 'Common B', rarity: Rarity.Common });
    const rare = makeWeapon({ id: 'rare', name: 'Rare One', rarity: Rarity.Rare });
    const ordered = orderLootLadder([epic, commonA, legendary, commonB, rare]);
    expect(ordered.map((i) => i.id)).toEqual(['common-a', 'common-b', 'rare', 'epic', 'leg']);
  });

  it('planLootMoment puts the highest rarity in the finale slot and sums durations', () => {
    const plan = planLootMoment([
      makeWeapon({ id: 'a', rarity: Rarity.Legendary }),
      makeWeapon({ id: 'b', rarity: Rarity.Common }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.steps.map((s) => s.item.id)).toEqual(['b', 'a']);
    expect(plan!.finale.item.id).toBe('a');
    expect(plan!.hasLegendary).toBe(true);
    expect(plan!.totalMs).toBe(MOVEMENT.LOOT_COMMON_MS + MOVEMENT.LOOT_LEGENDARY_MS);
    expect(planLootMoment([])).toBeNull();
  });

  it('RARITY_RANK is a strict 0..4 ladder', () => {
    expect(RARITY_RANK).toEqual({ Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 });
  });
});

describe('lootCardData — card derivation from real item data', () => {
  it('derives name, stamp, and stat line from a weapon’s own fields', () => {
    const card = lootCardData(makeWeapon());
    expect(card.name).toBe('Volt Carbine');
    expect(card.stamp).toBe('RARE SMG');
    expect(card.kindLabel).toBe('SMG');
    expect(card.statLine).toBe('Dmg 2,847 · Spd 6.20 · Crit 15.0%');
    expect(card.isWeapon).toBe(true);
    expect(card.flavor).toBeUndefined(); // flavor is a legendary-only line
  });

  it('gives a legendary weapon its gold stamp and flavor override', () => {
    const card = lootCardData(
      makeWeapon({ id: 'leg', name: 'Emberfall', rarity: Rarity.Legendary, weaponType: WeaponType.Sniper, legendaryEffectId: 'glass_sun' }),
    );
    expect(card.stamp).toBe('★ LEGENDARY SNIPER');
    // P4 wave 2: the name-keyed flavor override (P3 deferred it to this wave).
    expect(card.flavor).toBe('Sets the sky on fire. Literally.');
    expect(card.color).toBe('#FFEA3A');
  });

  it('resolves the bespoke legendary sprite by weapon name', () => {
    const card = lootCardData(makeWeapon({ name: 'Emberfall', rarity: Rarity.Legendary }));
    expect(card.bespokeSpriteId).toBe('legendary-emberfall');
    expect(lootCardData(makeWeapon({ name: 'Some Other Gun' })).bespokeSpriteId).toBeUndefined();
  });

  it('derives a shield card from shield fields', () => {
    const card = lootCardData(makeShield());
    expect(card.kindLabel).toBe('SHIELD');
    expect(card.stamp).toBe('EPIC SHIELD');
    expect(card.statLine).toBe('HP 1,250 · RECHARGE 42/s · MIT 18%');
    expect(card.isWeapon).toBe(false);
  });

  it('prints shield mitigation as the true percentage (reveal rider, 2026-11-03)', () => {
    // The bug: mitigation is stored as a fraction, and the card printed
    // the raw fraction — an 8% shield read "MIT 0.1%". Pin the fix.
    const shield = makeShield({ mitigation: 0.08 });
    expect(shieldMitigationPct(shield)).toBe('8');
    expect(lootCardData(shield).statLine).toContain('MIT 8%');
    expect(lootCardData(shield).statLine).not.toContain('0.1%');
    // A fractional percent keeps one honest decimal.
    expect(shieldMitigationPct(makeShield({ mitigation: 0.085 }))).toBe('8.5');
  });
});

describe('lootDeckData — the reveal deck derivation', () => {
  it('stages a weapon: hero damage, SPD/CRIT supports, quality read honestly', () => {
    const deck = lootDeckData(makeWeapon());
    expect(deck.stamp).toBe('RARE SMG · SHOCK · LV 7');
    expect(deck.hero).toEqual({ label: 'DAMAGE', value: '2,847' });
    expect(deck.supports).toEqual([
      { label: 'SPD', value: '6.20' },
      { label: 'CRIT', value: '15.0%' },
    ]);
    expect(deck.quality).toEqual({ value: 62, label: 'STRONG' });
    expect(deck.effect).toBeNull();
  });

  it('gives a legendary its effect banner, and flavor stays the override line', () => {
    const deck = lootDeckData(
      makeWeapon({ name: 'Emberfall', rarity: Rarity.Legendary, weaponType: WeaponType.Sniper, legendaryEffectId: 'glass_sun' }),
    );
    expect(deck.effect?.name).toBe('Glass Sun');
    expect(deck.effect?.description).toBeTruthy();
    // Banner carries the description; the flavor line is the override,
    // never the same text twice.
    expect(deck.flavor).toBe('Sets the sky on fire. Literally.');
    expect(deck.stamp).toBe('LEGENDARY SNIPER · SHOCK · LV 7');
  });

  it('stages a shield with mitigation at its true percentage', () => {
    const deck = lootDeckData(makeShield({ mitigation: 0.08, hp: 1757, rechargeRate: 40 }));
    expect(deck.hero).toEqual({ label: 'SHIELD HP', value: '1,757' });
    expect(deck.supports).toContainEqual({ label: 'MITIGATION', value: '8%' });
    expect(deck.supports).toContainEqual({ label: 'RECHARGE', value: '40/s' });
    expect(deck.quality).toBeNull(); // gear carries no rollQuality
    expect(deck.stamp).toBe('EPIC SHIELD · KINETIC · LV 4');
  });

  it('splits an activity module out of the affix rows', () => {
    const deck = lootDeckData(
      makeWeapon({
        affixes: [
          { id: 'a1', category: 'combat', stat: 'critChance', value: 0.09, displayText: '+9% Crit Chance' },
          {
            id: 'a2', category: 'activity', stat: 'salvage', value: 0.95,
            subStats: { salvageYield: 0.335 },
            displayText: 'Salvage Module [95%] · +33.5% Salvage Yield',
          },
        ] as Weapon['affixes'],
      }),
    );
    expect(deck.affixes).toEqual([{ figure: '+9%', rest: ' Crit Chance' }]);
    expect(deck.module?.title).toBe('Salvage Module [95%]');
    expect(deck.module?.lines).toEqual([{ figure: '+33.5%', rest: ' Salvage Yield' }]);
  });

  it('a relic has no hero figure — its affixes are the read', () => {
    const deck = lootDeckData({
      id: 'r-1', name: 'Echo Stone', level: 12, rarity: Rarity.Epic,
      affixes: [{ id: 'a1', category: 'idle', stat: 'offline', value: 0.12, displayText: '+12% Offline Earnings' }],
      sourceTag: DropSource.WorldDrop, isLocked: false,
    } as unknown as GearItem);
    expect(deck.hero).toBeNull();
    expect(deck.stamp).toBe('EPIC RELIC · LV 12');
    expect(deck.affixes).toEqual([{ figure: '+12%', rest: ' Offline Earnings' }]);
  });

  it('splitAffixFigure only splits a leading signed percentage', () => {
    expect(splitAffixFigure('+9% Shield Break')).toEqual({ figure: '+9%', rest: ' Shield Break' });
    expect(splitAffixFigure('-4.5% Recoil')).toEqual({ figure: '-4.5%', rest: ' Recoil' });
    expect(splitAffixFigure('Burns for 45 per second')).toEqual({ figure: '', rest: 'Burns for 45 per second' });
  });

  it('the deck schedule lands every row inside the existing step durations', () => {
    // Realistic affix loads per rarity (affix counts by rarity band:
    // Common 0–1, Uncommon 1, Rare 2, Epic 3, Legendary 4–5).
    const affixCounts: Partial<Record<Rarity, number>> = {
      [Rarity.Common]: 1, [Rarity.Uncommon]: 1, [Rarity.Rare]: 2, [Rarity.Epic]: 3, [Rarity.Legendary]: 5,
    };
    for (const rarity of [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
      const step = lootCelebrationForRarity(rarity).durationMs;
      const count = affixCounts[rarity]!;
      const schedule = lootDeckSchedule(rarity, { affixCount: count, hasModule: true });
      const lastLanding = Math.max(
        schedule.nameMs, schedule.heroMs,
        schedule.affixStartMs + schedule.affixStaggerMs * (count - 1),
        schedule.moduleMs, schedule.qualityMs, schedule.flavorMs,
      );
      expect(lastLanding).toBeLessThan(step);
    }
    // Legendary withholds the deck so the rise gets its clean frame.
    const legendary = lootDeckSchedule(Rarity.Legendary, { affixCount: 5, hasModule: false });
    expect(legendary.nameMs).toBeGreaterThan(lootDeckSchedule(Rarity.Rare, { affixCount: 2, hasModule: false }).nameMs);
    expect(legendary.heroMs).toBe(1100);
  });
});

describe('lootMomentMode — escalation rules', () => {
  it('stage surfaces always play full', () => {
    expect(lootMomentMode([makeWeapon({ rarity: Rarity.Common })], 'stage')).toBe('full');
    expect(lootMomentMode([makeWeapon({ rarity: Rarity.Legendary })], 'stage')).toBe('full');
  });

  it('feed surfaces play light for ordinary drops — idle flow is never blocked', () => {
    for (const rarity of [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic]) {
      expect(lootMomentMode([makeWeapon({ rarity })], 'feed')).toBe('light');
    }
  });

  it('a legendary in the feed always earns the full treatment', () => {
    expect(lootMomentMode([makeWeapon({ rarity: Rarity.Common }), makeWeapon({ id: 'l', rarity: Rarity.Legendary })], 'feed')).toBe('full');
  });

  it('no items → no moment', () => {
    expect(lootMomentMode([], 'stage')).toBeNull();
    expect(lootMomentMode([], 'feed')).toBeNull();
  });
});

describe('lootMomentReducer — playback + skip behavior', () => {
  const play = (state: LootMomentState, action: Parameters<typeof lootMomentReducer>[1]) => lootMomentReducer(state, action);

  it('advances through the ladder and finishes after the last step', () => {
    let state = initialLootMomentState;
    state = play(state, { type: 'advance', stepCount: 3 });
    expect(state).toEqual({ stepIndex: 1, status: 'playing', skipped: false });
    state = play(state, { type: 'advance', stepCount: 3 });
    expect(state.stepIndex).toBe(2);
    state = play(state, { type: 'advance', stepCount: 3 });
    expect(state.status).toBe('done');
    // Further advances are no-ops.
    expect(play(state, { type: 'advance', stepCount: 3 })).toBe(state);
  });

  it('a tap on the first-ever view does NOT skip (spec: skippable after first view)', () => {
    const tapped = play(initialLootMomentState, { type: 'tap', seenBefore: false });
    expect(tapped).toBe(initialLootMomentState);
  });

  it('a tap after the first view settles to the completed stack, then done', () => {
    let state = play(initialLootMomentState, { type: 'advance', stepCount: 4 });
    state = play(state, { type: 'tap', seenBefore: true });
    expect(state.status).toBe('settled');
    expect(state.skipped).toBe(true);
    state = play(state, { type: 'settleDone' });
    expect(state.status).toBe('done');
  });

  it('taps do nothing once settled or done', () => {
    const settled: LootMomentState = { stepIndex: 1, status: 'settled', skipped: true };
    expect(play(settled, { type: 'tap', seenBefore: true })).toBe(settled);
    const done: LootMomentState = { stepIndex: 1, status: 'done', skipped: true };
    expect(play(done, { type: 'tap', seenBefore: true })).toBe(done);
  });
});

describe('gearDropFromEvent — tick-feed adapter', () => {
  const event = (overrides: Partial<TickEvent>): TickEvent => ({
    id: 'tick:1',
    at: Date.now(),
    tone: 'loot',
    label: 'Volt Carbine',
    detail: 'Rare SMG',
    ...overrides,
  });

  it('returns the gear payload of a real drop event', () => {
    const gear = makeWeapon();
    expect(gearDropFromEvent(event({ gear }))).toBe(gear);
  });

  it('never treats a hit tick (tone loot, negative label) as a drop', () => {
    expect(gearDropFromEvent(event({ label: '-45', value: 45 }))).toBeNull();
    expect(gearDropFromEvent(event({ label: '-45', value: 45, gear: makeWeapon() }))).toBeNull();
  });

  it('ignores non-loot tones and missing gear', () => {
    expect(gearDropFromEvent(event({ tone: 'kill', gear: undefined }))).toBeNull();
    expect(gearDropFromEvent(event({ gear: undefined }))).toBeNull();
    expect(gearDropFromEvent(undefined)).toBeNull();
  });

  it('a GearItem list is untouched by planning — planning cannot lose a drop', () => {
    const items: GearItem[] = [makeWeapon({ id: 'a' }), makeShield({ id: 'b' })];
    const plan = planLootMoment(items);
    expect(plan!.steps.map((s) => s.item)).toEqual([items[0], items[1]]);
    expect(items).toHaveLength(2);
  });
});
