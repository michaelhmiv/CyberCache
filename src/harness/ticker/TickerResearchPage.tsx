import React, { useEffect, useState } from 'react';
import { ResearchPanel } from '@/components/profile/ResearchPanel';
import { TickerLedger, type LedgerEntry } from './TickerLedger';

/**
 * TICKER LEDGER — RESEARCH (iter-04 harness, dev only).
 *
 * The REAL ResearchPanel (its state served by the harness chef
 * stub through the shipped researchStateView derivation) running
 * one real course: Shop Fundamentals, Fabrication tier 1 —
 * 6 hours, 2,500 CR fee, mastery XP at the shipped peg
 * RESEARCH_MASTERY_XP_PER_HOUR (10) × 6 h = 60 XP
 * (src/content/research.ts). The tape under the panel keeps the
 * course's account: the fee posts at enrollment, each settled hour
 * is a step line walking the progress balance, and completion is
 * the closing entry + the mastery balance line.
 *
 *   ?freeze=start|flow|done   the beat (also seeds the panel)
 */

type Row = Omit<LedgerEntry, 'id'>;

const OPEN_ROW: Row = {
  t: 'H0',
  kind: 'open',
  label: 'ENROLLED — SHOP FUNDAMENTALS · FABRICATION T1',
  amount: '−2,500 CR',
  balance: '0%',
};
const hourRow = (h: number): Row => ({
  t: `H${h}`,
  kind: 'step',
  label: `HOUR ${h}/6 — STUDY SETTLED`,
  balance: `${Math.round((h / 6) * 100)}%`,
});
const CLOSE_ROWS: Row[] = [
  { t: 'H6', kind: 'mile', label: 'MASTERY XP — SHOP FUNDAMENTALS', amount: '+60 XP', balance: '100%' },
  { t: 'H6', kind: 'close', label: 'COURSE SETTLED', amount: 'DONE', balance: '100%' },
];

const withIds = (rows: Row[]): LedgerEntry[] => rows.map((r, i) => ({ ...r, id: i + 1 }));

export const TickerResearchPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const freeze = params.get('freeze') ?? 'flow';
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [foot, setFoot] = useState<[string, string]>(['SHOP FUNDAMENTALS · 6H', 'PROGRESS 0%']);

  useEffect(() => {
    if (freeze === 'start') {
      setEntries(withIds([{ t: '—', kind: 'open', label: 'NO ENROLLMENT — TRACK FREE', balance: '0%' }]));
      setFoot(['SHOP FUNDAMENTALS · 6H · 2,500 CR', 'NOT ENROLLED']);
    } else if (freeze === 'flow') {
      setEntries(withIds([OPEN_ROW, hourRow(1), hourRow(2), hourRow(3)]));
      setFoot(['SHOP FUNDAMENTALS · 6H', 'PROGRESS 50%']);
    } else {
      setEntries(withIds([OPEN_ROW, hourRow(1), hourRow(2), hourRow(3), hourRow(4), hourRow(5), hourRow(6), ...CLOSE_ROWS]));
      setFoot(['SHOP FUNDAMENTALS · 6H', 'COMPLETE · +60 XP']);
    }
  }, [freeze]);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <ResearchPanel />
      <TickerLedger title="RESEARCH — LEDGER" footLeft={foot[0]} footRight={foot[1]} entries={entries} height={264} />
    </div>
  );
};
