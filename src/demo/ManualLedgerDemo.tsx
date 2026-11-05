/**
 * ManualLedgerDemo — PROTOTYPE harness (design/hunter-subpages-
 * manual-d, 2026-11-05). NOT shipped UI: a fixture stage for the
 * Hunter-subpage design pass, Variant D (field paperwork), served
 * only at /?manual-ledger (main.tsx branches before the real app
 * mounts). This branch dies with the prototype.
 *
 * Content is NOT fixture-copied: the page imports the shipped
 * manual's SECTIONS / TOUR_STEPS from helpContent, so the five
 * variants are judged on composition over identical words. The one
 * fixture fact is the reader: hunter "Rook Sandoval", Level 24 —
 * the same identity as every other variant — with the orientation
 * tour standing at step 3 of 7, exactly as Variant A's book.
 *
 * Capture params: &view=tour, &view=section&section=<id>, &q=<text>.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { ManualLedgerPage } from './manual-paperwork/ManualLedgerPage';
import { INK, INK_FAINT } from './manual-paperwork/paperTokens';
import './fonts.css';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'manual', label: 'Field Manual', icon: 'orders' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

const Rail: React.FC<{ active: string }> = ({ active }) => {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (rail && chip) rail.scrollLeft = Math.max(0, chip.offsetLeft - 10);
  }, [active]);
  return (
    <div ref={railRef} className="flex gap-1.5 overflow-x-auto pb-3" aria-hidden="true">
      {STOPS.map((stop) => {
        const isActive = stop.id === active;
        return (
          <span
            key={stop.id}
            data-active={isActive ? 'true' : undefined}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-black uppercase tracking-wide"
            style={{
              border: '2px solid #000',
              backgroundColor: isActive ? '#1D1811' : 'rgba(6,5,4,0.55)',
              color: isActive ? INK : INK_FAINT,
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(163,152,134,0.35)' : undefined,
            }}
          >
            <PxIcon name={stop.icon} size={14} />
            {stop.label}
          </span>
        );
      })}
    </div>
  );
};

export const ManualLedgerDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const initialView = viewParam === 'tour' || viewParam === 'section' ? viewParam : 'index';
  return (
    <div className="bl-page min-h-screen">
      <div className="mx-auto max-w-[430px] px-2.5 py-3">
        <Rail active="manual" />
        <ManualLedgerPage
          initialView={initialView}
          initialSection={params.get('section') ?? 'loot'}
          initialQuery={params.get('q') ?? ''}
        />
      </div>
    </div>
  );
};
