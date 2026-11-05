/**
 * ResearchQuietPage — PROTOTYPE (design/hunter-subpages-research-e,
 * 2026-11-05). NOT shipped UI.
 *
 * Variant E — "Quiet plates". Research at rest: the same record
 * variant A built as a syllabus board ("The Syllabus Board" —
 * plates, a clock gauge, a curriculum map, chain rails, stamps) is
 * here typeset as an open ledger page. No shells, no bolts, no
 * gauges, no rails, no stamps: type is the hero and space does the
 * work. The enrolled course is one oversized name over a single
 * faculty-colored thread — the page's only color — and the catalog
 * is four quiet faculty sections whose courses rest as unboxed rows
 * between hairlines. Every word the shipped panel prints still
 * prints: unlock lines in full, lock reasons in full, the cancel
 * terms verbatim.
 *
 * Consumes the real ResearchStateView (src/content/research.ts);
 * the demo harness derives the fixture through researchStateView,
 * so every status, gate, shortfall, and price on screen is the
 * game's own derivation.
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  formatResearchDuration,
  formatResearchRemaining,
  researchCourse,
  researchFaculty,
  type ResearchCourseView,
  type ResearchStateView,
} from '@/content/research';

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
/** Secondary ink at body sizes (clears 4.5:1 on the page ground). */
const BONE_SOFT = '#B3A488';
/** Faint ink — short labels and state words only. */
const BONE_FAINT = '#9A8B72';
const HAIRLINE = 'rgba(245,239,230,0.09)';
const HAIRLINE_STRONG = 'rgba(245,239,230,0.22)';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
  fontWeight: 400,
};

const TIER_LABEL = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III' } as const;

/* ─── Standing ─────────────────────────────────────────────────────── */

const Standing: React.FC<{ state: ResearchStateView }> = ({ state }) => {
  const last = state.lastCompletion ? researchCourse(state.lastCompletion.courseId) : undefined;
  const pct = Math.round((state.completedCount / state.totalCourses) * 100);
  return (
    <div>
      <h1 className="leading-none" style={{ ...display, fontSize: 48, color: BONE }}>
        Research
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        The parallel education track: twelve courses, four faculties, one enrollment at a time. It runs beside
        everything else you do, and the unlock is the reward — no player XP.
      </p>

      <div className="mt-12 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 96, color: BONE }}>
          {state.completedCount}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          of {state.totalCourses} courses complete
        </span>
      </div>

      <div className="mt-4 text-[13px]" style={{ color: BONE_MUTED }}>
        {state.credits.toLocaleString()} cr balance
        {last && (
          <span style={{ color: BONE_FAINT }}> · Last completed {last.name}</span>
        )}
      </div>

      <div className="mt-10">
        <div className="h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
          <div
            className="h-full"
            style={{ width: `${(state.completedCount / state.totalCourses) * 100}%`, backgroundColor: BONE }}
          />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <span className="text-[12px]" style={{ color: BONE_SOFT }}>
            Settles on the server&rsquo;s clock — nothing to claim
          </span>
          <span className="text-[12px]" style={{ color: BONE_MUTED }}>
            {state.completedCount} of {state.totalCourses} · {pct}%
          </span>
        </div>
      </div>
    </div>
  );
};

/* ─── In session: the enrolled course, hero ────────────────────────── */

