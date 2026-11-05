import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

export const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };

/**
 * Tape — the inspect sheet's section grammar (DESIGN.md §1: One
 * Sheet). Extracted from GearInspectSheet so every tape on the
 * sheet — Stat Poster, The Trade, Market Intelligence — renders
 * through the one component instead of drifting copies.
 */
export function Tape({ title, px, icon: Icon, children }: { title: string; px?: PxIconName; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[5px_5px_0_rgba(0,0,0,0.42)]" style={panelClip}>
      <div className="pointer-events-none absolute -right-8 top-2 h-5 w-28 rotate-12 bg-amber/10" />
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber">{Icon ? <Icon size={14} /> : px ? <PxIcon name={px} size={13} /> : null}{title}</div>
      {children}
    </section>
  );
}
