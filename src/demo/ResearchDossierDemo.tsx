/**
 * ResearchDossierDemo — PROTOTYPE harness (design/hunter-subpages-
 * research-d, 2026-11-05). NOT shipped UI: a fixture stage for the
 * Hunter-subpage design pass, Variant D (field paperwork), served
 * only at /?research-dossier (main.tsx branches before the real app
 * mounts). This branch dies with the prototype.
 *
 * Fixtures are REAL data shapes: the page renders the state view
 * derived by the game's own pure derivation — researchStateView
 * (src/content/research.ts) — from the same crafted server-fact
 * inputs Variant A used, so the five variants are judged on
 * composition, not on different data. Enroll / cancel are local
 * fixture state machines that mutate the facts and re-derive the
 * view through the same function.
 *
 * Capture params: &state=open (no enrollment), &arm=cancel (the
 * withdrawal notice starts armed), &detail=<courseId> (that course's
 * record sheet starts open).
 */
import React, { useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import {
  RESEARCH_LEVER_DEFAULTS,
  researchStateView,
  type ResearchCourseView,
  type ResearchFacts,
} from '@/content/research';
import { ResearchDossierPage } from './research-paperwork/ResearchDossierPage';
import { INK, INK_FAINT } from './research-paperwork/paperTokens';

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
              color: isActive ? INK : INK_FAINT,
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

/* ─── Research fixture (identical facts to Variant A) ────────────── */

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const HOUR = 3_600_000;

const RESEARCH_FACTS_0: ResearchFacts = {
  workshopBenches: 2,
  credits: 41250,
  completed: [
    { courseId: 'shop_fundamentals', completedAt: '2026-09-18T12:00:00.000Z' },
    { courseId: 'production_systems', completedAt: '2026-10-21T12:00:00.000Z' },
    { courseId: 'wrench_basics', completedAt: '2026-09-26T12:00:00.000Z' },
    { courseId: 'street_economics', completedAt: '2026-10-03T12:00:00.000Z' },
  ],
  activeEnrollment: {
    courseId: 'powertrain_systems',
    enrolledAt: new Date(NOW - Math.round(0.62 * 48 * HOUR)).toISOString(),
    completesAt: new Date(NOW - Math.round(0.62 * 48 * HOUR) + 48 * HOUR).toISOString(),
    costCredits: 15000,
    durationMs: 48 * HOUR,
  },
  nowMs: NOW,
};

export const ResearchDossierDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const openTrack = params.get('state') === 'open';
  const armCancel = params.get('arm') === 'cancel';
  const detail = params.get('detail');

  const [facts, setFacts] = useState<ResearchFacts>(() =>
    openTrack ? { ...RESEARCH_FACTS_0, activeEnrollment: null } : RESEARCH_FACTS_0,
  );
  const [busy, setBusy] = useState(false);

  const state = useMemo(() => researchStateView(facts, RESEARCH_LEVER_DEFAULTS), [facts]);

  const onEnroll = (course: ResearchCourseView) => {
    if (busy || !course.canEnroll) return;
    setBusy(true);
    window.setTimeout(() => {
      setFacts((prev) => ({
        ...prev,
        credits: prev.credits - course.costNow,
        activeEnrollment: {
          courseId: course.id,
          enrolledAt: new Date(NOW).toISOString(),
          completesAt: new Date(NOW + course.durationNowMs).toISOString(),
          costCredits: course.costNow,
          durationMs: course.durationNowMs,
        },
      }));
      setBusy(false);
    }, 200);
  };

  const onCancel = () => {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      setFacts((prev) => ({ ...prev, activeEnrollment: null }));
      setBusy(false);
    }, 200);
  };

  return (
    <div className="bl-page min-h-screen">
      <div className="mx-auto max-w-[430px] px-2.5 py-3">
        <Rail active="research" />
        <ResearchDossierPage
          state={state}
          busy={busy}
          onEnroll={onEnroll}
          onCancel={onCancel}
          initialSelectedId={detail}
          initialConfirmCancel={armCancel}
        />
      </div>
    </div>
  );
};
