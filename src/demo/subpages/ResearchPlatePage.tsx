/**
 * ResearchPlatePage — PROTOTYPE (design/hunter-subpages-rank-research,
 * 2026-11-05). NOT shipped UI.
 *
 * Research reimagined inside the Arena Plates family as a SYLLABUS
 * BOARD: the enrolled course is a session plate with a clock gauge;
 * the catalog is a curriculum — four faculty sections whose courses
 * hang on a prerequisite chain rail (node per course: struck when
 * complete, amber while in session, hollow while locked). Text is
 * first-class here — unlock lines, fees, and lock reasons print in
 * full, never ellipsized — where Cache Rank is numerals and pips.
 *
 * Consumes the real ResearchStateView (src/content/research.ts);
 * the demo harness derives fixtures through researchStateView, so
 * every status, gate, and price on this page is the game's own
 * derivation, including "another course is in progress" locks.
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
import {
  AMBER,
  BONE,
  BONE_FAINT,
  BONE_MUTED,
  DANGER,
  GaugeWell,
  Plate,
  plateTitleStyle,
  SegmentLadder,
  Stamp,
  STEEL,
  WELL_EMPTY,
} from './plateKit';

/** Short map labels: the full faculty name prints on its header
 * plate below, so the curriculum map uses deliberate short forms
 * instead of truncating mid-word. */
const MAP_LABEL: Record<string, string> = {
  fabrication: 'Fabrication',
  field_mechanics: 'Field Mech.',
  logistics_markets: 'Logistics',
  xenotech: 'Xenotech',
};

const TIER_LABEL = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III' } as const;

/* ─── The session plate: the enrolled course, hero ───────────────── */

const InSessionPlate: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onCancel: () => void;
}> = ({ state, busy, onCancel }) => {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = state.activeEnrollment;
  if (!active) return null;
  const faculty = researchFaculty(active.faculty);
  const pct = Math.round(active.progressFraction * 100);
  return (
    <Plate footColor={faculty.color}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[27px] uppercase leading-none" style={{ ...plateTitleStyle, color: BONE }}>
            {active.courseName}
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: faculty.color }}>
            {faculty.name} · {faculty.home}
          </div>
          <div className="mt-1 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
            In session — runs beside your current activity, never interrupts it.
          </div>
        </div>
        <GaugeWell
          value={formatResearchRemaining(active.remainingMs).replace(' left', '')}
          label="Left"
          color={BONE}
          valueSize={19}
        />
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_MUTED }}>
            Course clock
          </span>
          <span className="text-[11px] font-black" style={{ color: BONE }}>
            {pct}% studied
          </span>
        </div>
        <div className="mt-1.5">
          <SegmentLadder filled={Math.round(active.progressFraction * 20)} total={20} color={faculty.color} height={11} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
          <span>Completes {new Date(active.completesAt).toLocaleString()}</span>
          <span>Fee paid {active.costCredits.toLocaleString()} cr · not refunded</span>
        </div>
      </div>

      <div className="mt-3">
        {confirmCancel ? (
          <div className="space-y-2">
            <div className="text-[11px] font-bold leading-snug" style={{ color: DANGER }}>
              {state.cancelTerms}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="research-forfeit"
                onClick={onCancel}
                disabled={busy}
                className="min-h-[44px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: '#FF4B5C', border: '2px solid #000', boxShadow: '3px 3px 0 rgba(0,0,0,0.7)' }}
              >
                {busy ? '…' : 'Forfeit course'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                className="min-h-[44px] flex-1 px-3 text-[12px] font-black uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40"
                style={{ backgroundColor: 'rgba(6,5,4,0.7)', color: BONE, border: `2px solid ${STEEL}` }}
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
            style={{ backgroundColor: 'rgba(6,5,4,0.7)', color: BONE_MUTED, border: `2px solid ${STEEL}` }}
          >
            Cancel course
          </button>
        )}
      </div>
    </Plate>
  );
};

/* ─── Standing: counts, balance, the curriculum map ──────────────── */

const CurriculumMap: React.FC<{ state: ResearchStateView }> = ({ state }) => (
  <div className="flex gap-3">
    {state.faculties.map((faculty) => (
      <div key={faculty.id} className="min-w-0 flex-1">
        <div className="flex gap-1">
          {faculty.courseIds.map((id) => {
            const course = state.courses.find((c) => c.id === id);
            const status = course?.status ?? 'locked';
            return (
              <span
                key={id}
                className="h-[13px] flex-1"
                title={`${course?.name ?? id} — ${status}`}
                style={{
                  border: '2px solid #000',
                  backgroundColor:
                    status === 'completed'
                      ? faculty.color
                      : status === 'enrolled'
                        ? AMBER
                        : status === 'available'
                          ? 'transparent'
                          : WELL_EMPTY,
                  boxShadow: status === 'available' ? `inset 0 0 0 1px ${BONE_FAINT}` : 'inset 0 0 0 1px rgba(0,0,0,0.4)',
                }}
              />
            );
          })}
        </div>
        <div className="mt-1 whitespace-nowrap text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
          {MAP_LABEL[faculty.id] ?? faculty.name}
        </div>
      </div>
    ))}
  </div>
);

