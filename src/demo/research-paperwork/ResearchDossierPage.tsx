/**
 * ResearchDossierPage — PROTOTYPE (design/hunter-subpages-research-d,
 * 2026-11-05). NOT shipped UI.
 *
 * Research reimagined as FIELD PAPERWORK — Variant D. Variant A built
 * a syllabus board of machined plates; this files the same curriculum
 * as a clerk's coursework record: a Form ED-12 cover with a ruled
 * standing ledger and a schedule index, the active enrollment as a
 * filed enrollment record (study progress inked into a checkbox
 * strip), and the catalog as four faculty SCHEDULES of ruled course
 * records — each carrying a tabular record number, its benefit as
 * filed, a prerequisite ENDORSEMENT stamp (on file / not filed), and
 * a verdict stamp. Cancellation is a withdrawal notice with the real
 * cancel terms verbatim.
 *
 * Consumes the real ResearchStateView (src/content/research.ts); the
 * demo harness derives fixtures through researchStateView, so every
 * status, gate, price, and lock reason on this page is the game's
 * own derivation — including the "another course is in progress"
 * lock and the exact shortfall arithmetic.
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
import { CheckStrip, DoubleRule, EndorseStamp, FormLine, InkStamp, PaperSheet, RecordNo } from './paperKit';
import {
  AMBER,
  clerkDate,
  clerkDay,
  DANGER_INK,
  displayStyle,
  INK,
  INK_FAINT,
  INK_MUTED,
  monoStyle,
  RULE,
  RULE_HARD,
  STAMP_RED,
} from './paperTokens';

const SCHEDULE_LETTER: Record<string, string> = {
  fabrication: 'A',
  field_mechanics: 'B',
  logistics_markets: 'C',
  xenotech: 'D',
};

const TIER_WORD = { 1: 'Tier I — Foundation', 2: 'Tier II — Practice', 3: 'Tier III — Certification' } as const;

const recordNo = (course: ResearchCourseView) => `${SCHEDULE_LETTER[course.faculty]}-${course.tier}`;

/* ─── The file cover: standing as a ruled ledger ─────────────────── */

