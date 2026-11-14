import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useSurvivalStore, useTickFeedStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';
import { TickerLedger, tapePush, type LedgerEntry } from './TickerLedger';

/**
 * TICKER LEDGER — ROAM (iter-04 harness, dev only).
 *
 * The real LiveTurfDiorama (Wraith Scavenger = dustwaste_raider,
 * src/constants/monsters.ts) with the INDEX combat fixture staged
 * as a ledger tape under the stage: each 3 s tick posts its
 * component lines, then the TOTAL line they sum to, walking the
 * enemy HP balance 300 → 204 → 100 → 0. Tick 3's kill is fully
 * auditable: DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 ·
 * ECHO 18 = −156 against 100 HP.
 *
 *   ?freeze=rest|surge|kill   hold a beat (stills)
 *   ?auto=1                   play the tape once (clip)
 *   window.__playRoam()       play from the top
 */

const HARNESS_WEAPON: Weapon = {
  id: 'ticker-weapon',
  name: 'Harness Carbine',
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

let beatSeq = 0;
const seedBeat = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  useTickFeedStore.setState({
    events: [{ id: `ticker-beat-${beatSeq}`, at: Date.now(), detail: 'ticker', ...partial } as TickEvent],
  });
};
const setEnemyHp = (hp: number) =>
  useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: hp, currentTargetHpMax: 300 });

type Row = Omit<LedgerEntry, 'id'>;
interface Group {
  beat: string;
  atMs: number;
  rows: Row[];
  stage?: () => void;
  foot: [string, string];
}

const GROUPS: Group[] = [
  {
    beat: 'rest',
    atMs: 0,
    rows: [{ t: 'T+0:00', kind: 'open', label: 'ENGAGE — WRAITH SCAVENGER', balance: 'HP 300' }],
    stage: () => setEnemyHp(300),
    foot: ['DEALT Σ 0', 'ENEMY HP 300'],
  },
  {
    beat: 'tick1',
    atMs: 900,
    rows: [
      { t: 'T+0:03', kind: 'hit', label: 'DMG', amount: '−58' },
      { t: 'T+0:03', kind: 'proc', label: 'FIRE', amount: '−22', tint: '#FF7A1A' },
      { t: 'T+0:03', kind: 'hit', label: 'SPD', amount: '−16' },
      { t: 'T+0:03', kind: 'total', label: 'TICK 1 — TOTAL', amount: '−96', balance: 'HP 204' },
    ],
    stage: () => {
      seedBeat({ tone: 'loot', label: '-96', value: 96 });
      setEnemyHp(204);
    },
    foot: ['DEALT Σ 96', 'ENEMY HP 204'],
  },
  {
    beat: 'tick2',
    atMs: 3900,
    rows: [
      { t: 'T+0:06', kind: 'hit', label: 'DMG', amount: '−52' },
      { t: 'T+0:06', kind: 'proc', label: 'FIRE', amount: '−18', tint: '#FF7A1A' },
      { t: 'T+0:06', kind: 'hit', label: 'SPD', amount: '−14' },
      { t: 'T+0:06', kind: 'proc', label: 'MOLTEN CORE', amount: '−20', tint: '#FF5A2A' },
      { t: 'T+0:06', kind: 'total', label: 'TICK 2 — TOTAL', amount: '−104', balance: 'HP 100' },
    ],
    stage: () => {
      seedBeat({ tone: 'loot', label: '-104', value: 104 });
      setEnemyHp(100);
    },
    foot: ['DEALT Σ 200', 'ENEMY HP 100'],
  },
  {
    beat: 'swipe',
    atMs: 4900,
    rows: [
      { t: 'T+0:06', kind: 'hurt', label: 'PARTING SWIPE — SHLD', amount: '−28', balance: 'SHLD 36' },
      { t: 'T+0:07', kind: 'step', label: 'SHLD RECHARGING', balance: '→ 52' },
    ],
    stage: () => seedBeat({ tone: 'damage', label: '-28', value: 28 }),
    foot: ['DEALT Σ 200', 'ENEMY HP 100'],
  },
  {
    beat: 'kill',
    atMs: 6900,
    rows: [
      { t: 'T+0:09', kind: 'crit', label: 'CRIT ×2.0 — DMG 44', amount: '−88' },
      { t: 'T+0:09', kind: 'proc', label: 'FIRE', amount: '−24', tint: '#FF7A1A' },
      { t: 'T+0:09', kind: 'hit', label: 'SPD', amount: '−12' },
      { t: 'T+0:09', kind: 'proc', label: 'MOLTEN CORE', amount: '−14', tint: '#FF5A2A' },
      { t: 'T+0:09', kind: 'proc', label: 'ECHO CHAMBER', amount: '−18', tint: '#7DD3FC' },
      { t: 'T+0:09', kind: 'total', label: 'TICK 3 — TOTAL', amount: '−156', balance: 'HP 0' },
      { t: 'T+0:09', kind: 'mile', label: 'KILL — WRAITH SCAVENGER' },
      { t: 'T+0:10', kind: 'yield', label: 'DROP — TECHFRAGMENTS', amount: '+1' },
      { t: 'T+0:10', kind: 'close', label: 'ACCOUNT SETTLED', amount: '−356', balance: 'HP 0' },
    ],
    stage: () => {
      seedBeat({ tone: 'kill', label: 'kill', value: 156 });
      setEnemyHp(0);
      setTimeout(() => seedBeat({ tone: 'material', label: '+1 TechFragments', value: 1 }), 350);
    },
    foot: ['DEALT Σ 356', 'ENEMY HP 0'],
  },
];

const FREEZE_COUNT: Record<string, number> = { rest: 1, surge: 4, kill: 5 };

export const TickerRoamPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [foot, setFoot] = useState<[string, string]>(GROUPS[0].foot);
  const timers = useRef<number[]>([]);

  const applyGroup = (g: Group) => {
    g.stage?.();
    tapePush(setEntries, g.rows);
    setFoot(g.foot);
  };

  useEffect(() => {
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    const freeze = params.get('freeze');
    const count = freeze ? (FREEZE_COUNT[freeze] ?? 1) : 0;
    if (count > 0) {
      // Apply instantly, without the entry animation, up to the beat.
      GROUPS.slice(0, count).forEach((g) => {
        g.stage?.();
        setEntries((prev) => [...prev, ...g.rows.map((r, i) => ({ ...r, id: prev.length + i + 1 }))]);
        setFoot(g.foot);
      });
    } else {
      applyGroup(GROUPS[0]);
    }
    const play = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setEntries([]);
      GROUPS.forEach((g, i) => {
        timers.current.push(window.setTimeout(() => applyGroup(g), i === 0 ? 0 : g.atMs));
      });
    };
    const w = window as unknown as Record<string, unknown>;
    w.__playRoam = play;
    if (params.get('auto') === '1' && !freeze) timers.current.push(window.setTimeout(play, 500));
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={HARNESS_WEAPON}
        playerLevel={5}
        equippedCount={4}
        activityKind="roaming_loot"
      />
      <TickerLedger title="ROAM — LEDGER" footLeft={foot[0]} footRight={foot[1]} entries={entries} />
    </div>
  );
};