const StandingPlate: React.FC<{ state: ResearchStateView }> = ({ state }) => {
  const last = state.lastCompletion ? researchCourse(state.lastCompletion.courseId) : undefined;
  return (
    <Plate footColor={STEEL}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[30px] uppercase leading-none" style={{ ...plateTitleStyle, color: BONE }}>
            Research
          </div>
          <div className="mt-1.5 text-[11px] font-semibold leading-snug" style={{ color: BONE_FAINT }}>
            The parallel education track: twelve courses, four faculties, one enrollment at a time. The unlock is
            the reward — no player XP.
          </div>
          {last && (
            <div className="mt-2 text-[11px] font-bold" style={{ color: BONE_MUTED }}>
              Last completed: <span style={{ color: BONE }}>{last.name}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <GaugeWell value={`${state.completedCount}/${state.totalCourses}`} label="Courses" valueSize={22} />
          <GaugeWell value={state.credits.toLocaleString()} label="Credits" valueSize={16} />
        </div>
      </div>
      <div className="mt-3 border-t pt-3" style={{ borderColor: 'rgba(163,152,134,0.25)' }}>
        <CurriculumMap state={state} />
      </div>
    </Plate>
  );
};

/* ─── Course plates on the chain rail ────────────────────────────── */

const DataCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-black uppercase leading-none tracking-wide" style={{ color: BONE_FAINT }}>
      {label}
    </div>
    <div className="mt-1 whitespace-nowrap text-[13px] font-black leading-none" style={{ color: BONE }}>
      {value}
    </div>
  </div>
);

const EnrollButton: React.FC<{
  course: ResearchCourseView;
  color: string;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  testId: string;
}> = ({ course, color, busy, onEnroll, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={() => onEnroll(course)}
    disabled={busy}
    className="min-h-[44px] w-full px-3 text-[12px] font-black uppercase tracking-wide text-black transition-transform active:scale-[0.98] disabled:opacity-40"
    style={{ backgroundColor: AMBER, border: '2px solid #000', boxShadow: '3px 3px 0 rgba(0,0,0,0.7)' }}
  >
    {busy ? '…' : `Enroll · ${course.costNow.toLocaleString()} cr`}
  </button>
);

const CoursePlate: React.FC<{
  course: ResearchCourseView;
  facultyColor: string;
  state: ResearchStateView;
  selected: boolean;
  busy: boolean;
  onToggle: (id: string | null) => void;
  onEnroll: (course: ResearchCourseView) => void;
}> = ({ course, facultyColor, state, selected, busy, onToggle, onEnroll }) => {
  const active = state.activeEnrollment;
  const progress = active && active.courseId === course.id ? active.progressFraction : null;
  return (
    <Plate footColor={facultyColor} footHeight={3}>
      <button
        type="button"
        onClick={() => onToggle(selected ? null : course.id)}
        aria-expanded={selected}
        data-testid={`research-course-${course.id}`}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 px-1.5 py-1 text-[11px] font-black uppercase leading-none"
            style={{ border: `2px solid ${STEEL}`, color: BONE_MUTED, backgroundColor: 'rgba(6,5,4,0.7)' }}
          >
            {TIER_LABEL[course.tier]}
          </span>
          <span className="flex-1" />
          {course.status === 'completed' && (
            <Stamp color={facultyColor}>
              <PxIcon name="check" size={12} /> Complete
            </Stamp>
          )}
          {course.status === 'enrolled' && (
            <span
              className="inline-flex shrink-0 items-center px-2 py-1 text-[11px] font-black uppercase tracking-widest text-black"
              style={{ backgroundColor: AMBER, border: '2px solid #000' }}
            >
              In session
            </span>
          )}
          <PxIcon name="chevR" size={14} className="shrink-0" />
        </div>
        <div className="mt-1.5 text-[19px] uppercase leading-tight" style={{ ...plateTitleStyle, color: BONE }}>
          {course.name}
        </div>
      </button>

      <div className="mt-2 text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
        {course.unlockText}
      </div>

      <div className="mt-2.5 flex gap-4">
        <DataCell label="Duration" value={formatResearchDuration(course.durationNowMs)} />
        <DataCell label="Fee" value={`${course.costNow.toLocaleString()} cr`} />
        <DataCell label="Mastery" value={`+${course.masteryXp.toLocaleString()} XP`} />
      </div>

      {progress !== null && (
        <div className="mt-2.5">
          <SegmentLadder filled={Math.round(progress * 10)} total={10} color={facultyColor} height={8} />
        </div>
      )}

      {/* State actions */}
      <div className="mt-3">
        {course.canEnroll && (
          <EnrollButton course={course} color={facultyColor} busy={busy} onEnroll={onEnroll} testId={`research-enroll-${course.id}`} />
        )}
        {course.status === 'available' && !course.canEnroll && (
          <div className="flex min-h-[44px] items-center gap-2 px-1 text-[11px] font-bold leading-snug" style={{ color: BONE_FAINT }}>
            <PxIcon name="coin" size={14} />
            Requires {course.costNow.toLocaleString()} cr — your balance is {state.credits.toLocaleString()} cr.
          </div>
        )}
        {course.status === 'locked' && (
          <div className="space-y-1">
            {course.lockReasons.map((reason) => (
              <div key={reason} className="flex items-start gap-2 text-[11px] font-bold leading-snug" style={{ color: BONE_FAINT }}>
                <PxIcon name="lock" size={13} className="mt-px shrink-0" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The brief (tap the plate header) */}
      {selected && (
        <div className="mt-3 space-y-1.5 border-t pt-3 text-[11px] leading-snug" style={{ borderColor: 'rgba(163,152,134,0.25)', color: BONE_MUTED }} data-testid="research-course-detail">
          <div>
            <span className="font-black uppercase" style={{ color: BONE_FAINT }}>Duration </span>
            {formatResearchDuration(course.durationNowMs)}
            {course.durationHours * 3_600_000 !== course.durationNowMs && (
              <> (catalog {formatResearchDuration(course.durationHours * 3_600_000)})</>
            )}
          </div>
          <div>
            <span className="font-black uppercase" style={{ color: BONE_FAINT }}>Fee </span>
            {course.costNow.toLocaleString()} cr — paid on enrollment, not refunded
            {course.costCredits !== course.costNow && <> (catalog {course.costCredits.toLocaleString()} cr)</>}
          </div>
          <div>
            <span className="font-black uppercase" style={{ color: BONE_FAINT }}>Pays </span>
            {course.masteryXp.toLocaleString()} Scholarship mastery XP on completion — no player XP.
          </div>
          {course.prerequisite && (
            <div>
              <span className="font-black uppercase" style={{ color: BONE_FAINT }}>Requires </span>
              completing {researchCourse(course.prerequisite)?.name ?? course.prerequisite} first
            </div>
          )}
          {course.status === 'locked' && course.lockReasons.length > 0 && (
            <div>
              <div className="font-black uppercase" style={{ color: BONE_FAINT }}>Still needed</div>
              {course.lockReasons.map((reason) => (
                <div key={reason} className="font-bold" style={{ color: BONE }}>
                  {reason}
                </div>
              ))}
            </div>
          )}
          {course.status === 'enrolled' && (
            <div className="font-bold" style={{ color: BONE }}>
              In session — the plate at the top of this board carries its clock.
            </div>
          )}
          {course.canEnroll && (
            <div className="pt-1">
              <EnrollButton course={course} color={facultyColor} busy={busy} onEnroll={onEnroll} testId={`research-enroll-detail-${course.id}`} />
            </div>
          )}
        </div>
      )}
    </Plate>
  );
};

/* ─── Faculty sections ───────────────────────────────────────────── */

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
    <section>
      <Plate footColor={faculty.color}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[21px] uppercase leading-none" style={{ ...plateTitleStyle, color: BONE }}>
              {faculty.name}
            </div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: faculty.color }}>
              {faculty.home}
            </div>
            <div className="mt-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
              {faculty.blurb}
            </div>
          </div>
          <GaugeWell value={`${done}/3`} label="Done" color={faculty.color} valueSize={19} />
        </div>
      </Plate>

      {/* The chain rail: one node per course, struck as the chain fills. */}
      <div className="relative mt-3">
        <div
          aria-hidden="true"
          className="absolute bottom-3 left-[6px] top-3 w-[2px]"
          style={{ backgroundColor: 'rgba(107,98,87,0.45)' }}
        />
        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className="relative pl-6">
              <span
                aria-hidden="true"
                className="absolute left-0 top-[15px] z-10 h-[14px] w-[14px]"
                style={{
                  border: '2px solid #000',
                  backgroundColor:
                    course.status === 'completed'
                      ? faculty.color
                      : course.status === 'enrolled'
                        ? AMBER
                        : course.status === 'available'
                          ? 'rgba(6,5,4,0.9)'
                          : WELL_EMPTY,
                  boxShadow:
                    course.status === 'available'
                      ? `inset 0 0 0 2px ${BONE_FAINT}`
                      : 'inset 0 0 0 1px rgba(0,0,0,0.4)',
                }}
              />
              <CoursePlate
                course={course}
                facultyColor={faculty.color}
                state={state}
                selected={selectedCourseId === course.id}
                busy={busy}
                onToggle={onToggle}
                onEnroll={onEnroll}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── The board ──────────────────────────────────────────────────── */

export const ResearchPlatePage: React.FC<{
  state: ResearchStateView;
  busy: boolean;
  onEnroll: (course: ResearchCourseView) => void;
  onCancel: () => void;
}> = ({ state, busy, onEnroll, onCancel }) => {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <StandingPlate state={state} />
      {state.activeEnrollment && <InSessionPlate state={state} busy={busy} onCancel={onCancel} />}
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
      <div className="px-1 pb-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
        Fees are destroyed on enrollment — the catalog is the game's largest structured credit sink at 310,000 cr.
        Completions settle on the server's clock; there is nothing to claim and nothing to farm.
      </div>
    </div>
  );
};
