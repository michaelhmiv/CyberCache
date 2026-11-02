import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { getResearchState } from '@/lib/chef/chefClient';
import {
  formatResearchRemaining,
  researchCourse,
  researchFaculty,
  type ResearchStateView,
} from '@/content/research';

/**
 * Research Dashboard surfaces (0038): the in-progress chip beside
 * the current-area chip, and the one-time "Course Complete" card.
 *
 * Both render from the Chef's research state view (settle-then-
 * read — opening the Dashboard is what lazily settles a finished
 * course, so the completion card appears on the first open after
 * completes_at). The chip shows nothing when no course is
 * enrolled; the card shows once per completion — dismissal is
 * keyed to that completion in localStorage (a UI preference, the
 * one thing local storage is for; completions themselves are
 * server records and never live here).
 */
const SEEN_KEY = 'cc-research-completion-seen';

export const ResearchChip: React.FC = () => {
  const [state, setState] = useState<ResearchStateView | null>(null);

  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setState(result.research);
      })
      .catch(() => {
        // Chef unreachable: no chip (Research is Chef-owned state).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = state?.activeEnrollment;
  if (!state || !active) return null;
  const faculty = researchFaculty(active.faculty);

  return (
    <div
      data-testid="research-chip"
      className="flex items-center gap-2 border-2 border-border bg-surface/95 px-2.5 py-1.5"
      aria-label={`Research in progress: ${active.courseName}, ${formatResearchRemaining(active.remainingMs)}`}
    >
      <PxIcon name="pencil" size={13} style={{ color: faculty.color }} />
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-wide text-text-primary">
          {active.courseName}
        </span>
        <span className="block text-[9px] text-text-muted">
          {formatResearchRemaining(active.remainingMs)} · studying
        </span>
      </span>
    </div>
  );
};

export const ResearchCompletionCard: React.FC = () => {
  const [state, setState] = useState<ResearchStateView | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setState(result.research);
      })
      .catch(() => {
        // Chef unreachable: no card.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const last = state?.lastCompletion;
  if (!state || !last || dismissed) return null;
  const seenKey = `${last.courseId}:${last.completedAt}`;
  let seen = false;
  try {
    seen = window.localStorage.getItem(SEEN_KEY) === seenKey;
  } catch {
    // Storage unavailable: treat as unseen.
  }
  if (seen) return null;

  const course = researchCourse(last.courseId);
  if (!course) return null;
  const faculty = researchFaculty(course.faculty);

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, seenKey);
    } catch {
      // Storage unavailable: dismiss for this mount only.
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="research-completion-card"
      className="bl-card flex items-start gap-3 p-3"
      style={{ borderLeftColor: faculty.color, borderLeftWidth: 5 }}
    >
      <PxIcon name="pencil" size={17} style={{ color: faculty.color }} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">
          Course Complete — {course.name}
        </div>
        <div className="text-[11px] text-text-muted">{course.unlockText}</div>
        <div className="text-[10px] text-text-muted">
          {faculty.name} · the unlock is live now, everywhere it applies.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded bg-white/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-text-primary transition-transform active:scale-95"
      >
        Got it
      </button>
    </div>
  );
};
