/**
 * ManualConsoleDemo — PROTOTYPE harness (design/hunter-subpages-manual-b,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo (main.tsx branches before
 * the real app mounts; no Chef session, no stores).
 *
 *   ?page=manual[&view=index|section][&section=loot][&step=2][&query=salvage]
 *
 * Fixture hunter: Rook Sandoval, Level 24 — the same fixture identity
 * as the approved Hunter-menu anchor and every sibling variant, so the
 * five looks compare on identical facts. Orientation fixture sits at
 * step 3 of 7, exactly like variant A.
 *
 * The switcher bar is capture scaffolding, not design.
 */
import React from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { FieldManualConsole } from './FieldManualConsole';
import './fonts.css';

const PRESETS: { label: string; search: string }[] = [
  { label: 'Manual · Index', search: '?page=manual' },
  { label: 'Manual · Section', search: '?page=manual&view=section&section=loot' },
  { label: 'Manual · Query', search: '?page=manual&query=salvage' },
];

export const ManualConsoleDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const current = window.location.search || '?page=manual';

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
          <FieldManualConsole
            initialView={params.get('view') === 'section' ? 'section' : 'index'}
            initialSection={params.get('section') ?? 'loot'}
            initialTourStep={Number(params.get('step') ?? 2)}
            initialQuery={params.get('query') ?? ''}
          />
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
