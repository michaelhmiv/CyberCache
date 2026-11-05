import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  cancelResearch,
  enrollResearch,
  getResearchState,
  newResearchCancelNonce,
  newResearchEnrollNonce,
} from '@/lib/chef/chefClient';
import {
  RESEARCH_CATALOG_TOTALS,
  formatResearchDuration,
  researchCourse,
  researchFaculty,
  type ResearchBonuses,
  type ResearchCourseView,
  type ResearchStateView,
} from '@/content/research';
import { Lamp, Module, Readout, SegBar, TapeBar } from './ResearchConsoleKit';
import {
  AMBER,
  DANGER,
  HAIRLINE,
  INK,
  INK_FAINT,
  INK_MUTED,
  MONO,
  PANEL,
  PANEL_RAISED,
  fmtClock,
  fmtClockCeil,
  fmtZulu,
  titleStyle,
  type SegCell,
} from './researchConsoleTheme';

/**
 * Research panel (Profile) — the parallel education track (0038),
 * wearing the Instrument Panel register (owner pick B, 2026-11-05):
 * the curriculum as a machine being measured. A console header reads
 * the track's vital signs (credits, courses logged, last log,
 * catalog percentage) over a segmented catalog meter; live output
 * readouts print what the completions currently pay; the enrolled
 * course is a session instrument with a tape meter and Zulu
 * readouts; the four faculties are numbered channel modules whose
 * courses ride a bus line through their status lamps, and tapping a
 * row opens its spec sheet.
 *
 * Research is a commitment, not an action: enrolling never touches
 * the hunter's current activity, and the course clock runs on the
 * server's wall clock beside whatever the hunter is doing. This
 * panel only renders the Chef's state view and sends intent (a
 * nonce + a course id); fees, durations, gates, and completions
 * are the server's records. It renders nothing until the Chef
 * answers, so an unreachable Chef simply omits the panel.
 *
 * Phone rules (unchanged): costs, durations, and remaining times
 * are never ellipsized; lock reasons print in full; a failed
 * enroll/cancel surfaces its server reason in place. Course detail
 * (QC A7): every course row opens its spec sheet — gates,
 * lever-applied fee/duration, unlock, and the same enroll
 * affordance the row carries. Viewing is never gated (guests see
 * the whole catalog with real data); enrolling keeps exactly the
 * server view's canEnroll gating it has always had.
 */

const CHANNEL = (index: number) => `CH-0${index + 1}`;

/* ─── Live outputs: what the completions currently pay ───────────── */

const BONUS_READOUTS: Array<{
  key: keyof ResearchBonuses;
  label: string;
  format: (v: number) => string;
}> = [
  { key: 'craftQualityShift', label: 'CRAFT QUALITY', format: (v) => `+${v}` },
  { key: 'gearTemperBonus', label: 'GEAR TEMPER', format: (v) => `+${v.toFixed(2)}` },
  { key: 'gearDrawBonus', label: 'GEAR DRAWS', format: (v) => `+${v}` },
  { key: 'repairWorkRateBonus', label: 'REPAIR RATE', format: (v) => `×${(1 + v).toFixed(2)}` },
  { key: 'vehicleDecayReduction', label: 'VEHICLE DECAY', format: (v) => `-${Math.round(v * 100)}%` },
  { key: 'repairServiceXpBonus', label: 'REPAIR XP', format: (v) => `+${v}/PT` },
  { key: 'vendorBuybackBonus', label: 'BUYBACK', format: (v) => `+${v.toFixed(2)}` },
  { key: 'offlineCapBonus', label: 'OFFLINE CAP', format: (v) => `+${v}H` },
  { key: 'marketFeeReduction', label: 'MARKET FEE', format: (v) => `-${v.toFixed(2)}` },
  { key: 'weaponDamage', label: 'WEAPON DMG', format: (v) => `+${Math.round(v * 100)}%` },
  { key: 'shieldCapacity', label: 'SHIELD CAP', format: (v) => `+${Math.round(v * 100)}%` },
  { key: 'bossDedicatedChanceBonus', label: 'BOSS DROP', format: (v) => `+${v.toFixed(2)}` },
];

