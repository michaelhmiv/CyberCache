/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-wardrobe-e,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches before
 * the real app mounts; no Chef session, no stores).
 *
 * Variant E ("Quiet plates") for the Wardrobe. The fixture is variant
 * A's, fact for fact — same hunter, same parts, same selection — so
 * the five variants differ in design only, never in facts.
 *
 *   /subpages-demo                     the ledger, at rest
 *   /subpages-demo?preview=dread-head  the Dreadplate Helm previewed
 *   /subpages-demo?guest=1             the guest lock at the action
 *
 * The switcher bar is capture scaffolding, not design.
 */
import React from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { WardrobeLedgerPage } from './subpages/WardrobeLedgerPage';
import './fonts.css';

const PRESETS: { label: string; search: string }[] = [
  { label: 'Wardrobe', search: '' },
  { label: 'Wardrobe · Preview', search: '?preview=dread-head' },
  { label: 'Wardrobe · Guest', search: '?guest=1' },
];

export const SubpagesDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const current = window.location.search;

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
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="demo-scroll">
        <div className="mx-auto w-full max-w-[430px] px-5 py-4">
          <WardrobeLedgerPage
            initialPreviewPartId={params.get('preview') ?? undefined}
            initialGuest={params.get('guest') === '1'}
          />
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