const InSession: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onCancel: () => void;
}> = ({ state, busy, onCancel }) => {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = state.activeEnrollment;
  if (!active) return null;
  const faculty = researchFaculty(active.faculty);
  const pct = Math.round(active.progressFraction * 100);
  const remaining = formatResearchRemaining(active.remainingMs).replace(' left', '');
  return (
    <div className="mt-16">
      <h2 className="leading-none" style={{ ...display, fontSize: 24, color: BONE }}>
        In session
      </h2>

      <div className="mt-7 leading-none" style={{ ...display, fontSize: 44, color: BONE }}>
        {active.courseName}
      </div>
      <div className="mt-2 text-[12px]" style={{ color: BONE_SOFT }}>
        {faculty.name} · {faculty.home}
      </div>

      <div className="mt-8 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 56, color: BONE }}>
          {remaining}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          Left
        </span>
      </div>

      <div className="mt-5 h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
        <div className="h-full" style={{ width: `${active.progressFraction * 100}%`, backgroundColor: faculty.color }} />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-[12px]" style={{ color: BONE_MUTED }}>
          {pct}% studied
        </span>
        <span className="text-[12px]" style={{ color: BONE_FAINT }}>
          Completes {new Date(active.completesAt).toLocaleString()}
        </span>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
        Fee paid {active.costCredits.toLocaleString()} cr — not refunded. Runs beside your current activity, never
        interrupts it.
      </p>

      <div className="mt-7">
        {confirmCancel ? (
          <div>
            <p className="text-[13px] leading-relaxed" style={{ color: BONE }}>
              {state.cancelTerms}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                data-testid="research-forfeit"
                onClick={onCancel}
                disabled={busy}
                className="min-h-[44px] flex-1 px-4 text-[12px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
                style={{ border: `1px solid ${BONE}`, color: BONE, backgroundColor: 'transparent' }}
              >
                {busy ? '…' : 'Forfeit course'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                className="min-h-[44px] flex-1 px-4 text-[12px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
                style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE_MUTED, backgroundColor: 'transparent' }}
              >
                Keep studying
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="research-cancel"
            onClick={() => setConfirmCancel(true)}
            className="min-h-[44px] px-5 text-[12px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60"
            style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE_SOFT, backgroundColor: 'transparent' }}
          >
            Cancel course
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Course rows ──────────────────────────────────────────────────── */

const EnrollButton: React.FC<{
  course: ResearchCourseView;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  testId: string;
}> = ({ course, busy, onEnroll, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={() => onEnroll(course)}
    disabled={busy}
    className="min-h-[44px] px-5 text-[13px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
    style={{ border: `1px solid ${BONE_MUTED}`, color: BONE, backgroundColor: 'transparent' }}
  >
    {busy ? '…' : `Enroll · ${course.costNow.toLocaleString()} cr`}
  </button>
);

const BriefRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
      {label}
    </div>
    <div className="mt-1 text-[13px] leading-relaxed" style={{ color: BONE_MUTED }}>
      {children}
    </div>
  </div>
);

const CourseRow: React.FC<{
  course: ResearchCourseView;
  state: ResearchStateView;
  selected: boolean;
  busy: boolean;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, state, selected, busy, onToggle, onEnroll }) => {
  const faculty = researchFaculty(course.faculty);
  const active = state.activeEnrollment;
  const isActive = active !== null && active.courseId === course.id;
  const nameColor = course.status === 'locked' ? BONE_FAINT : BONE;
  return (
    <div className="py-7" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
      <button
        type="button"
        onClick={() => onToggle(selected ? null : course.id)}
        aria-expanded={selected}
        data-testid={`research-course-${course.id}`}
        className="flex min-h-[44px] w-full items-baseline gap-3 text-left"
      >
        <span className="min-w-0 flex-1 leading-tight" style={{ ...display, fontSize: 25, color: nameColor }}>
          {course.name}
        </span>
        {course.status === 'completed' && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
            Complete
          </span>
        )}
        {course.status === 'enrolled' && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE }}>
            In session
          </span>
        )}
        <span
          className="shrink-0 self-center"
          style={{ color: BONE_FAINT, transform: selected ? 'rotate(90deg)' : undefined }}
        >
          <PxIcon name="chevR" size={13} />
        </span>
      </button>

      <div className="mt-2 text-[12px]" style={{ color: BONE_FAINT }}>
        {TIER_LABEL[course.tier]} · {formatResearchDuration(course.durationNowMs)} ·{' '}
        {course.costNow.toLocaleString()} cr · +{course.masteryXp.toLocaleString()} mastery XP
      </div>

      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        {course.unlockText}
      </p>

      {isActive && active && (
        <div className="mt-4">
          <div className="h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
            <div
              className="h-full"
              style={{ width: `${active.progressFraction * 100}%`, backgroundColor: faculty.color }}
            />
          </div>
          <div className="mt-2 text-[12px]" style={{ color: BONE_MUTED }}>
            {Math.round(active.progressFraction * 100)}% studied · {formatResearchRemaining(active.remainingMs)}
          </div>
        </div>
      )}

      {course.canEnroll && (
        <div className="mt-5 flex justify-end">
          <EnrollButton course={course} busy={busy} onEnroll={onEnroll} testId={`research-enroll-${course.id}`} />
        </div>
      )}

      {course.status === 'available' && !course.canEnroll && (
        <div className="mt-4 flex min-h-[44px] items-center gap-2 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
          <PxIcon name="coin" size={14} className="shrink-0" />
          <span>
            Requires {course.costNow.toLocaleString()} cr — your balance is {state.credits.toLocaleString()} cr.
          </span>
        </div>
      )}

      {course.status === 'locked' && (
        <div className="mt-3 space-y-1.5">
          {course.lockReasons.map((reason) => (
            <div key={reason} className="flex items-start gap-2 text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
              <PxIcon name="lock" size={13} className="mt-px shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-6 space-y-4 pt-6" style={{ borderTop: `1px solid ${HAIRLINE}` }} data-testid="research-course-detail">
          <BriefRow label="Duration">
            {formatResearchDuration(course.durationNowMs)}
            {course.durationHours * 3_600_000 !== course.durationNowMs && (
              <> (catalog {formatResearchDuration(course.durationHours * 3_600_000)})</>
            )}
          </BriefRow>
          <BriefRow label="Fee">
            {course.costNow.toLocaleString()} cr — paid on enrollment, not refunded
            {course.costCredits !== course.costNow && <> (catalog {course.costCredits.toLocaleString()} cr)</>}
          </BriefRow>
          <BriefRow label="Pays">
            {course.masteryXp.toLocaleString()} Scholarship mastery XP on completion — no player XP.
          </BriefRow>
          {course.prerequisite && (
            <BriefRow label="Requires">
              completing {researchCourse(course.prerequisite)?.name ?? course.prerequisite} first
            </BriefRow>
          )}
          {course.status === 'locked' && course.lockReasons.length > 0 && (
            <BriefRow label="Still needed">
              {course.lockReasons.map((reason) => (
                <div key={reason} style={{ color: BONE }}>
                  {reason}
                </div>
              ))}
            </BriefRow>
          )}
          {course.status === 'enrolled' && (
            <p className="text-[13px]" style={{ color: BONE }}>
              In session — the clock at the top of this page is this course&rsquo;s.
            </p>
          )}
          {course.canEnroll && (
            <div className="flex justify-end pt-1">
              <EnrollButton
                course={course}
                busy={busy}
                onEnroll={onEnroll}
                testId={`research-enroll-detail-${course.id}`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Faculty sections ─────────────────────────────────────────────── */

const FacultySection: React.FC<{
  facultyId: string;
  state: ResearchStateView;
  selectedCourseId: string | null;
  busy: boolean;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ facultyId, state, selectedCourseId, busy, onToggle, onEnroll }) => {
  const faculty = researchFaculty(facultyId);
  const courses = state.courses.filter((c) => c.faculty === facultyId);
  const done = courses.filter((c) => c.status === 'completed').length;
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="leading-none" style={{ ...display, fontSize: 26, color: BONE }}>
          {faculty.name}
        </h3>
        <span className="text-[12px]" style={{ color: BONE_FAINT }}>
          {done} of {courses.length}
        </span>
      </div>
      <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
        {faculty.home}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
        {faculty.blurb}
      </p>
      <div className="mt-3">
        {courses.map((course) => (
          <CourseRow
            key={course.id}
            course={course}
            state={state}
            selected={selectedCourseId === course.id}
            busy={busy}
            onToggle={onToggle}
            onEnroll={onEnroll}
          />
        ))}
      </div>
    </section>
  );
};

/* ─── The page ─────────────────────────────────────────────────────── */

export const ResearchQuietPage: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  onCancel: () => void;
}> = ({ state, busy, onEnroll, onCancel }) => {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  return (
    <div className="px-2 pt-4">
      <Standing state={state} />
      {state.activeEnrollment && <InSession state={state} busy={busy} onCancel={onCancel} />}
      {state.faculties.map((faculty) => (
        <FacultySection
          key={faculty.id}
          facultyId={faculty.id}
          state={state}
          selectedCourseId={selectedCourseId}
          busy={busy}
          onToggle={setSelectedCourseId}
          onEnroll={onEnroll}
        />
      ))}
      <p className="mt-16 pb-10 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
        Fees are destroyed on enrollment — the catalog is the game&rsquo;s largest structured credit sink at 310,000
        cr. Completions settle on the server&rsquo;s clock; there is nothing to claim and nothing to farm.
      </p>
    </div>
  );
};