/* ─── The console header: vital signs + the catalog meter ────────── */

const courseCells = (course: ResearchCourseView, state: ResearchStateView): SegCell[] => {
  const color = researchFaculty(course.faculty).color;
  if (course.status === 'completed') return Array.from({ length: 5 }, () => ({ color }));
  if (course.status === 'enrolled') {
    const filled = Math.round((state.activeEnrollment?.progressFraction ?? 0) * 5);
    return Array.from({ length: 5 }, (_, i) => ({ color: i < filled ? AMBER : null }));
  }
  if (course.status === 'available') return Array.from({ length: 5 }, () => ({ color: null, hollow: true }));
  return Array.from({ length: 5 }, () => ({ color: null }));
};

const ClusterHeader: React.FC<{ state: ResearchStateView }> = ({ state }) => {
  const inSession = state.activeEnrollment !== null;
  const pct = Math.round((state.completedCount / state.totalCourses) * 100);
  const last = state.lastCompletion ? researchCourse(state.lastCompletion.courseId) : undefined;
  const outputs = BONUS_READOUTS.filter((r) => state.bonuses[r.key] !== 0);
  const cells = state.courses.flatMap((course) => courseCells(course, state));
  return (
    <Module>
      <div className="flex items-start justify-between gap-3">
        <div
          className="text-[32px] uppercase leading-none"
          style={{ ...titleStyle, color: INK }}
        >
          Research
        </div>
        <div className="flex items-center gap-2 pt-1.5">
          <Lamp color={AMBER} lit={inSession} />
          <span className="text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: inSession ? AMBER : INK_FAINT }}>
            {inSession ? 'IN SESSION' : 'TRACK OPEN'}
          </span>
        </div>
      </div>
      <div className="mt-2 text-[11px] font-semibold tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
        PARALLEL EDUCATION TRACK · {state.totalCourses} COURSES · {state.faculties.length} FACULTIES · ONE ENROLLMENT AT A TIME
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 pt-3"
        style={{ borderTop: `1px solid ${HAIRLINE}` }}
      >
        <Readout label="Credits" value={`${state.credits.toLocaleString()} CR`} />
        <Readout label="Courses logged" value={`${state.completedCount}/${state.totalCourses}`} />
        <Readout label="Last log" value={last ? last.name.toUpperCase() : '—'} valueSize={13} />
        <Readout label="Catalog complete" value={`${pct}%`} />
      </div>

      <div className="mt-3">
        <SegBar cells={cells} height={11} />
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {state.faculties.map((faculty, i) => (
            <span key={faculty.id} className="flex items-center gap-1.5">
              <Lamp color={faculty.color} lit size={7} />
              <span className="text-[11px] font-bold tracking-[0.1em]" style={{ ...MONO, color: INK_FAINT }}>
                {CHANNEL(i)} {faculty.name.toUpperCase()}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: INK_FAINT }}>
          Live outputs — from completions
        </div>
        {outputs.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {outputs.map((r) => (
              <span key={r.key} className="text-[12px]" style={MONO}>
                <span style={{ color: INK_FAINT }}>{r.label} </span>
                <span className="font-bold" style={{ color: INK }}>
                  {r.format(state.bonuses[r.key])}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-1.5 text-[12px]" style={{ ...MONO, color: INK_FAINT }}>
            NO OUTPUTS — NO COMPLETIONS LOGGED
          </div>
        )}
        <div className="mt-2 text-[11px] font-semibold tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
          PAYOUT: UNLOCKS + SCHOLARSHIP MASTERY — NO PLAYER XP
        </div>
      </div>
    </Module>
  );
};

/* ─── The session instrument: the enrolled course, live ──────────── */

const SessionModule: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  cancelBusy: boolean;
  onCancel: () => void;
}> = ({ state, busy, cancelBusy, onCancel }) => {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = state.activeEnrollment;
  if (!active) return null;
  const faculty = researchFaculty(active.faculty);
  const channelIndex = state.faculties.findIndex((f) => f.id === active.faculty);
  const pct = Math.round(active.progressFraction * 100);
  const elapsedMs = active.durationMs - active.remainingMs;
  return (
    <Module
      header={
        <>
          <Lamp color={AMBER} lit />
          <span className="text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: AMBER }}>
            {CHANNEL(channelIndex)} · IN SESSION
          </span>
          <span className="flex-1" />
          <span className="text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: faculty.color }}>
            {faculty.name.toUpperCase()}
          </span>
        </>
      }
    >
      <div className="text-[27px] uppercase leading-none" style={{ ...titleStyle, color: INK }}>
        {active.courseName}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold leading-snug tracking-[0.06em]" style={{ ...MONO, color: INK_FAINT }}>
        {faculty.home.toUpperCase()} · PARALLEL TRACK — RUNS BESIDE YOUR ACTIVITY, NEVER INTERRUPTS IT
      </div>

      <div className="mt-3">
        <TapeBar fraction={active.progressFraction} color={faculty.color} />
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] font-bold tracking-[0.08em]" style={MONO}>
          <span style={{ color: INK_FAINT }}>ELAPSED {fmtClock(elapsedMs)}</span>
          <span style={{ color: INK }}>{pct}% STUDIED</span>
          <span style={{ color: INK_FAINT }}>REMAINING {fmtClockCeil(active.remainingMs)}</span>
        </div>
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-x-3 pt-3"
        style={{ borderTop: `1px solid ${HAIRLINE}` }}
      >
        <Readout label="Completes" value={fmtZulu(active.completesAt)} valueSize={12} />
        <Readout label="Fee paid" value={`${active.costCredits.toLocaleString()} CR`} valueSize={13} />
        <Readout label="Duration" value={fmtClock(active.durationMs)} valueSize={13} />
      </div>
      <div className="mt-2 text-[11px] font-semibold tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
        FEE DESTROYED AT ENROLL · NOT REFUNDED
      </div>

      <div className="mt-3">
        {confirmCancel ? (
          <div className="p-2.5" style={{ border: `1px solid ${DANGER}`, backgroundColor: 'rgba(255,75,92,0.06)' }}>
            <div className="text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: DANGER }}>
              FORFEIT WARNING
            </div>
            <div className="mt-1.5 text-[12px] font-semibold leading-snug" style={{ color: INK }}>
              {state.cancelTerms}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                data-testid="research-forfeit"
                onClick={onCancel}
                disabled={busy}
                className="min-h-[44px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: DANGER, border: '2px solid #000' }}
              >
                {cancelBusy ? '…' : 'Forfeit course'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                className="min-h-[44px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: 'transparent', color: INK, border: `1px solid ${HAIRLINE}` }}
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
            className="min-h-[44px] px-4 text-[12px] font-black uppercase tracking-wide transition-transform active:scale-95"
            style={{ backgroundColor: 'transparent', color: INK_MUTED, border: `1px solid ${HAIRLINE}` }}
          >
            Cancel course
          </button>
        )}
      </div>
    </Module>
  );
};

/* ─── Course telemetry rows ──────────────────────────────────────── */

const STATUS_WORD: Record<ResearchCourseView['status'], string> = {
  completed: 'COMPLETE',
  enrolled: 'IN SESSION',
  available: 'OPEN',
  locked: 'LOCKED',
};

const statusColor = (course: ResearchCourseView, facultyColor: string): string =>
  course.status === 'completed'
    ? facultyColor
    : course.status === 'enrolled'
      ? AMBER
      : course.status === 'available'
        ? INK_MUTED
        : INK_FAINT;

const EnrollButton: React.FC<{
  course: ResearchCourseView;
  disabled: boolean;
  busyLabel: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  testId: string;
}> = ({ course, disabled, busyLabel, onEnroll, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={() => onEnroll(course)}
    disabled={disabled}
    className="min-h-[44px] w-full px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-[0.98] disabled:opacity-40"
    style={{ backgroundColor: AMBER, border: '2px solid #000', ...MONO }}
  >
    {busyLabel ? '…' : `Enroll · ${course.costNow.toLocaleString()} cr`}
  </button>
);

const SpecSheet: React.FC<{
  course: ResearchCourseView;
  state: ResearchStateView;
  busyId: string | null;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, state, busyId, onEnroll }) => {
  const faculty = researchFaculty(course.faculty);
  const prereq = course.prerequisite ? researchCourse(course.prerequisite) : undefined;
  return (
    <div
      className="mt-2.5 p-2.5"
      style={{ backgroundColor: PANEL_RAISED, border: `1px solid ${HAIRLINE}` }}
      data-testid="research-course-detail"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[20px] uppercase leading-none" style={{ ...titleStyle, color: INK }}>
            {course.name}
          </div>
          <div className="mt-1.5 text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: INK_FAINT }}>
            SPEC SHEET · {course.id.toUpperCase()} · {faculty.name.toUpperCase()} · TIER {course.tier}
          </div>
        </div>
        <span
          className="shrink-0 pt-0.5 text-[11px] font-bold tracking-[0.1em]"
          style={{ ...MONO, color: statusColor(course, faculty.color) }}
        >
          {STATUS_WORD[course.status]}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Readout
          label="Duration"
          value={formatResearchDuration(course.durationNowMs).toUpperCase()}
          valueSize={14}
        />
        <Readout label="Fee" value={`${course.costNow.toLocaleString()} CR`} valueSize={14} />
        <Readout label="Pays" value={`+${course.masteryXp.toLocaleString()} XP`} valueSize={14} />
        <Readout label="Prereq" value={prereq ? prereq.name.toUpperCase() : '— NONE'} valueSize={12} />
      </div>
      <div className="mt-2 text-[12px] leading-snug" style={{ color: INK_MUTED }}>
        {course.unlockText}
      </div>
      {(course.durationHours * 3_600_000 !== course.durationNowMs || course.costCredits !== course.costNow) && (
        <div className="mt-2 text-[11px] font-semibold leading-snug tracking-[0.06em]" style={{ ...MONO, color: INK_FAINT }}>
          CATALOG {formatResearchDuration(course.durationHours * 3_600_000).toUpperCase()} ·{' '}
          {course.costCredits.toLocaleString()} CR — LEVER-APPLIED VALUES ABOVE GOVERN
        </div>
      )}
      <div className="mt-2 text-[11px] font-semibold leading-snug tracking-[0.06em]" style={{ ...MONO, color: INK_FAINT }}>
        FEE PAID ON ENROLLMENT, NOT REFUNDED · MASTERY IS SCHOLARSHIP — NO PLAYER XP
      </div>
      {course.status === 'locked' && course.lockReasons.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: DANGER }}>
            Still needed
          </div>
          {course.lockReasons.map((reason) => (
            <div key={reason} className="mt-1 text-[12px] font-bold leading-snug" style={{ color: INK }}>
              {reason}
            </div>
          ))}
        </div>
      )}
      {course.status === 'enrolled' && (
        <div className="mt-2.5 text-[11px] font-bold leading-snug tracking-[0.06em]" style={{ ...MONO, color: AMBER }}>
          IN SESSION — LIVE TELEMETRY IN THE SESSION MODULE ABOVE
        </div>
      )}
      {course.status === 'available' && !course.canEnroll && (
        <div className="mt-2.5 text-[12px] font-bold leading-snug" style={{ color: INK }}>
          Requires {course.costNow.toLocaleString()} cr — your balance is{' '}
          {state.credits.toLocaleString()} cr.
        </div>
      )}
      {course.canEnroll && (
        <div className="mt-2.5">
          <EnrollButton
            course={course}
            disabled={busyId !== null}
            busyLabel={busyId === course.id}
            onEnroll={onEnroll}
            testId={`research-enroll-detail-${course.id}`}
          />
        </div>
      )}
    </div>
  );
};

