/**
 * WikiManualDemo — PROTOTYPE harness (design/field-manual-wiki-native,
 * 2026-11-05). NOT shipped UI: a stage for the Field Manual wiki-native
 * design pass (owner option 3), served only at /subpages-demo
 * (main.tsx branches before the real app mounts; no Chef session, no
 * stores — the wiki corpus is static build-time content).
 *
 *   ?page=wiki[&doc=Getting-Started]
 *
 * The switcher bar is capture scaffolding, not design.
 */
import React from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { WikiManualScreen } from './WikiManualScreen';
import './fonts.css';

const PRESETS: { label: string; search: string }[] = [
  { label: 'Wiki · Index', search: '?page=wiki' },
  { label: 'Wiki · Article', search: '?page=wiki&doc=Getting-Started' },
  { label: 'Wiki · Tables', search: '?page=wiki&doc=Reference-Consumables' },
];

export const WikiManualDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const current = window.location.search || '?page=wiki';

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
          <WikiManualScreen initialDoc={params.get('doc')} />
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};
