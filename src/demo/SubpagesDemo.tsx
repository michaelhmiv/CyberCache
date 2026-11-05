/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-wardrobe-b,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches before
 * the real app mounts; no Chef session, no stores).
 *
 *   ?page=wardrobe[&slot=head][&preview=dread-head][&guest=1]
 *
 * The stop rail above the page is capture scaffolding, not design.
 * The local fonts.css serves Bebas Neue + Chakra Petch from files
 * beside the demo — the shipped app's Google Fonts @import is
 * unreachable from the local capture browser, and captures must
 * show the design's real letterforms.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import type { CosmeticSlot } from '@/content/skins';
import { WardrobeConsolePage } from './subpages/WardrobeConsolePage';
import './fonts.css';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'wardrobe', label: 'Wardrobe', icon: 'armor' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

const INK = '#F5EFE6';
const FAINT = '#A2957F';

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
              color: isActive ? INK : FAINT,
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(163,152,134,0.35)' : undefined,
            }}
          >
            <PxIcon name={stop.icon} size={13} />
            {stop.label}
          </span>
        );
      })}
    </div>
  );
};

export const SubpagesDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  return (
    <div className="bl-page min-h-screen">
      <div className="mx-auto max-w-[430px] px-2.5 py-3">
        <Rail active="wardrobe" />
        <WardrobeConsolePage
          initialSlot={(params.get('slot') as CosmeticSlot | null) ?? 'head'}
          initialPreviewPartId={params.get('preview') ?? undefined}
          initialGuest={params.get('guest') === '1'}
        />
      </div>
    </div>
  );
};
