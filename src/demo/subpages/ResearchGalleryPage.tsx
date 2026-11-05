/**
 * Research — Variant C "Showcase": THE EXHIBITION.
 *
 * PROTOTYPE ONLY (design/hunter-subpages-research-c) — never shipped.
 * The curriculum as a gallery: each faculty is a wing hung with its
 * home roaming zone's real paintings, and each course is an exhibit —
 * the zone's parallax layers (far / mid / near) in tier order, so a
 * wing deepens as the tiers advance. Art carries the page; chrome is
 * hairlines and captions. No plates, no bolts, no gauges, no chain
 * rail (that is Variant A's Syllabus Board).
 *
 * Content is the game's own: the page renders a ResearchStateView
 * derived by researchStateView (src/content/research.ts) and sends
 * enroll / cancel intent up to the harness, exactly as the shipped
 * ResearchPanel does. Cancel terms print verbatim from the view.
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  formatResearchDuration,
  formatResearchRemaining,
  researchCourse,
  researchFaculty,
  RESEARCH_CATALOG_TOTALS,
  type ResearchCourseView,
  type ResearchStateView,
} from '@/content/research';

/* Gallery register — warm near-black ground, bone ink, hairlines.
 * Text colors hold ≥4.5:1 on the ground; over art everything sits on
 * a scrim or carries a soft legibility shadow. */
const GROUND = '#0A0806';
const INK = '#F5ECDA';
const BODY = '#D9CFB8';
const MUT = '#C2B096';
const FAINT = '#A99B7E';
const LINE = 'rgba(245,236,218,0.16)';
const AMBER = '#FFA01F';
const RED = '#FF5566';

const DISPLAY: React.CSSProperties = {
  fontFamily: "'Bebas Neue', 'Chakra Petch', system-ui, sans-serif",
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const OVER_ART: React.CSSProperties = {
  textShadow: '0 1px 10px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
};

/**
 * Faculty wings are the roaming zones the faculties live in
 * (research.ts `home`): Fabrication keeps The Workshop in the
 * Blastforge Yards, Field Mechanics works the bay + the road of the
 * Redline Circuit, Logistics & Markets runs on the Throwtech
 * Dumpnet's relay economy, Xenotech theorises in the Helixworks
 * Labyrinth. Tier order walks the zone's parallax layers inward:
 * Tier I far, Tier II mid, Tier III near.
 */
const FACULTY_ZONE: Record<string, string> = {
  fabrication: 'blastforge',
  field_mechanics: 'redline',
  logistics_markets: 'throwtech',
  xenotech: 'helixworks',
};
const TIER_LAYER: Record<number, string> = { 1: 'far', 2: 'mid', 3: 'near' };

function zoneUrl(facultyId: string, layer: string): string {
  const zone = FACULTY_ZONE[facultyId] ?? 'dustwaste';
  return getPixelSprite(`zone-${zone}-${layer}`)?.url ?? '';
}

const Caps: React.FC<{
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, color = FAINT, style }) => (
  <div
    className="text-[11px] font-bold uppercase"
    style={{ color, letterSpacing: '0.14em', ...style }}
  >
    {children}
  </div>
);

/* ─── Featured exhibit — the course in session ───────────────────── */