const FileCover: React.FC<{ state: ResearchStateView }> = ({ state }) => {
  const last = state.lastCompletion ? researchCourse(state.lastCompletion.courseId) : undefined;
  const active = state.activeEnrollment;
  return (
    <PaperSheet>
      <div className="flex items-start justify-between gap-3">
        <div
          className="font-bold uppercase"
          style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.14em' }}
        >
          Frontier Skills Registry · Education Desk
        </div>
        <div
          className="shrink-0 font-bold uppercase"
          style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}
        >
          Form ED-12
        </div>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="uppercase leading-none" style={{ ...displayStyle, color: INK, fontSize: 34 }}>
            Record of Coursework
          </h1>
          <p className="mt-2 text-[12px] leading-snug" style={{ color: INK_MUTED }}>
            The parallel education track: twelve courses, four faculties, one enrollment at a time. The unlock is
            the reward — no player XP.
          </p>
        </div>
        {active ? (
          <InkStamp color={AMBER} rotate={-6}>
            In session
          </InkStamp>
        ) : (
          <InkStamp color={INK_MUTED} rotate={-6}>
            Track open
          </InkStamp>
        )}
      </div>

      <div className="mt-3 space-y-1.5" style={{ borderTop: `1px solid ${RULE}`, paddingTop: 10 }}>
        <FormLine label="Courses filed complete" value={`${state.completedCount} of ${state.totalCourses}`} />
        <FormLine label="Balance on account" value={`${state.credits.toLocaleString()} cr`} />
        {last && state.lastCompletion && (
          <FormLine label="Last completion filed" value={`${last.name} · ${clerkDay(state.lastCompletion.completedAt)}`} />
        )}
        <FormLine
          label="Enrollment standing"
          value={active ? `${active.courseName} — in session` : 'None — the track is open'}
          valueColor={active ? AMBER : INK}
        />
      </div>

      {/* The schedule index: the file's table of contents. */}
      <div className="mt-4">
        <div
          className="font-black uppercase"
          style={{ ...monoStyle, color: INK_MUTED, fontSize: 11, letterSpacing: '0.16em' }}
        >
          Index of schedules
        </div>
        <div className="mt-1.5" style={{ borderTop: `1px solid ${RULE}` }}>
          {state.faculties.map((faculty) => {
            const courses = state.courses.filter((c) => c.faculty === faculty.id);
            const done = courses.filter((c) => c.status === 'completed').length;
            const inSession = courses.some((c) => c.status === 'enrolled');
            const standing = done === courses.length ? 'Filed complete' : inSession ? 'In session' : 'Open';
            return (
              <div
                key={faculty.id}
                className="flex items-baseline gap-2 py-[5px]"
                style={{ borderBottom: `1px solid ${RULE}` }}
              >
                <span className="shrink-0 font-bold" style={{ ...monoStyle, color: faculty.color, fontSize: 12 }}>
                  {SCHEDULE_LETTER[faculty.id]}
                </span>
                <span className="shrink-0 text-[12px] font-bold uppercase tracking-wide" style={{ color: INK }}>
                  {faculty.name}
                </span>
                <span aria-hidden="true" className="min-w-[10px] flex-1" style={{ borderBottom: `1px dotted ${RULE_HARD}` }} />
                <span className="shrink-0 font-bold" style={{ ...monoStyle, color: INK_MUTED, fontSize: 11.5 }}>
                  {done} of {courses.length} filed
                </span>
                <span
                  className="w-[86px] shrink-0 text-right font-bold uppercase"
                  style={{ ...monoStyle, color: inSession ? AMBER : INK_FAINT, fontSize: 11 }}
                >
                  {standing}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </PaperSheet>
  );
};

/* ─── The enrollment record: the active course, as filed ─────────── */

const EnrollmentRecord: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onCancel: () => void;
  initialConfirmCancel?: boolean;
}> = ({ state, busy, onCancel, initialConfirmCancel = false }) => {
  const [confirmCancel, setConfirmCancel] = useState(initialConfirmCancel);
  const active = state.activeEnrollment;
  if (!active) return null;
  const faculty = researchFaculty(active.faculty);
  const course = researchCourse(active.courseId);
  const pct = Math.round(active.progressFraction * 100);
  return (
    <PaperSheet className="mt-3">
      <div className="flex items-start justify-between gap-3">
        <div
          className="font-black uppercase"
          style={{ ...monoStyle, color: faculty.color, fontSize: 11, letterSpacing: '0.16em' }}
        >
          Enrollment record — active
        </div>
        <RecordNo color={faculty.color}>{course ? `${SCHEDULE_LETTER[course.faculty]}-${course.tier}` : ''}</RecordNo>
      </div>

      <div className="mt-1.5 uppercase leading-tight" style={{ ...displayStyle, color: INK, fontSize: 27 }}>
        {active.courseName}
      </div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: faculty.color }}>
        {faculty.name} · {faculty.home}
      </div>

      <div className="mt-3 space-y-1.5" style={{ borderTop: `1px solid ${RULE}`, paddingTop: 10 }}>
        <FormLine label="Enrolled" value={clerkDate(active.enrolledAt)} />
        <FormLine label="Completes" value={clerkDate(active.completesAt)} />
        <FormLine label="Time remaining" value={formatResearchRemaining(active.remainingMs)} valueColor={AMBER} />
        <div className="flex items-baseline gap-2">
          <span
            className="shrink-0 font-bold uppercase"
            style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}
          >
            Fee paid
          </span>
          <span aria-hidden="true" className="min-w-[12px] flex-1" style={{ borderBottom: `1px dotted ${RULE_HARD}` }} />
          <span className="font-bold" style={{ ...monoStyle, color: INK, fontSize: 12.5 }}>
            {active.costCredits.toLocaleString()} cr
          </span>
          <EndorseStamp color={faculty.color}>Paid</EndorseStamp>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="font-black uppercase"
            style={{ ...monoStyle, color: INK_MUTED, fontSize: 11, letterSpacing: '0.12em' }}
          >
            Study filed
          </span>
          <span className="font-black" style={{ ...monoStyle, color: INK, fontSize: 12 }}>
            {pct}%
          </span>
        </div>
        <div className="mt-1.5">
          <CheckStrip fraction={active.progressFraction} color={faculty.color} />
        </div>
        <p className="mt-2 text-[11px] leading-snug" style={{ color: INK_FAINT }}>
          Filed by the clock, box by box. This enrollment runs on the education track — beside your current
          activity, never in its place.
        </p>
      </div>

      <div className="mt-3.5" style={{ borderTop: `1px solid ${RULE}`, paddingTop: 12 }}>
        {confirmCancel ? (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div
                className="font-black uppercase"
                style={{ ...monoStyle, color: STAMP_RED, fontSize: 12, letterSpacing: '0.16em' }}
              >
                Withdrawal notice
              </div>
              <InkStamp color={STAMP_RED} rotate={-6} fontSize={11}>
                Fee forfeit
              </InkStamp>
            </div>
            <p className="mt-2 text-[12px] font-semibold leading-snug" style={{ color: INK }}>
              {state.cancelTerms}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="research-forfeit"
                onClick={onCancel}
                disabled={busy}
                className="min-h-[48px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-[0.98] disabled:opacity-40"
                style={{ ...monoStyle, backgroundColor: DANGER_INK, border: '2px solid #000' }}
              >
                {busy ? '…' : 'File withdrawal — forfeit course'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                className="min-h-[48px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide transition-transform active:scale-[0.98] disabled:opacity-40"
                style={{ ...monoStyle, backgroundColor: 'transparent', color: INK, border: `1.5px solid ${RULE_HARD}` }}
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
            className="min-h-[48px] px-4 text-[12px] font-black uppercase tracking-wide transition-transform active:scale-[0.98]"
            style={{ ...monoStyle, backgroundColor: 'transparent', color: INK_MUTED, border: `1.5px solid ${RULE_HARD}` }}
          >
            Request withdrawal
          </button>
        )}
      </div>
    </PaperSheet>
  );
};