const CourseRow: React.FC<{
  course: ResearchCourseView;
  facultyColor: string;
  state: ResearchStateView;
  selected: boolean;
  busyId: string | null;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, facultyColor, state, selected, busyId, onToggle, onEnroll }) => {
  const active = state.activeEnrollment;
  const isEnrolled = course.status === 'enrolled' && active !== null;
  const shortfall =
    course.status === 'available' && !course.canEnroll && state.activeEnrollment === null
      ? course.costNow - state.credits
      : null;
  return (
    <div className="relative py-2.5 pl-6">
      {/* The lamp sits on the channel bus. */}
      <span className="absolute left-0 top-[19px] z-10">
        {course.status === 'available' ? (
          <span
            aria-hidden="true"
            className="block h-[10px] w-[10px]"
            style={{ boxShadow: `inset 0 0 0 2px ${INK_FAINT}`, backgroundColor: PANEL }}
          />
        ) : (
          <Lamp
            color={course.status === 'enrolled' ? AMBER : facultyColor}
            lit={course.status === 'completed' || course.status === 'enrolled'}
          />
        )}
      </span>

      <button
        type="button"
        onClick={() => onToggle(selected ? null : course.id)}
        aria-expanded={selected}
        aria-label={`${course.name} course details`}
        data-testid={`research-course-${course.id}`}
        className="block min-h-[44px] w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 px-1.5 py-0.5 text-[11px] font-bold leading-none"
            style={{ ...MONO, border: `1px solid ${HAIRLINE}`, color: INK_MUTED }}
          >
            T{course.tier}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight" style={{ color: INK }}>
            {course.name}
          </span>
          <span className="shrink-0 text-[11px] font-bold tracking-[0.1em]" style={{ ...MONO, color: statusColor(course, facultyColor) }}>
            {STATUS_WORD[course.status]}
          </span>
          <PxIcon name="chevR" size={13} className="shrink-0" />
        </div>
        <div className="mt-1 text-[11px] font-semibold tracking-[0.06em]" style={{ ...MONO, color: INK_FAINT }}>
          DUR {formatResearchDuration(course.durationNowMs).toUpperCase()} · FEE {course.costNow.toLocaleString()} CR ·
          PAYS +{course.masteryXp.toLocaleString()} XP
        </div>
      </button>

      <div className="mt-1.5 text-[12px] leading-snug" style={{ color: INK_MUTED }}>
        {course.unlockText}
      </div>

      {isEnrolled && active && (
        <div className="mt-2">
          <TapeBar total={24} fraction={active.progressFraction} color={facultyColor} height={13} />
          <div className="mt-1 text-[11px] font-bold tracking-[0.08em]" style={MONO}>
            <span style={{ color: INK }}>{Math.round(active.progressFraction * 100)}% STUDIED</span>
            <span style={{ color: INK_FAINT }}> · {fmtClockCeil(active.remainingMs)} LEFT</span>
          </div>
        </div>
      )}

      {course.status === 'locked' && (
        <div className="mt-1.5 space-y-1">
          {course.lockReasons.map((reason) => (
            <div key={reason} className="flex items-start gap-2 text-[12px] font-semibold leading-snug" style={{ color: INK_FAINT }}>
              <PxIcon name="lock" size={13} className="mt-px shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}

      {shortfall !== null && (
        <div className="mt-1.5 text-[11px] font-bold tracking-[0.06em]" style={MONO}>
          <span style={{ color: INK_FAINT }}>REQ {course.costNow.toLocaleString()} CR · BAL {state.credits.toLocaleString()} CR · </span>
          <span style={{ color: DANGER }}>SHORT {shortfall.toLocaleString()} CR</span>
        </div>
      )}

      {course.canEnroll && (
        <div className="mt-2">
          <EnrollButton
            course={course}
            disabled={busyId !== null}
            busyLabel={busyId === course.id}
            onEnroll={onEnroll}
            testId={`research-enroll-${course.id}`}
          />
        </div>
      )}

      {selected && <SpecSheet course={course} state={state} busyId={busyId} onEnroll={onEnroll} />}
    </div>
  );
};

/* ─── Faculty channel modules ────────────────────────────────────── */

const FacultyModule: React.FC<{
  facultyId: string;
  channelIndex: number;
  state: ResearchStateView;
  selectedCourseId: string | null;
  busyId: string | null;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ facultyId, channelIndex, state, selectedCourseId, busyId, onToggle, onEnroll }) => {
  const faculty = researchFaculty(facultyId);
  const courses = state.courses.filter((c) => c.faculty === facultyId);
  const done = courses.filter((c) => c.status === 'completed').length;
  const anySignal = courses.some((c) => c.status === 'completed' || c.status === 'enrolled');
  const sunk = courses.reduce(
    (sum, c) =>
      sum +
      (c.status === 'completed'
        ? c.costNow
        : c.status === 'enrolled'
          ? (state.activeEnrollment?.costCredits ?? 0)
          : 0),
    0,
  );
  const cells = courses.flatMap((course) => courseCells(course, state));
  return (
    <Module
      header={
        <>
          <Lamp color={faculty.color} lit={anySignal} />
          <span className="shrink-0 whitespace-nowrap text-[11px] font-bold tracking-[0.14em]" style={{ ...MONO, color: faculty.color }}>
            {CHANNEL(channelIndex)}
          </span>
          <span className="text-[19px] uppercase leading-none" style={{ ...titleStyle, color: INK }}>
            {faculty.name}
          </span>
          <span className="flex-1" />
          <span className="shrink-0 whitespace-nowrap text-right text-[11px] font-bold leading-tight tracking-[0.08em]" style={MONO}>
            <span style={{ color: INK }}>LOGGED {done}/3</span>
            <br />
            <span style={{ color: INK_FAINT }}>SUNK {sunk.toLocaleString()} CR</span>
          </span>
        </>
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
          HOME: {faculty.home.toUpperCase()}
        </span>
        <span className="text-[11px] font-semibold tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
          Σ FEE {courses.reduce((s, c) => s + c.costNow, 0).toLocaleString()} CR
        </span>
      </div>
      <div className="mt-1 text-[12px] leading-snug" style={{ color: INK_MUTED }}>
        {faculty.blurb}
      </div>
      <div className="mt-2.5">
        <SegBar cells={cells} height={8} />
      </div>

      {/* The bus: one line through every lamp in the channel. */}
      <div className="relative mt-1">
        <div
          aria-hidden="true"
          className="absolute bottom-4 left-[4px] top-4 w-[2px]"
          style={{ backgroundColor: 'rgba(139,149,163,0.28)' }}
        />
        <div>
          {courses.map((course, i) => (
            <div key={course.id} style={i > 0 ? { borderTop: `1px solid ${HAIRLINE}` } : undefined}>
              <CourseRow
                course={course}
                facultyColor={faculty.color}
                state={state}
                selected={selectedCourseId === course.id}
                busyId={busyId}
                onToggle={onToggle}
                onEnroll={onEnroll}
              />
            </div>
          ))}
        </div>
      </div>
    </Module>
  );
};

/* ─── The panel ──────────────────────────────────────────────────── */

export const ResearchPanel: React.FC = () => {
  const [state, setState] = useState<ResearchStateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Course detail (QC A7): every course row opens its spec sheet —
  // gates, lever-applied fee/duration, unlock, and the same enroll
  // affordance the row carries.
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
      if (result.research) setState(result.research);
      else await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setBusy(null);
    }
  }, [busy, refresh]);

  if (!state) return null;

  return (
    <div className="space-y-3">
      <ClusterHeader state={state} />
      {state.activeEnrollment && (
        <SessionModule
          state={state}
          busy={busy !== null}
          cancelBusy={busy === 'cancel'}
          onCancel={() => void cancel()}
        />
      )}
      {state.faculties.map((faculty, i) => (
        <FacultyModule
          key={faculty.id}
          facultyId={faculty.id}
          channelIndex={i}
          state={state}
          selectedCourseId={selectedCourseId}
          busyId={busy}
          onToggle={setSelectedCourseId}
          onEnroll={(course) => void enroll(course)}
        />
      ))}
      {error && (
        <div className="px-1 text-[12px] font-bold leading-snug" style={{ ...MONO, color: DANGER }}>
          {error}
        </div>
      )}
      <div className="px-1 pb-1 text-[11px] font-semibold leading-relaxed tracking-[0.08em]" style={{ ...MONO, color: INK_FAINT }}>
        FEES DESTROYED ON ENROLL · CATALOG SINK {RESEARCH_CATALOG_TOTALS.totalCostCredits.toLocaleString()} CR ·
        COMPLETIONS SETTLE ON THE SERVER CLOCK — NOTHING TO CLAIM, NOTHING TO FARM
      </div>
    </div>
  );
};
