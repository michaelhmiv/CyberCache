import React, { useEffect, useRef, useState } from 'react';
import { ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { TickerLedger, tapePush, type LedgerEntry } from './TickerLedger';

/**
 * TICKER LEDGER — GATHERING / EXTRACTION (iter-04 harness, dev only).
 *
 * The real ExtractionScene (panel bay scene) working a Surface pass
 * in Dustwaste Frontier. The pass is priced from the shipped defs
 * (src/content/extraction.ts): a 10-minute pass at 192 draws/hour
 * is exactly 32 draws; the area's shipped find pool
 * (src/constants/roamingAreas.ts materialBias, weight 2 each via
 * rollAreaMaterialFind) holds exactly two finds — Scrap and
 * BallisticParts (essenceBias is empty here). The tape posts each
 * find as a yield line with the material's running Σ in the balance
 * column; the account closes at 32/32 draws with the pass's real
 * mastery line (+20 XP to gathering.extraction,
 * EXTRACTION_MASTERY_XP_PER_PASS). The 18/14 split is this fixture's
 * decided outcome over the real pool — only pool members, and the
 * draws sum exactly.
 *
 *   ?freeze=start|flow|yield   hold a beat (stills)
 *   ?auto=1                     play once
 */

type Row = Omit<LedgerEntry, 'id'>;

// [label, amount, material running total after, draws after, stamp]
const FINDS: Array<[string, number, number, number, string]> = [
  ['SCRAP', 2, 2, 2, '00:37'],
  ['BALLISTIC PARTS', 1, 1, 3, '01:15'],
  ['SCRAP', 3, 5, 6, '01:52'],
  ['BALLISTIC PARTS', 2, 3, 8, '02:30'],
  ['SCRAP', 1, 6, 9, '03:07'],
  ['BALLISTIC PARTS', 2, 5, 11, '03:45'],
  ['SCRAP', 3, 9, 14, '04:22'],
  ['BALLISTIC PARTS', 1, 6, 15, '05:00'],
  ['SCRAP', 2, 11, 17, '05:37'],
  ['BALLISTIC PARTS', 2, 8, 19, '06:15'],
  ['SCRAP', 3, 14, 22, '06:52'],
  ['BALLISTIC PARTS', 1, 9, 23, '07:30'],
  ['SCRAP', 2, 16, 25, '08:07'],
  ['BALLISTIC PARTS', 2, 11, 27, '08:45'],
  ['SCRAP', 2, 18, 29, '09:22'],
  ['BALLISTIC PARTS', 3, 14, 32, '10:00'],
];

const findRow = ([label, n, total, , stamp]: (typeof FINDS)[number]): Row => ({
  t: stamp,
  kind: 'yield',
  label: `FIND — ${label}`,
  amount: `+${n}`,
  balance: `${label === 'SCRAP' ? 'SCRAP' : 'BPARTS'} Σ${total}`,
});

const OPEN_ROW: Row = { t: '00:00', kind: 'open', label: 'PASS — DUSTWASTE FRONTIER · SURFACE', balance: 'DRAWS 0/32' };
const CLOSE_ROWS: Row[] = [
  { t: '10:00', kind: 'mile', label: 'MASTERY — GATHERING.EXTRACTION', amount: '+20 XP' },
  { t: '10:00', kind: 'close', label: 'PASS SETTLED', amount: '32 DRAWS', balance: 'DONE' },
];

export const TickerGatherPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<'success' | null>(null);
  const [foot, setFoot] = useState<[string, string]>(['SCRAP Σ0 · BPARTS Σ0', 'DRAWS 0/32']);
  const timers = useRef<number[]>([]);
  const pushedRef = useRef(0);

  const applyFinds = (count: number) => {
    const rows = FINDS.slice(pushedRef.current, count).map(findRow);
    pushedRef.current = count;
    tapePush(setEntries, rows);
    const last = FINDS[count - 1];
    if (last) {
      setProgress(last[3] / 32);
      const scrap = FINDS.slice(0, count).filter((f) => f[0] === 'SCRAP').reduce((s, f) => s + f[1], 0);
      const bp = FINDS.slice(0, count).filter((f) => f[0] !== 'SCRAP').reduce((s, f) => s + f[1], 0);
      setFoot([`SCRAP Σ${scrap} · BPARTS Σ${bp}`, `DRAWS ${last[3]}/32`]);
    }
  };

  useEffect(() => {
    const freeze = params.get('freeze');
    tapePush(setEntries, [OPEN_ROW]);
    if (freeze === 'flow') {
      applyFinds(8);
    } else if (freeze === 'yield') {
      applyFinds(16);
      tapePush(setEntries, CLOSE_ROWS);
      setProgress(1);
      setResult('success');
      setFoot(['SCRAP Σ18 · BPARTS Σ14', 'DRAWS 32/32']);
    } else if (!freeze) {
      const play = () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
        setEntries([]);
        setProgress(0);
        setResult(null);
        pushedRef.current = 0;
        tapePush(setEntries, [OPEN_ROW]);
        FINDS.forEach((_, i) => {
          timers.current.push(window.setTimeout(() => applyFinds(i + 1), 700 * (i + 1)));
        });
        timers.current.push(
          window.setTimeout(() => {
            tapePush(setEntries, CLOSE_ROWS);
            setProgress(1);
            setResult('success');
            setFoot(['SCRAP Σ18 · BPARTS Σ14', 'DRAWS 32/32']);
          }, 700 * 17),
        );
      };
      const w = window as unknown as Record<string, unknown>;
      w.__playGather = play;
      if (params.get('auto') === '1') timers.current.push(window.setTimeout(play, 500));
    }
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <ExtractionScene
        progress={progress}
        causeLabel="Extraction · Dustwaste Frontier"
        buysLabel="→ Scrap · Ballistic Parts"
        working={progress > 0 && progress < 1}
        result={result}
      />
      <TickerLedger title="EXTRACTION — LEDGER" footLeft={foot[0]} footRight={foot[1]} entries={entries} height={264} />
    </div>
  );
};