/* ─── Course records ─────────────────────────────────────────────── */

const DataCells: React.FC<{ course: ResearchCourseView }> = ({ course }) => (
  <div className="grid grid-cols-3 gap-3">
    {[
      { label: 'Duration', value: formatResearchDuration(course.durationNowMs) },
      { label: 'Fee', value: `${course.costNow.toLocaleString()} cr` },
      { label: 'Mastery', value: `+${course.masteryXp.toLocaleString()} XP` },
    ].map((cell) => (
      <div key={cell.label} className="min-w-0">
        <div className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
          {cell.label}
        </div>
        <div className="mt-0.5 whitespace-nowrap font-bold" style={{ ...monoStyle, color: INK, fontSize: 13 }}>
          {cell.value}
        </div>
      </div>
    ))}
  </div>
);

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
    className="min-h-[48px] w-full px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-[0.98] disabled:opacity-40"
    style={{ ...monoStyle, backgroundColor: AMBER, border: '2px solid #000' }}
  >
    {busy ? '…' : `File enrollment — ${course.costNow.toLocaleString()} cr`}
  </button>
);

const ClerkNotes: React.FC<{ lines: Array<{ icon: 'lock' | 'coin'; text: string }> }> = ({ lines }) => (
  <div className="space-y-1" style={{ border: `1px dashed ${RULE_HARD}`, padding: '8px 10px' }}>
    <div className="font-black uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.14em' }}>
      Clerk's note
    </div>
    {lines.map((line) => (
      <div key={line.text} className="flex items-start gap-2 text-[11.5px] font-semibold leading-snug" style={{ color: INK_MUTED }}>
        <PxIcon name={line.icon} size={13} className="mt-px shrink-0" />
        <span>{line.text}</span>
      </div>
    ))}
  </div>
);