const FeaturedExhibit: React.FC<{
  view: ResearchStateView;
  onCancel: () => void;
}> = ({ view, onCancel }) => {
  const [confirming, setConfirming] = useState(false);
  const active = view.activeEnrollment;
  if (!active) return null;
  const faculty = researchFaculty(active.faculty);
  const pct = Math.round(active.progressFraction * 100);
  return (
    <section aria-label="Course in session">
      <div className="relative" style={{ height: 336 }}>
        <img
          src={zoneUrl(active.faculty, 'bg')}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${GROUND} 2%, rgba(10,8,6,0.25) 45%, rgba(10,8,6,0) 70%)`,
          }}
        />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-4">
          <Caps color={faculty.color} style={OVER_ART}>
            Now studying · {faculty.name} · {faculty.home}
          </Caps>
          <h2
            className="mt-1 text-[42px] leading-[0.95]"
            style={{ ...DISPLAY, color: INK, ...OVER_ART }}
          >
            {active.courseName}
          </h2>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-[30px] leading-none" style={{ ...DISPLAY, color: INK, ...OVER_ART }}>
              {formatResearchRemaining(active.remainingMs).replace(' left', '')}
            </span>
            <Caps color={MUT} style={OVER_ART}>
              left · {pct}% studied
            </Caps>
          </div>
        </div>
        {/* The one thread of progress — a line of light on the sill. */}
        <div className="absolute inset-x-0 bottom-0" style={{ height: 3, backgroundColor: 'rgba(245,236,218,0.14)' }}>
          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: faculty.color }} />
        </div>
      </div>
      <div className="px-4 pt-3">
        <p className="text-[12.5px] leading-snug" style={{ color: MUT }}>
          In session — runs beside your current activity, never interrupts it.
        </p>
        <p className="mt-1 text-[12.5px] leading-snug" style={{ color: FAINT }}>
          Completes {new Date(active.completesAt).toLocaleString()} · Fee paid{' '}
          {active.costCredits.toLocaleString()} cr · not refunded
        </p>
        {confirming ? (
          <div className="mt-3">
            <p className="text-[12.5px] font-bold leading-snug" style={{ color: RED }}>
              {view.cancelTerms}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                data-testid="research-forfeit"
                onClick={onCancel}
                className="min-h-[48px] flex-1 text-[12px] font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
                style={{ backgroundColor: RED, color: '#17060A' }}
              >
                Forfeit course
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-[48px] flex-1 text-[12px] font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
                style={{ border: `1px solid ${LINE}`, color: INK }}
              >
                Keep studying
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="research-cancel"
            onClick={() => setConfirming(true)}
            className="mt-3 min-h-[48px] px-5 text-[12px] font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
            style={{ border: `1px solid ${LINE}`, color: INK }}
          >
            Cancel course
          </button>
        )}
      </div>
    </section>
  );
};

/* ─── One course, hung as an exhibit ─────────────────────────────── */

const CourseExhibit: React.FC<{
  course: ResearchCourseView;
  credits: number;
  onEnroll: (course: ResearchCourseView) => void;
  onOpen: (course: ResearchCourseView) => void;
}> = ({ course, credits, onEnroll, onOpen }) => {
  const faculty = researchFaculty(course.faculty);
  const locked = course.status === 'locked';
  return (
    <article className="mt-7">
      <button
        type="button"
        onClick={() => onOpen(course)}
        data-testid={`research-course-${course.id}`}
        aria-label={`${course.name} course details`}
        className="block w-full text-left"
      >
        <div className="relative" style={{ height: 118 }}>
          <img
            src={zoneUrl(course.faculty, TIER_LAYER[course.tier])}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={
              locked
                ? { filter: 'grayscale(0.92) brightness(0.5) contrast(1.02)' }
                : undefined
            }
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, rgba(10,8,6,0.88) 0%, rgba(10,8,6,0) 55%)`,
            }}
          />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-2.5">
            <Caps color={MUT} style={OVER_ART}>
              Tier {course.tier === 1 ? 'I' : course.tier === 2 ? 'II' : 'III'}
            </Caps>
            <div
              className="mt-0.5 text-[25px] leading-none"
              style={{ ...DISPLAY, color: INK, ...OVER_ART }}
            >
              {course.name}
            </div>
          </div>
          {course.status === 'completed' && (
            <div
              className="absolute right-3 top-2.5 flex items-center gap-1 text-[11px] font-black uppercase"
              style={{ color: faculty.color, letterSpacing: '0.12em', ...OVER_ART }}
            >
              <PxIcon name="check" size={13} />
              Complete
            </div>
          )}
          {course.status === 'enrolled' && (
            <div
              className="absolute right-3 top-2.5 text-[11px] font-black uppercase"
              style={{ color: AMBER, letterSpacing: '0.12em', ...OVER_ART }}
            >
              In session
            </div>
          )}
        </div>
      </button>
      <div className="px-4 pt-2.5">
        <p className="text-[13px] leading-snug" style={{ color: BODY }}>
          {course.unlockText}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Caps>
            Duration <span style={{ color: INK }}>{formatResearchDuration(course.durationNowMs)}</span>
          </Caps>
          <Caps>
            Fee <span style={{ color: INK }}>{course.costNow.toLocaleString()} cr</span>
          </Caps>
          <Caps>
            Mastery <span style={{ color: INK }}>+{course.masteryXp.toLocaleString()} XP</span>
          </Caps>
        </div>
        {locked &&
          course.lockReasons.map((reason) => (
            <div
              key={reason}
              className="mt-1.5 flex items-start gap-1.5 text-[12px] font-bold leading-snug"
              style={{ color: MUT }}
            >
              <PxIcon name="lock" size={12} className="mt-[2px] shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        {course.status === 'available' && !course.canEnroll && (
          <p className="mt-2 text-[12px] font-bold leading-snug" style={{ color: MUT }}>
            Requires {course.costNow.toLocaleString()} cr — your balance is{' '}
            {credits.toLocaleString()} cr.
          </p>
        )}
        {course.status === 'enrolled' && (
          <p className="mt-2 text-[12px] leading-snug" style={{ color: FAINT }}>
            In progress — see the course at the top of this page for its clock.
          </p>
        )}
        {course.canEnroll && (
          <button
            type="button"
            data-testid={`research-enroll-${course.id}`}
            onClick={() => onEnroll(course)}
            className="mt-3 min-h-[48px] w-full text-[12px] font-black uppercase tracking-widest transition-transform active:scale-[0.99]"
            style={{ backgroundColor: AMBER, color: '#171008' }}
          >
            Enroll · {course.costNow.toLocaleString()} cr
          </button>
        )}
      </div>
    </article>
  );
};

