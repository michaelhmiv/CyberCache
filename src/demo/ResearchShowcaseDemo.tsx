/**
 * ResearchShowcaseDemo — PROTOTYPE harness (design/hunter-subpages-
 * research-c, 2026-11-05). NOT shipped UI: a fixture stage for the
 * Hunter-subpage design pass, served only at /subpages-demo
 * (main.tsx branches before the real app mounts). This branch dies
 * with the prototype; it is never a shipping path.
 *
 * Fixtures are REAL data shapes: the page renders a state view
 * derived by the game's own pure derivation — researchStateView
 * (src/content/research.ts) — from crafted server-fact inputs of the
 * same shape the Chef routes supply, IDENTICAL to Variant A's
 * fixtures so the five looks compare on the same facts. Enroll /
 * cancel are local fixture state machines that mutate the facts and
 * re-derive the view through the same function, so every number,
 * gate, and price on screen is the game's math.
 *
 * Fixture facts (as Variant A): Hunter "Rook Sandoval" — 4/12
 * completed (Shop Fundamentals, Production Systems, Wrench Basics,
 * Street Economics), balance 41,250 cr, clock fixed at
 * 2026-11-05T12:00Z for deterministic captures. In-session state:
 * Powertrain Systems enrolled, 62% studied, 18 h 15 m left.
 * Open-track state (&state=open): no enrollment — Ballistics Theory,
 * Powertrain Systems and Supply Chains enrollable, Master Fabricator
 * available but unaffordable (60,000 > 41,250), four courses
 * prerequisite-locked.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import {
  RESEARCH_LEVER_DEFAULTS,
  researchStateView,
  type ResearchCourseView,
  type ResearchFacts,
} from '@/content/research';
import { ResearchGalleryPage } from './subpages/ResearchGalleryPage';

const INK = '#F5ECDA';
const FAINT = '#A99B7E';
const LINE = 'rgba(245,236,218,0.16)';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

/** The Hunter door rail, restated quietly for the gallery register. */
const Rail: React.FC<{ active: string }> = ({ active }) => {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (rail && chip) rail.scrollLeft = Math.max(0, chip.offsetLeft - 10);
  }, [active]);
  return (
    <div
      ref={railRef}
      className="flex gap-1.5 overflow-x-auto px-3 py-3"
      style={{ backgroundColor: '#0A0806', borderBottom: `1px solid ${LINE}` }}
      aria-hidden="true"
    >
      {STOPS.map((stop) => {
        const isActive = stop.id === active;
        return (
          <span
            key={stop.id}
            data-active={isActive ? 'true' : undefined}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-black uppercase tracking-wide"
            style={{
              border: `1px solid ${isActive ? 'rgba(245,236,218,0.45)' : LINE}`,
              color: isActive ? INK : FAINT,
              backgroundColor: isActive ? 'rgba(245,236,218,0.06)' : 'transparent',
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

/* ─── Fixtures ───────────────────────────────────────────────────── */

/** Fixed clock for deterministic captures: 2026-11-05T12:00:00Z. */
const NOW_MS = Date.parse('2026-11-05T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

const COMPLETED: ResearchFacts['completed'] = [
  { courseId: 'shop_fundamentals', completedAt: '2026-10-21T12:00:00.000Z' },
  { courseId: 'wrench_basics', completedAt: '2026-10-26T12:00:00.000Z' },
  { courseId: 'street_economics', completedAt: '2026-10-30T12:00:00.000Z' },
  { courseId: 'production_systems', completedAt: '2026-11-03T12:00:00.000Z' },
];

/** Powertrain Systems: 48 h course, 18 h 15 m left at the fixed clock. */
const SESSION_ENROLLMENT: ResearchFacts['activeEnrollment'] = {
  courseId: 'powertrain_systems',
  enrolledAt: '2026-11-04T06:15:00.000Z',
  completesAt: '2026-11-06T06:15:00.000Z',
  costCredits: 15000,
  durationMs: 48 * 3_600_000,
};

function baseFacts(openTrack: boolean): ResearchFacts {
  return {
    workshopBenches: 1,
    credits: 41250,
    completed: COMPLETED,
    activeEnrollment: openTrack ? null : SESSION_ENROLLMENT,
    nowMs: NOW_MS,
  };
}

export const ResearchShowcaseDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const openTrack = params.get('state') === 'open';
  const [facts, setFacts] = useState<ResearchFacts>(() => baseFacts(openTrack));

  const view = useMemo(
    () => researchStateView(facts, RESEARCH_LEVER_DEFAULTS),
    [facts],
  );

  /** Fixture state machine: enroll snapshots the view's own terms. */
  const enroll = (course: ResearchCourseView) => {
    if (!course.canEnroll) return;
    setFacts((f) => ({
      ...f,
      credits: f.credits - course.costNow,
      activeEnrollment: {
        courseId: course.id,
        enrolledAt: NOW_ISO,
        completesAt: new Date(NOW_MS + course.durationNowMs).toISOString(),
        costCredits: course.costNow,
        durationMs: course.durationNowMs,
      },
    }));
  };

  /** Cancelling forfeits: the enrollment is deleted, the fee stays gone. */
  const cancel = () => {
    setFacts((f) => ({ ...f, activeEnrollment: null }));
  };

  return (
    <div style={{ backgroundColor: '#0A0806' }}>
      <Rail active="research" />
      <ResearchGalleryPage view={view} onEnroll={enroll} onCancel={cancel} />
    </div>
  );
};