/** The record sheet: the full brief, expanded in place. */
const RecordSheet: React.FC<{
  course: ResearchCourseView;
  state: ResearchStateView;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, state, busy, onEnroll }) => {
  const faculty = researchFaculty(course.faculty);
  const prereq = course.prerequisite ? researchCourse(course.prerequisite) : undefined;
  const prereqMet = prereq ? state.courses.find((c) => c.id === prereq.id)?.status === 'completed' : true;
  return (
    <div className="mt-3" style={{ border: `1.5px solid ${RULE_HARD}`, backgroundColor: 'rgba(0,0,0,0.28)' }} data-testid="research-course-detail">
      <div className="px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-black uppercase" style={{ ...monoStyle, color: faculty.color, fontSize: 11, letterSpacing: '0.14em' }}>
            Course record sheet
          </span>
          <span className="font-bold" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11 }}>
            Form ED-12/R · Record {recordNo(course)}
          </span>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <FormLine label="Course as filed" value={course.name} />
          <FormLine label="Schedule" value={`${SCHEDULE_LETTER[course.faculty]} — ${faculty.name} · ${faculty.home}`} />
          <FormLine label="Tier" value={TIER_WORD[course.tier]} />
          <FormLine
            label="Duration as filed"
            value={
              course.durationHours * 3_600_000 !== course.durationNowMs
                ? `${formatResearchDuration(course.durationNowMs)} (catalog ${formatResearchDuration(course.durationHours * 3_600_000)})`
                : formatResearchDuration(course.durationNowMs)
            }
          />
          <FormLine
            label="Fee as filed"
            value={
              course.costCredits !== course.costNow
                ? `${course.costNow.toLocaleString()} cr (catalog ${course.costCredits.toLocaleString()} cr)`
                : `${course.costNow.toLocaleString()} cr`
            }
          />
          <FormLine label="Fee terms" value="Paid on enrollment — not refunded" />
          <FormLine label="Pays on completion" value={`${course.masteryXp.toLocaleString()} Scholarship mastery XP`} />
          <FormLine label="Player XP" value="None — the unlock is the reward" />
        </div>

        <div className="mt-3">
          <div className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
            Benefit as filed
          </div>
          <p className="mt-1 text-[12px] leading-snug" style={{ color: INK }}>
            {course.unlockText}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
            Prerequisite endorsement
          </span>
          {prereq ? (
            <>
              <span className="text-[11.5px] font-semibold" style={{ color: INK_MUTED }}>
                {prereq.name}
              </span>
              <EndorseStamp color={prereqMet ? faculty.color : STAMP_RED}>{prereqMet ? 'On file' : 'Not filed'}</EndorseStamp>
            </>
          ) : (
            <span className="text-[11.5px] font-semibold" style={{ color: INK_MUTED }}>
              None required — open entry
            </span>
          )}
        </div>

        {course.status === 'locked' && course.lockReasons.length > 0 && (
          <div className="mt-3">
            <div className="font-bold uppercase" style={{ ...monoStyle, color: STAMP_RED, fontSize: 11, letterSpacing: '0.1em' }}>
              Still needed before this record can open
            </div>
            {course.lockReasons.map((reason) => (
              <div key={reason} className="mt-1 text-[12px] font-bold leading-snug" style={{ color: INK }}>
                {reason}
              </div>
            ))}
          </div>
        )}
        {course.status === 'enrolled' && (
          <p className="mt-3 text-[12px] font-bold leading-snug" style={{ color: AMBER }}>
            In session — the enrollment record at the head of this file carries its clock.
          </p>
        )}
        {course.canEnroll && (
          <div className="mt-3">
            <EnrollButton course={course} busy={busy} onEnroll={onEnroll} testId={`research-enroll-detail-${course.id}`} />
          </div>
        )}
      </div>
    </div>
  );
};

