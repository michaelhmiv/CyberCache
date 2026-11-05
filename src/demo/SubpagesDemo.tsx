/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-profile-e,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches
 * before the real app mounts). This branch dies with the prototype;
 * it is never a shipping path.
 *
 * Variant E ("Quiet plates") for Profile. The fixture is variant A's
 * hunter — same name, level, record, shelf, and death log — carried
 * as payload-shaped fixtures (profileLedgerFixtures.ts), so the five
 * Profile variants differ in design only, never in facts. Doors are
 * presentational in the prototype; Totals & Sources expands in place
 * over a summary built by the game's own stat chain.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { ProfileLedgerPage } from './subpages/ProfileLedgerPage';
import './fonts.css';

const BONE = '#F5EFE6';
const BONE_FAINT = '#A2957F';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
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
              color: isActive ? BONE : BONE_FAINT,
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

export const SubpagesDemo: React.FC = () => (
  <div className="bl-page min-h-screen">
    <div className="mx-auto max-w-[430px] px-2.5 py-3">
      <Rail active="profile" />
      <ProfileLedgerPage />
    </div>
  </div>
);
