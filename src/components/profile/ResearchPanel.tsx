import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  cancelResearch,
  enrollResearch,
  getResearchState,
  newResearchCancelNonce,
  newResearchEnrollNonce,
} from '@/lib/chef/chefClient';
import {
  formatResearchDuration,
  formatResearchRemaining,
  researchBenchName,
  researchCourse,
  researchFaculty,
  type ResearchCourseView,
  type ResearchStateView,
} from '@/content/research';

/**
 * Research panel (Profile) — the parallel education track (0038).
 *
 * Research is a commitment, not an action: enrolling never touches
 * the hunter's current activity, and the course clock runs on the
 * server's wall clock beside whatever the hunter is doing. This
 * panel only renders the Chef's state view and sends intent (a
 * nonce + a course id); fees, durations, gates, and completions
 * are the server's records. It renders nothing until the Chef
 * answers, so an unreachable Chef simply omits the panel.
 *
 * Phone rules: costs, durations, and remaining times are never
 * ellipsized; lock reasons print in full; a failed enroll/cancel
 * surfaces its server reason in place.
 */
export const ResearchPanel: React.FC = () => {
  const [state, setState] = useState<ResearchStateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Course detail (QC A7): every course card opens a full brief —
  // gates, lever-applied fee/duration, unlock, and the same enroll
  // affordance the card carries. Viewing is never gated (guests see
  // the whole catalog with real data); enrolling keeps exactly the
  // server view's canEnroll gating it has always had.
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getResearchState();
    setState(result.research);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setState(result.research);
      })
      .catch(() => {
        // Chef unreachable: the panel stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enroll = useCallback(
    async (course: ResearchCourseView) => {
      if (busy || !course.canEnroll) return;
      setBusy(course.id);
      setError(null);
      try {
        const result = await enrollResearch({
          nonce: newResearchEnrollNonce(),
          courseId: course.id,
        });
        if (result.research) setState(result.research);
        else await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Enrollment failed');
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh],
  );

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy('cancel');
    setError(null);
    try {
      const result = await cancelResearch({ nonce: newResearchCancelNonce() });
      setConfirmCancel(false);
      if (result.research) setState(result.research);
      else await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setBusy(null);
    }
  }, [busy, refresh]);

  if (!state) return null;

  const active = state.activeEnrollment;
  const activeCourse = active
    ? state.courses.find((c) => c.id === active.courseId)
    : undefined;
  const selectedCourse = selectedCourseId
    ? state.courses.find((c) => c.id === selectedCourseId)
    : undefined;

  return (
    <MobileCard className="space-y-3" rarityColor="#7FB069">
      <div className="flex items-center gap-2">
        <PxIcon name="pencil" size={17} style={{ color: '#7FB069' }} />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Research</div>
        <div className="ml-auto flex items-baseline gap-1">
          <span className="text-lg font-black" style={{ color: '#7FB069' }}>
            {state.completedCount}
          </span>
          <span className="text-[10px] font-bold uppercase text-text-muted">
            / {state.totalCourses} courses
          </span>
        </div>
      </div>

      <div className="text-[10px] text-text-muted">
        Courses run on their own clock beside your current activity — enrolling never interrupts
        roaming, crafting, or a fight. The fee is paid on enrollment and is not refunded; there is
        no player XP — the unlock and Scholarship mastery are the reward. Balance:{' '}
        <span className="font-bold text-text-primary">{state.credits.toLocaleString()} cr</span>
      </div>

      {active && (
        <div
          className="bl-card space-y-2 p-3"
          style={{
            borderLeftColor: researchFaculty(active.faculty).color,
            borderLeftWidth: 5,
          }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wide text-text-primary">
              {active.courseName}
            </span>
            <span
              className="text-[11px] font-black"
              style={{ color: researchFaculty(active.faculty).color }}
            >
              {formatResearchRemaining(active.remainingMs)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-black/40">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.round(active.progressFraction * 100)}%`,
                backgroundColor: researchFaculty(active.faculty).color,
              }}
            />
          </div>
          <div className="text-[10px] text-text-muted">
            Enrolled for {active.costCredits.toLocaleString()} cr · completes{' '}
            {new Date(active.completesAt).toLocaleString()}
          </div>
          {confirmCancel ? (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-red">{state.cancelTerms}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => void cancel()}
                  disabled={busy !== null}
                  className="rounded bg-red px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white transition-transform active:scale-95 disabled:opacity-40"
                >
                  {busy === 'cancel' ? '…' : 'Forfeit course'}
                </button>
                <button
                  onClick={() => setConfirmCancel(false)}
                  disabled={busy !== null}
                  className="rounded bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-text-primary transition-transform active:scale-95 disabled:opacity-40"
                >
                  Keep studying
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="rounded bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-text-primary transition-transform active:scale-95"
            >
              Cancel course
            </button>
          )}
        </div>
      )}

      {state.faculties.map((faculty) => (
        <div key={faculty.id} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span
              className="text-[11px] font-black uppercase tracking-wide"
              style={{ color: faculty.color }}
            >
              {faculty.name}
            </span>
            <span className="text-[10px] text-text-muted">{faculty.home}</span>
          </div>
          <div className="space-y-2">
            {faculty.courseIds.map((courseId) => {
              const course = state.courses.find((c) => c.id === courseId);
              if (!course) return null;
              const isActive = activeCourse?.id === course.id;
              return (
                <div
                  key={course.id}
                  className="bl-card flex items-start gap-3 p-2.5"
                  style={{ borderLeftColor: faculty.color, borderLeftWidth: 5 }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCourseId(course.id)}
                    aria-expanded={selectedCourseId === course.id}
                    aria-label={`${course.name} course details`}
                    data-testid={`research-course-${course.id}`}
                    className="min-w-0 flex-1 space-y-1 text-left"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs font-black uppercase tracking-wide text-text-primary">
                        {course.name}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-text-muted">
                        Tier {course.tier}
                      </span>
                      <span className="text-[10px] font-bold text-text-muted">
                        {formatResearchDuration(course.durationNowMs)} ·{' '}
                        {course.costNow.toLocaleString()} cr
                      </span>
                      <PxIcon name="chevR" size={13} className="self-center text-text-muted" />
                    </div>
                    <div className="text-[10px] text-text-muted">{course.unlockText}</div>
                    <div className="text-[10px] text-text-muted">
                      Pays {course.masteryXp.toLocaleString()} Scholarship mastery XP on completion
                    </div>
                    {course.status === 'locked' &&
                      course.lockReasons.map((reason) => (
                        <div key={reason} className="text-[10px] font-bold text-text-muted">
                          {reason}
                        </div>
                      ))}
                    {course.status === 'available' && !course.canEnroll && !active && (
                      <div className="text-[10px] font-bold text-text-muted">
                        Requires {course.costNow.toLocaleString()} cr
                      </div>
                    )}
                  </button>
                  {course.status === 'completed' && (
                    <span
                      className="shrink-0 rounded px-2 py-1 text-[10px] font-black uppercase"
                      style={{ backgroundColor: `${faculty.color}22`, color: faculty.color }}
                    >
                      <span className="inline-flex items-center gap-1"><PxIcon name="check" size={13} /> Complete</span>
                    </span>
                  )}
                  {isActive && (
                    <span className="shrink-0 rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-text-primary">
                      In progress
                    </span>
                  )}
                  {course.canEnroll && (
                    <button
                      onClick={() => void enroll(course)}
                      disabled={busy !== null}
                      className="shrink-0 rounded px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40"
                      style={{ backgroundColor: faculty.color, color: '#14100A' }}
                    >
                      {busy === course.id ? '…' : `Enroll · ${course.costNow.toLocaleString()} cr`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {selectedCourse && (
        <div
          className="bl-card space-y-2 p-3"
          data-testid="research-course-detail"
          style={{
            borderLeftColor: researchFaculty(selectedCourse.faculty).color,
            borderLeftWidth: 5,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-text-primary">
                {selectedCourse.name}
              </div>
              <div className="text-[10px] font-bold uppercase text-text-muted">
                {researchFaculty(selectedCourse.faculty).name} · Tier {selectedCourse.tier}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCourseId(null)}
              aria-label="Close course details"
              className="shrink-0 rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-text-primary transition-transform active:scale-95"
            >
              Close
            </button>
          </div>
          <div className="text-[11px] text-text-secondary">{selectedCourse.unlockText}</div>
          <div className="space-y-1 text-[11px] text-text-muted">
            <div>
              Duration: {formatResearchDuration(selectedCourse.durationNowMs)}
              {selectedCourse.durationHours * 3_600_000 !== selectedCourse.durationNowMs && (
                <> (catalog {formatResearchDuration(selectedCourse.durationHours * 3_600_000)})</>
              )}
            </div>
            <div>
              Fee: {selectedCourse.costNow.toLocaleString()} cr — paid on enrollment, not refunded
              {selectedCourse.costCredits !== selectedCourse.costNow && (
                <> (catalog {selectedCourse.costCredits.toLocaleString()} cr)</>
              )}
            </div>
            <div>
              Pays {selectedCourse.masteryXp.toLocaleString()} Scholarship mastery XP on completion
              — no player XP.
            </div>
            {selectedCourse.requiresBench != null && (
              <div>Requires {researchBenchName(selectedCourse.requiresBench)}</div>
            )}
            {selectedCourse.prerequisite && (
              <div>
                Requires completing{' '}
                {researchCourse(selectedCourse.prerequisite)?.name ?? selectedCourse.prerequisite}{' '}
                first
              </div>
            )}
          </div>
          {selectedCourse.status === 'locked' && selectedCourse.lockReasons.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">
                Still needed
              </div>
              {selectedCourse.lockReasons.map((reason) => (
                <div key={reason} className="text-[11px] font-bold text-text-secondary">
                  {reason}
                </div>
              ))}
            </div>
          )}
          {selectedCourse.status === 'completed' && (
            <span
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase"
              style={{
                backgroundColor: `${researchFaculty(selectedCourse.faculty).color}22`,
                color: researchFaculty(selectedCourse.faculty).color,
              }}
            >
              <PxIcon name="check" size={13} /> Complete
            </span>
          )}
          {selectedCourse.status === 'enrolled' && (
            <div className="text-[11px] font-bold text-text-secondary">
              In progress — see the course card at the top of this panel for its clock.
            </div>
          )}
          {selectedCourse.canEnroll && (
            <button
              onClick={() => void enroll(selectedCourse)}
              disabled={busy !== null}
              className="rounded px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40"
              style={{
                backgroundColor: researchFaculty(selectedCourse.faculty).color,
                color: '#14100A',
              }}
            >
              {busy === selectedCourse.id
                ? '…'
                : `Enroll · ${selectedCourse.costNow.toLocaleString()} cr`}
            </button>
          )}
          {selectedCourse.status === 'available' && !selectedCourse.canEnroll && (
            <div className="text-[11px] font-bold text-text-muted">
              Requires {selectedCourse.costNow.toLocaleString()} cr — your balance is{' '}
              {state.credits.toLocaleString()} cr.
            </div>
          )}
        </div>
      )}

      {error && <div className="text-[11px] font-bold text-red">{error}</div>}
    </MobileCard>
  );
};
