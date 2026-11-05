/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-wardrobe-manual,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches before
 * the real app mounts; no Chef session, no stores).
 *
 *   ?page=wardrobe[&slot=head][&preview=dread-head][&guest=1]
 *   ?page=manual[&view=cover|tour|section][&section=loot][&step=2]
 *
 * The switcher bar is capture scaffolding, not design.
 */
import React from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import type { CosmeticSlot } from '@/content/skins';
import { WardrobeStand } from './WardrobeStand';
import { FieldManualBook } from './FieldManualBook';

const PRESETS: { label: string; search: string }[] = [
  { label: 'Wardrobe', search: '?page=wardrobe' },
  { label: 'Wardrobe · Preview', search: '?page=wardrobe&slot=head&preview=dread-head' },
  { label: 'Wardrobe · Guest', search: '?page=wardrobe&guest=1' },
  { label: 'Manual · Cover', search: '?page=manual' },
  { label: 'Manual · Section', search: '?page=manual&view=section&section=loot' },
  { label: 'Manual · Tour', search: '?page=manual&view=tour&step=2' },
];

export const SubpagesDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page') === 'manual' ? 'manual' : 'wardrobe';
  const current = window.location.search || '?page=wardrobe';

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              window.location.search = p.search;
            }}
            className={`shrink-0 px-2 py-1 text-[11px] font-black uppercase ${
              current === p.search ? 'bg-amber text-bg' : 'text-text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[430px] px-3 py-3">
          {page === 'wardrobe' ? (
            <WardrobeStand
              initialSlot={(params.get('slot') as CosmeticSlot | null) ?? 'head'}
              initialPreviewPartId={params.get('preview') ?? undefined}
              initialGuest={params.get('guest') === '1'}
            />
          ) : (
            <FieldManualBook
              initialView={(params.get('view') as 'cover' | 'tour' | 'section' | null) ?? 'cover'}
              initialSection={params.get('section') ?? 'loot'}
              initialTourStep={Number(params.get('step') ?? 2)}
            />
          )}
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