const CourseRecord: React.FC<{
  course: ResearchCourseView;
  state: ResearchStateView;
  selected: boolean;
  busy: boolean;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, state, selected, busy, onToggle, onEnroll }) => {
  const faculty = researchFaculty(course.faculty);
  const prereq = course.prerequisite ? researchCourse(course.prerequisite) : undefined;
  const prereqMet = prereq ? state.courses.find((c) => c.id === prereq.id)?.status === 'completed' : true;
  const active = state.activeEnrollment;
  const progress = active && active.courseId === course.id ? active.progressFraction : null;
  return (
    <div className="py-3" style={{ borderBottom: `1px solid ${RULE}` }}>
      <button
        type="button"
        onClick={() => onToggle(selected ? null : course.id)}
        aria-expanded={selected}
        data-testid={`research-course-${course.id}`}
        className="block min-h-[44px] w-full text-left"
      >
        <div className="flex items-start gap-2.5">
          <RecordNo color={faculty.color}>{recordNo(course)}</RecordNo>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-black leading-tight" style={{ color: INK }}>
              {course.name}
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: INK_FAINT }}>
              {TIER_WORD[course.tier]}
            </span>
          </span>
          {course.status === 'completed' && (
            <InkStamp color={faculty.color} rotate={-5} fontSize={11}>
              <PxIcon name="check" size={11} /> Complete
            </InkStamp>
          )}
          {course.status === 'enrolled' && (
            <InkStamp color={AMBER} rotate={-5} fontSize={11}>
              In session
            </InkStamp>
          )}
          <PxIcon name={selected ? 'chevD' : 'chevR'} size={14} className="mt-1 shrink-0" />
        </div>
      </button>

      <p className="mt-2 text-[12px] leading-snug" style={{ color: INK_MUTED }}>
        <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
          Benefit as filed —{' '}
        </span>
        {course.unlockText}
      </p>

      <div className="mt-2.5">
        <DataCells course={course} />
      </div>

      {/* The prerequisite endorsement line. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
          {prereq ? `Prereq — ${prereq.name}` : 'Prereq — none required'}
        </span>
        {prereq && (
          <EndorseStamp color={prereqMet ? faculty.color : STAMP_RED}>{prereqMet ? 'On file' : 'Not filed'}</EndorseStamp>
        )}
      </div>

      {progress !== null && (
        <div className="mt-2.5">
          <CheckStrip fraction={progress} color={faculty.color} />
        </div>
      )}

      <div className="mt-3">
        {course.canEnroll && (
          <EnrollButton course={course} busy={busy} onEnroll={onEnroll} testId={`research-enroll-${course.id}`} />
        )}
        {course.status === 'available' && !course.canEnroll && (
          <ClerkNotes
            lines={[
              {
                icon: 'coin',
                text: `Requires ${course.costNow.toLocaleString()} cr — your balance is ${state.credits.toLocaleString()} cr.`,
              },
            ]}
          />
        )}
        {course.status === 'locked' && (
          <ClerkNotes lines={course.lockReasons.map((reason) => ({ icon: 'lock' as const, text: reason }))} />
        )}
      </div>

      {selected && <RecordSheet course={course} state={state} busy={busy} onEnroll={onEnroll} />}
    </div>
  );
};

/* ─── Faculty schedules ──────────────────────────────────────────── */

const ScheduleSection: React.FC<{
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
    <section className="mt-5">
      <DoubleRule />
      <div className="mt-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-black" style={{ ...monoStyle, color: faculty.color, fontSize: 13 }}>
              {SCHEDULE_LETTER[facultyId]}
            </span>
            <h2 className="uppercase leading-none" style={{ ...displayStyle, color: INK, fontSize: 24 }}>
              Schedule {SCHEDULE_LETTER[facultyId]} — {faculty.name}
            </h2>
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: faculty.color }}>
            Filed at: {faculty.home}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug" style={{ color: INK_FAINT }}>
            {faculty.blurb}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-black" style={{ ...monoStyle, color: INK, fontSize: 17 }}>
            {done} / 3
          </div>
          <div className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
            Filed
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${RULE}` }}>
        {courses.map((course) => (
          <CourseRecord
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

/* ─── The page ───────────────────────────────────────────────────── */

export const ResearchDossierPage: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  onCancel: () => void;
  initialSelectedId?: string | null;
  initialConfirmCancel?: boolean;
}> = ({ state, busy, onEnroll, onCancel, initialSelectedId = null, initialConfirmCancel = false }) => {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  return (
    <div>
      <FileCover state={state} />
      <EnrollmentRecord state={state} busy={busy} onCancel={onCancel} initialConfirmCancel={initialConfirmCancel} />
      {state.faculties.map((faculty) => (
        <ScheduleSection
          key={faculty.id}
          facultyId={faculty.id}
          state={state}
          selectedCourseId={selectedId}
          busy={busy}
          onToggle={setSelectedId}
          onEnroll={onEnroll}
        />
      ))}
      <div className="mt-6 pb-2 text-center">
        <DoubleRule className="mx-auto w-24" />
        <div
          className="mt-2 font-bold uppercase"
          style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.18em' }}
        >
          — End of file · Fees destroyed at filing · Completions pay Scholarship mastery XP only —
        </div>
      </div>
    </div>
  );
};
