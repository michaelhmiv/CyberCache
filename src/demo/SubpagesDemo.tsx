/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-wardrobe-c,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches
 * before the real app mounts; no Chef session, no stores).
 *
 *   ?page=wardrobe[&preview=dread-head][&guest=1]
 *
 * The switcher bar is capture scaffolding, not design.
 */
import React from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { WardrobeGallery } from './WardrobeGallery';
import './fonts.css';

const PRESETS: { label: string; search: string }[] = [
  { label: 'Wardrobe', search: '?page=wardrobe' },
  { label: 'Wardrobe · Preview', search: '?page=wardrobe&preview=dread-head' },
  { label: 'Wardrobe · Guest', search: '?page=wardrobe&guest=1' },
];

export const SubpagesDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
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
          <WardrobeGallery
            initialPreviewPartId={params.get('preview') ?? undefined}
            initialGuest={params.get('guest') === '1'}
          />
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