/* ─── The viewing room — one course, full brief ──────────────────── */

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div
    className="flex items-baseline justify-between gap-5 py-2.5"
    style={{ borderBottom: `1px solid ${LINE}` }}
  >
    <Caps>{label}</Caps>
    <div className="text-right text-[13px] leading-snug" style={{ color: INK }}>
      {children}
    </div>
  </div>
);

const CourseViewingRoom: React.FC<{
  course: ResearchCourseView;
  view: ResearchStateView;
  onEnroll: (course: ResearchCourseView) => void;
  onClose: () => void;
}> = ({ course, view, onEnroll, onClose }) => {
  const faculty = researchFaculty(course.faculty);
  const prereq = course.prerequisite ? researchCourse(course.prerequisite) : undefined;
  const catalogDiffers =
    course.costCredits !== course.costNow ||
    course.durationHours * 3_600_000 !== course.durationNowMs;
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: GROUND }}
      data-testid="research-course-detail"
      role="dialog"
      aria-label={`${course.name} course brief`}
    >
      <div className="relative" style={{ height: 252 }}>
        <img
          src={zoneUrl(course.faculty, TIER_LAYER[course.tier])}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={
            course.status === 'locked'
              ? { filter: 'grayscale(0.92) brightness(0.5) contrast(1.02)' }
              : undefined
          }
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${GROUND} 0%, rgba(10,8,6,0) 55%)`,
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close course details"
          className="absolute right-3 top-3 flex min-h-[44px] items-center px-3.5 text-[11px] font-black uppercase tracking-widest"
          style={{ backgroundColor: 'rgba(5,4,3,0.72)', color: INK, border: `1px solid ${LINE}` }}
        >
          Close
        </button>
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
          <Caps color={faculty.color} style={OVER_ART}>
            {faculty.name} · Tier {course.tier === 1 ? 'I' : course.tier === 2 ? 'II' : 'III'} ·{' '}
            {faculty.home}
          </Caps>
          <h3
            className="mt-1 text-[34px] leading-[0.95]"
            style={{ ...DISPLAY, color: INK, ...OVER_ART }}
          >
            {course.name}
          </h3>
        </div>
      </div>
      <div className="px-4 pb-12 pt-3">
        <p className="text-[13.5px] leading-relaxed" style={{ color: BODY }}>
          {course.unlockText}
        </p>
        <div className="mt-3">
          <DetailRow label="Duration">
            {formatResearchDuration(course.durationNowMs)}
            {catalogDiffers && (
              <span style={{ color: FAINT }}>
                {' '}
                (catalog {formatResearchDuration(course.durationHours * 3_600_000)})
              </span>
            )}
          </DetailRow>
          <DetailRow label="Fee">
            {course.costNow.toLocaleString()} cr — paid on enrollment, not refunded
            {catalogDiffers && (
              <span style={{ color: FAINT }}>
                {' '}
                (catalog {course.costCredits.toLocaleString()} cr)
              </span>
            )}
          </DetailRow>
          <DetailRow label="Mastery">
            Pays {course.masteryXp.toLocaleString()} Scholarship mastery XP on completion — no
            player XP
          </DetailRow>
          {prereq && (
            <DetailRow label="Prerequisite">
              Requires completing {prereq.name} first
            </DetailRow>
          )}
        </div>
        {course.status === 'locked' && course.lockReasons.length > 0 && (
          <div className="mt-4">
            <Caps color={MUT}>Still needed</Caps>
            {course.lockReasons.map((reason) => (
              <div
                key={reason}
                className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-bold leading-snug"
                style={{ color: BODY }}
              >
                <PxIcon name="lock" size={12} className="mt-[2px] shrink-0" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}
        {course.status === 'completed' && (
          <div
            className="mt-5 flex items-center gap-1.5 text-[12px] font-black uppercase"
            style={{ color: faculty.color, letterSpacing: '0.12em' }}
          >
            <PxIcon name="check" size={14} />
            Complete — the unlock is live
          </div>
        )}
        {course.status === 'enrolled' && (
          <p className="mt-5 text-[12.5px] leading-snug" style={{ color: MUT }}>
            In progress — see the course at the top of this page for its clock.
          </p>
        )}
        {course.status === 'available' && !course.canEnroll && (
          <p className="mt-5 text-[12.5px] font-bold leading-snug" style={{ color: MUT }}>
            Requires {course.costNow.toLocaleString()} cr — your balance is{' '}
            {view.credits.toLocaleString()} cr.
          </p>
        )}
        {course.canEnroll && (
          <button
            type="button"
            data-testid={`research-enroll-${course.id}`}
            onClick={() => onEnroll(course)}
            className="mt-5 min-h-[48px] w-full text-[12px] font-black uppercase tracking-widest transition-transform active:scale-[0.99]"
            style={{ backgroundColor: AMBER, color: '#171008' }}
          >
            Enroll · {course.costNow.toLocaleString()} cr
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── The page ───────────────────────────────────────────────────── */

export const ResearchGalleryPage: React.FC<{
  view: ResearchStateView;
  onEnroll: (course: ResearchCourseView) => void;
  onCancel: () => void;
}> = ({ view, onEnroll, onCancel }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? view.courses.find((c) => c.id === selectedId) ?? null
    : null;
  const last = view.lastCompletion
    ? researchCourse(view.lastCompletion.courseId)
    : undefined;

  const enrollAndClose = (course: ResearchCourseView) => {
    onEnroll(course);
    setSelectedId(null);
  };

  return (
    <main style={{ backgroundColor: GROUND, color: INK }} className="min-h-screen pb-10">
      {/* Wall label */}
      <header className="px-4 pb-5 pt-3">
        <h1 className="text-[46px] leading-[0.95]" style={{ ...DISPLAY, color: INK }}>
          Research
        </h1>
        <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed" style={{ color: MUT }}>
          The parallel education track: twelve courses, four faculties, one enrollment at a
          time. The unlock is the reward — no player XP.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          <div>
            <div className="text-[21px] leading-none" style={{ ...DISPLAY, color: INK }}>
              {view.completedCount}/{view.totalCourses}
            </div>
            <Caps style={{ marginTop: 3 }}>Courses</Caps>
          </div>
          <div>
            <div className="text-[21px] leading-none" style={{ ...DISPLAY, color: INK }}>
              {view.credits.toLocaleString()}
            </div>
            <Caps style={{ marginTop: 3 }}>Credits</Caps>
          </div>
          {last && (
            <div>
              <div className="text-[21px] leading-none" style={{ ...DISPLAY, color: INK }}>
                {last.name}
              </div>
              <Caps style={{ marginTop: 3 }}>Last completed</Caps>
            </div>
          )}
        </div>
      </header>

      {view.activeEnrollment ? (
        <FeaturedExhibit view={view} onCancel={onCancel} />
      ) : (
        <section className="px-4 pb-1" aria-label="No course in session">
          <div className="py-4" style={{ borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
            <Caps color={MUT}>The track is open</Caps>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: BODY }}>
              No course in session. Enroll below — the clock runs beside your current activity
              and never interrupts it.
            </p>
          </div>
        </section>
      )}

      {/* Wings */}
      {view.faculties.map((faculty) => {
        const done = faculty.courseIds.filter(
          (id) => view.courses.find((c) => c.id === id)?.status === 'completed',
        ).length;
        return (
          <section key={faculty.id} className="mt-10" aria-label={faculty.name}>
            <div className="relative" style={{ height: 148 }}>
              <img
                src={zoneUrl(faculty.id, 'bg')}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top, rgba(10,8,6,0.88) 0%, rgba(10,8,6,0) 60%)`,
                }}
              />
              <div className="absolute bottom-0 left-0 px-4 pb-2.5">
                <h3 className="text-[30px] leading-none" style={{ ...DISPLAY, color: INK, ...OVER_ART }}>
                  {faculty.name}
                </h3>
              </div>
              <div
                className="absolute bottom-0 right-0 px-4 pb-2.5 text-[20px] leading-none"
                style={{ ...DISPLAY, color: INK, ...OVER_ART }}
              >
                {done}/{faculty.courseIds.length}
              </div>
            </div>
            <div className="px-4 pt-2.5">
              <Caps color={faculty.color}>{faculty.home}</Caps>
              <p className="mt-1 text-[12.5px] leading-snug" style={{ color: MUT }}>
                {faculty.blurb}
              </p>
            </div>
            {faculty.courseIds.map((courseId) => {
              const course = view.courses.find((c) => c.id === courseId);
              if (!course) return null;
              return (
                <CourseExhibit
                  key={course.id}
                  course={course}
                  credits={view.credits}
                  onEnroll={onEnroll}
                  onOpen={(c) => setSelectedId(c.id)}
                />
              );
            })}
          </section>
        );
      })}

      <footer className="px-4 pt-10">
        <div className="pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <p className="text-[12px] leading-relaxed" style={{ color: FAINT }}>
            The full catalog: {RESEARCH_CATALOG_TOTALS.courses} courses ·{' '}
            {RESEARCH_CATALOG_TOTALS.totalCostCredits.toLocaleString()} cr in fees ·{' '}
            {Math.round(RESEARCH_CATALOG_TOTALS.totalDurationHours / 24)} days of study, end
            to end.
          </p>
        </div>
      </footer>

      {selected && (
        <CourseViewingRoom
          course={selected}
          view={view}
          onEnroll={enrollAndClose}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
};
