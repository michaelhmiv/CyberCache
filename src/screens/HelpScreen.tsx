import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Search,
  X,
} from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  SECTIONS,
  TOUR_STEPS,
  type HelpSection,
  type TabId,
  type TourStep,
} from './helpContent';

interface HelpScreenProps {
  // Optional callback for the guided tour's "Go to ..." buttons. If the host
  // app (App.tsx) wires this up, the tour can switch tabs for the player.
  onTourJump?: (tab: TabId) => void;
}

const SectionCard: React.FC<{ section: HelpSection; open: boolean; onToggle: () => void; query: string }> = ({ section, open, onToggle, query }) => {
  const sectionIcon = section.icon;
  const lower = query.toLowerCase();
  const filtered = query.trim().length === 0
    ? section.items
    : section.items.filter((it) => it.term.toLowerCase().includes(lower) || it.body.toLowerCase().includes(lower));
  if (query && filtered.length === 0) return null;
  return (
    <MobileCard rarityColor={section.color}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left transition-transform active:scale-[0.98]"
      >
        <div className="bl-icon-plate flex h-9 w-9 shrink-0 items-center justify-center" style={{ backgroundColor: `${section.color}18` }}>
          <PxIcon name={sectionIcon} size={17} style={{ color: section.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-wide text-text-primary">{section.title}</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">{section.blurb}</div>
        </div>
        <div className="text-[9px] font-black uppercase tracking-widest text-text-muted">{filtered.length}</div>
        {open ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t-2 border-border pt-2">
          {filtered.map((item) => (
            <div key={item.term} className="border-l-2 pl-2" style={{ borderColor: section.color }}>
              <div className="text-[11px] font-black uppercase tracking-wide text-text-primary">{item.term}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">{item.body}</div>
            </div>
          ))}
        </div>
      )}
    </MobileCard>
  );
};

const TourStepCard: React.FC<{
  step: TourStep;
  index: number;
  total: number;
  isCurrent: boolean;
  onJump: (tab: TabId) => void;
}> = ({ step, index, isCurrent, onJump }) => {
  const stepIcon = step.target.icon;
  return (
    <div
      className={`relative border-2 p-3 transition-all ${
        isCurrent ? 'border-amber bg-amber/10' : 'border-border bg-surface/40'
      }`}
      style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}
    >
      <div className="flex items-start gap-2">
        <div className={`bl-icon-plate flex h-7 w-7 shrink-0 items-center justify-center ${isCurrent ? 'bg-amber text-bg' : 'bg-bg text-amber'}`}>
          <span className="text-[10px] font-black">{index + 1}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-black uppercase tracking-wide text-text-primary">{step.title}</div>
          <div className="mt-1 text-[11px] leading-snug text-text-secondary">{step.body}</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1 border border-border bg-bg/70 px-1.5 py-0.5">
              <PxIcon name={stepIcon} size={13} className="text-amber" />
              <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary">{step.target.label}</span>
            </div>
            <span className="text-[9px] text-text-muted">·</span>
            <span className="text-[9px] uppercase tracking-wide text-text-muted">{step.spotlight}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJump(step.target.tab)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 border-2 border-border bg-bg py-1.5 text-[10px] font-black uppercase tracking-widest text-amber transition-transform active:scale-[0.97]"
        style={{ clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' }}
      >
        {step.cta}
        <ArrowRight size={11} />
      </button>
    </div>
  );
};

export const HelpScreen: React.FC<HelpScreenProps> = ({ onTourJump }) => {
  const [openId, setOpenId] = useState<string | null>('start');
  const [query, setQuery] = useState('');
  const [tourStep, setTourStep] = useState<number>(0);
  const [tourOpen, setTourOpen] = useState<boolean>(true);

  // When searching, auto-open every section that has a hit so the user
  // doesn't have to click through each one.
  const effectiveOpenId = useMemo(() => (query.trim().length > 0 ? '__all__' : openId), [query, openId]);

  const handleTourJump = (tab: TabId) => {
    if (onTourJump) {
      onTourJump(tab);
    } else {
      // Fallback: surface a clear hint if the host hasn't wired onTourJump.
      // We don't try to fake a tab switch because the BottomNav state lives
      // in App.tsx and the screens are mounted by tab.
      console.warn('[HelpScreen] onTourJump not wired; cannot switch to', tab);
    }
    // Advance the cursor so the player sees progress when they return.
    setTourStep((prev) => Math.min(prev + 1, TOUR_STEPS.length - 1));
  };

  const resetTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Field Manual</div>
          <div className="text-xs text-text-muted">Pinned notes for loot, combat, caches, and buildcraft.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <PxIcon name="book" size={26} />
        </div>
      </div>

      <MobileCard rarityColor="#FF4B5C">
        <button
          type="button"
          onClick={() => setTourOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left transition-transform active:scale-[0.98]"
        >
          <div className="bl-icon-plate flex h-9 w-9 shrink-0 items-center justify-center bg-[#FF4B5C]/15">
            <PxIcon name="pin" size={17} className="text-[#FF4B5C]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black uppercase tracking-wide text-text-primary">Guided Tour</div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-text-muted">
              Step {tourStep + 1} of {TOUR_STEPS.length} — {TOUR_STEPS[tourStep].title.replace(/^\d+\.\s*/, '')}
            </div>
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-text-muted">
            {Math.round(((tourStep + 1) / TOUR_STEPS.length) * 100)}%
          </div>
          {tourOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </button>
        {tourOpen && (
          <div className="mt-2 space-y-2 border-t-2 border-border pt-2">
            <TourStepCard
              step={TOUR_STEPS[tourStep]}
              index={tourStep}
              total={TOUR_STEPS.length}
              isCurrent
              onJump={handleTourJump}
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.max(0, s - 1))}
                disabled={tourStep === 0}
                className="border-2 border-border bg-bg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-text-secondary transition-transform active:scale-[0.97] disabled:opacity-30"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={resetTour}
                className="border-2 border-border bg-bg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-text-muted transition-transform active:scale-[0.97]"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                disabled={tourStep === TOUR_STEPS.length - 1}
                className="border-2 border-amber bg-amber/20 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber transition-transform active:scale-[0.97] disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </MobileCard>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual..."
          className="w-full border-2 border-border bg-bg/80 py-1.5 pl-7 pr-7 text-xs text-text-primary placeholder:text-text-muted focus:border-amber focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {SECTIONS.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            open={effectiveOpenId === '__all__' || openId === section.id}
            onToggle={() => setOpenId((prev) => (prev === section.id ? null : section.id))}
            query={query}
          />
        ))}
      </div>
    </div>
  );
};
