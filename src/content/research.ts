/**
 * Research — the parallel education track (research slice, migration
 * 0038; design brief: cybercache-prep/design-briefs/expansion-pack/
 * research-occupation.md, rulings in DECISIONS.md).
 *
 * This module is the ONE content owner for Research: the course
 * catalog (4 faculties × 3 tiers), the bonus derivation, the lever
 * surface (defaults + hard clamps), the enrollment term math, and
 * the state-view derivation the Profile panel + Dashboard chip
 * render. Engines, routes, stores, and screens read from here —
 * nobody re-derives a magnitude.
 *
 * The laws this file encodes:
 *
 *  - R1: RESEARCH IS A COMMITMENT, NOT AN ACTION. It runs on a
 *    PARALLEL education track beside dispatch — it never occupies
 *    the personal action slot, adds no ActivityKind, and action
 *    switches (roam / craft / boss / death / resurrection) have
 *    zero interaction with an enrollment. One enrollment at a time;
 *    the slot scarcity is the calendar, not the hunter's hands.
 *  - PROGRESS IS PURE WALL-CLOCK. An enrollment records
 *    enrolled_at and completes_at = enrolled_at + duration
 *    (duration + cost snapshotted from the levers at enroll). No
 *    accrual windows, no heartbeat, NO away cap — the deliberate
 *    divergence from crafting's model: Research pays out nothing
 *    farmable, so there is nothing for a cap to protect.
 *  - COMPLETION IS LAZY-SETTLED. cc_settle_research runs at the
 *    head of every research read and every research-bonus
 *    derivation; at completes_at the enrollment becomes a permanent
 *    research_completions row and the unlock is live from that
 *    instant. No cron duty (the daily heartbeat's reliability is a
 *    known watch item — Research must not depend on it).
 *  - NO PLAYER XP (Q2 ruling). Completion grants mastery XP to the
 *    research.scholarship track only — 10 XP per catalog course
 *    hour, once, at completion. The unlock is the reward.
 *  - CANCEL FORFEITS (Q3 ruling, Torn's rule). Cancelling deletes
 *    the enrollment; accrued time is lost and the fee is NOT
 *    refunded — the fee is a sink the moment it is charged.
 *    Re-enrolling restarts from zero at the full lever-scaled price.
 *  - SERVER TRUTH ONLY. Bonuses derive from research_completions
 *    rows written by the settler — never from a client-supplied
 *    list. computeResearchBonuses is pure over the completed id set.
 *  - THE SINK IS THE POINT. Fees are destroyed at enroll: 310,000
 *    cr across the catalog (4 × 77,500), the game's largest
 *    structured credit sink, priced ~2.6× the entire bench ladder
 *    per faculty against top-area gross ≈1,260 cr/h (a T3's 60,000
 *    cr ≈ 48 hours of top-area gross) — steep, reachable, and
 *    payable from the market by the specialists it rewards.
 *  - Passive magnitudes sit in the shipped family: Ballistics
 *    Theory's +1% weapon damage is ⅕ of one maxed Gunslinger small
 *    node and exactly Torn's Evolution reward; the fee / buyback
 *    terms (+0.05 / +0.02) are at or below the Fixer's equivalent
 *    nodes — Research is the SLOW way to buy what the Fixer buys
 *    with points, the correct relationship between a time-sink and
 *    a build-sink.
 */

// ─── Faculties ───────────────────────────────────────────────────────

export interface ResearchFaculty {
  id: string;
  name: string;
  /** The system's home surface, named on the faculty track header. */
  home: string;
  /** G-1 beam / accent color for this faculty (grammar palette family). */
  color: string;
  blurb: string;
}

export const RESEARCH_FACULTIES: readonly ResearchFaculty[] = [
  {
    id: 'fabrication',
    name: 'Fabrication',
    home: 'The Workshop',
    color: '#FFB020',
    blurb: 'Production study for crafters: quality, batch work, and the temper roll.',
  },
  {
    id: 'field_mechanics',
    name: 'Field Mechanics',
    home: 'The bay + the road',
    color: '#39D0D8',
    blurb: 'Wrench credentials: faster work, gentler miles, a master’s XP rate.',
  },
  {
    id: 'logistics_markets',
    name: 'Logistics & Markets',
    home: 'The economy',
    color: '#7FB069',
    blurb: 'Supply-chain theory that pays in buyback, offline hours, and thinner fees.',
  },
  {
    id: 'xenotech',
    name: 'Xenotech',
    home: 'Theory',
    color: '#B18CFF',
    blurb: 'Combat theory in the Torn mold: small, permanent, engine-read passives.',
  },
];

export function researchFaculty(id: string): ResearchFaculty {
  return RESEARCH_FACULTIES.find((f) => f.id === id) ?? RESEARCH_FACULTIES[0];
}

// ─── Bonuses (the flat record every consumer reads) ─────────────────

/**
 * The research bonus record — the same flat-key shape the engines
 * already speak. Every key has a registered consumer
 * (RESEARCH_EFFECT_CONSUMERS in src/lib/skills/skillConsumers.ts);
 * a course whose unlock has no engine is not in the catalog.
 */
export interface ResearchBonuses {
  /** Fabrication T1: flat shift added inside the ONE composed craft
   *  quality clamp (lever + Fixer + research, [−10, +20]). */
  craftQualityShift: number;
  /** Fabrication T3: flat addition to the crafted-gear temper roll,
   *  inside the 0.30 cap. */
  gearTemperBonus: number;
  /** Fabrication T3: +1 generation draw per completed gear frame,
   *  beside the core-catalyst term. */
  gearDrawBonus: number;
  /** Field Mechanics T1: repair work-rate fraction (rate × 1.05),
   *  composed at the accept / enqueue snapshot. */
  repairWorkRateBonus: number;
  /** Field Mechanics T2: own-vehicle condition decay reduction
   *  fraction; stacks MULTIPLICATIVELY with the Fixer major's term
   *  (×0.75 × ×0.90 = ×0.675 combined). */
  vehicleDecayReduction: number;
  /** Field Mechanics T3: +1 player XP per condition point on repair
   *  work the holder performs (the serviceXpPerPoint read). */
  repairServiceXpBonus: number;
  /** Logistics T1: vendor buyback rate addition, under the shared
   *  0.90 ceiling. */
  vendorBuybackBonus: number;
  /** Logistics T2: +1 hour on the earned offline cap composition
   *  (the 24 h absolute ceiling still binds). */
  offlineCapBonus: number;
  /** Logistics T3: market fee reduction addition on all own sales,
   *  additive with Darknet under the existing ≤ 1 clamp; origin
   *  terms stay disjoint (DECISIONS R5). */
  marketFeeReduction: number;
  /** Xenotech T1: weapon damage fraction (the skill-bonus key). */
  weaponDamage: number;
  /** Xenotech T2: shield capacity fraction (the skill-bonus key). */
  shieldCapacity: number;
  /** Xenotech T3: boss dedicated-drop chance addition on the
   *  levered BOSS_DEDICATED_DROP_CHANCE path. */
  bossDedicatedChanceBonus: number;
}

export const RESEARCH_EFFECT_KEYS = [
  'craftQualityShift',
  'gearTemperBonus',
  'gearDrawBonus',
  'repairWorkRateBonus',
  'vehicleDecayReduction',
  'repairServiceXpBonus',
  'vendorBuybackBonus',
  'offlineCapBonus',
  'marketFeeReduction',
  'weaponDamage',
  'shieldCapacity',
  'bossDedicatedChanceBonus',
] as const satisfies readonly (keyof ResearchBonuses)[];

export function zeroResearchBonuses(): ResearchBonuses {
  return {
    craftQualityShift: 0,
    gearTemperBonus: 0,
    gearDrawBonus: 0,
    repairWorkRateBonus: 0,
    vehicleDecayReduction: 0,
    repairServiceXpBonus: 0,
    vendorBuybackBonus: 0,
    offlineCapBonus: 0,
    marketFeeReduction: 0,
    weaponDamage: 0,
    shieldCapacity: 0,
    bossDedicatedChanceBonus: 0,
  };
}

// ─── The catalog — 4 faculties × 3 tiers (brief §3.2) ───────────────

export interface ResearchCourse {
  id: string;
  faculty: string;
  /** 1 Foundation (hours) · 2 Practice (days) · 3 Certification (a week). */
  tier: 1 | 2 | 3;
  name: string;
  /** Catalog duration in hours (lever scalar applies at enroll). */
  durationHours: number;
  /** Catalog fee in credits, destroyed at enroll (lever scalar applies). */
  costCredits: number;
  /** Player level gate, when the brief names one. */
  requiresLevel?: number;
  /** Owned-bench gate (profiles.workshop_benches), when named. */
  requiresBench?: number;
  /** Prerequisite course id within the faculty, when chained. */
  prerequisite?: string;
  /** The unlock, in the bonus vocabulary. */
  effects: Partial<ResearchBonuses>;
  /** Player-facing unlock line — names the exact engine that reads
   *  it (no invisible mechanics; shown on the card before paying). */
  unlockText: string;
}

export const RESEARCH_COURSES: readonly ResearchCourse[] = [
  // Faculty 1 — Fabrication (the Workshop)
  {
    id: 'shop_fundamentals', faculty: 'fabrication', tier: 1,
    name: 'Shop Fundamentals', durationHours: 6, costCredits: 2500,
    requiresLevel: 5,
    effects: { craftQualityShift: 2 },
    unlockText: 'Craft quality shift +2 on every completed craft unit (inside the shared −10…+20 clamp).',
  },
  {
    id: 'production_systems', faculty: 'fabrication', tier: 2,
    name: 'Production Systems', durationHours: 48, costCredits: 15000,
    prerequisite: 'shop_fundamentals', requiresBench: 2,
    effects: {},
    unlockText: 'Unlocks the three batch recipes — Shield Cell ×3, Patch Kit ×3, Ordnance Charge ×3 — at 2.5× inputs and 2.2× unit time per 3 units.',
  },
  {
    id: 'master_fabricator', faculty: 'fabrication', tier: 3,
    name: 'Master Fabricator Certification', durationHours: 168, costCredits: 60000,
    prerequisite: 'production_systems', requiresBench: 3,
    effects: { gearTemperBonus: 0.03, gearDrawBonus: 1 },
    unlockText: 'Crafted gear temper chance +0.03 (inside the 0.30 cap) and +1 generation draw on every crafted gear frame.',
  },
  // Faculty 2 — Field Mechanics (the bay + the road)
  {
    id: 'wrench_basics', faculty: 'field_mechanics', tier: 1,
    name: 'Wrench Basics', durationHours: 6, costCredits: 2500,
    requiresLevel: 5,
    effects: { repairWorkRateBonus: 0.05 },
    unlockText: 'Repair work rate ×1.05 on board jobs you accept and your own self-repair.',
  },
  {
    id: 'powertrain_systems', faculty: 'field_mechanics', tier: 2,
    name: 'Powertrain Systems', durationHours: 48, costCredits: 15000,
    requiresLevel: 20, prerequisite: 'wrench_basics',
    effects: { vehicleDecayReduction: 0.10 },
    unlockText: 'Your vehicles’ condition decay −10% (stacks multiplicatively with the Fixer Fleet Engineer term).',
  },
  {
    id: 'master_mechanic', faculty: 'field_mechanics', tier: 3,
    name: 'Master Mechanic Certification', durationHours: 168, costCredits: 60000,
    requiresLevel: 40, prerequisite: 'powertrain_systems',
    effects: { repairServiceXpBonus: 1 },
    unlockText: 'Repair work you perform pays +1 player XP per condition point restored.',
  },
  // Faculty 3 — Logistics & Markets (the economy)
  {
    id: 'street_economics', faculty: 'logistics_markets', tier: 1,
    name: 'Street Economics', durationHours: 6, costCredits: 2500,
    requiresLevel: 5,
    effects: { vendorBuybackBonus: 0.02 },
    unlockText: 'NPC vendor buyback rate +0.02 on everything you sell (under the 0.90 ceiling).',
  },
  {
    id: 'supply_chains', faculty: 'logistics_markets', tier: 2,
    name: 'Supply Chains', durationHours: 48, costCredits: 15000,
    requiresLevel: 20, prerequisite: 'street_economics',
    effects: { offlineCapBonus: 1 },
    unlockText: 'Offline earnings cap +1 hour (the 24-hour absolute ceiling still binds).',
  },
  {
    id: 'syndicate_ledger', faculty: 'logistics_markets', tier: 3,
    name: 'Syndicate Ledger', durationHours: 168, costCredits: 60000,
    requiresLevel: 40, prerequisite: 'supply_chains',
    effects: { marketFeeReduction: 0.05 },
    unlockText: 'Market fee reduction +0.05 on all your sales (additive with Darknet Broker, under the ≤1 clamp).',
  },
  // Faculty 4 — Xenotech (theory; Torn's Biology/Combat mold)
  {
    id: 'ballistics_theory', faculty: 'xenotech', tier: 1,
    name: 'Ballistics Theory', durationHours: 6, costCredits: 2500,
    requiresLevel: 5,
    effects: { weaponDamage: 0.01 },
    unlockText: 'Weapon damage +1% everywhere damage is priced.',
  },
  {
    id: 'shield_dynamics', faculty: 'xenotech', tier: 2,
    name: 'Shield Dynamics', durationHours: 48, costCredits: 15000,
    requiresLevel: 20, prerequisite: 'ballistics_theory',
    effects: { shieldCapacity: 0.02 },
    unlockText: 'Shield capacity +2% in the survival composite.',
  },
  {
    id: 'void_theory', faculty: 'xenotech', tier: 3,
    name: 'Void Theory Certification', durationHours: 168, costCredits: 60000,
    requiresLevel: 40, prerequisite: 'shield_dynamics',
    effects: { bossDedicatedChanceBonus: 0.01 },
    unlockText: 'Boss dedicated-drop chance +0.01 on every victory roll (on top of the tuned 0.10).',
  },
];

export function researchCourse(id: string): ResearchCourse | undefined {
  return RESEARCH_COURSES.find((c) => c.id === id);
}

/** Catalog totals: 12 courses · 37 days sequential · 310,000 cr. */
export const RESEARCH_CATALOG_TOTALS = {
  courses: RESEARCH_COURSES.length,
  totalDurationHours: RESEARCH_COURSES.reduce((sum, c) => sum + c.durationHours, 0),
  totalCostCredits: RESEARCH_COURSES.reduce((sum, c) => sum + c.costCredits, 0),
};

/** The mastery track completion pays into (seeded in 0038). */
export const RESEARCH_MASTERY_TRACK = 'research.scholarship';
/** Mastery XP per catalog course hour, granted once at completion. */
export const RESEARCH_MASTERY_XP_PER_HOUR = 10;

export function researchMasteryXpFor(course: ResearchCourse): number {
  return RESEARCH_MASTERY_XP_PER_HOUR * course.durationHours;
}

// ─── Bonus derivation (pure; server records in, bonuses out) ────────

/**
 * The one derivation: bonuses from a set of completed course ids.
 * Pure — no store, no I/O — the computeSkillBonuses shape. Unknown
 * ids are ignored (a completion row can only name a catalog course;
 * the settler writes them).
 */
export function computeResearchBonuses(completedCourseIds: Iterable<string>): ResearchBonuses {
  const bonuses = zeroResearchBonuses();
  const completed = new Set(completedCourseIds);
  for (const course of RESEARCH_COURSES) {
    if (!completed.has(course.id)) continue;
    for (const key of RESEARCH_EFFECT_KEYS) {
      const value = course.effects[key];
      if (typeof value === 'number' && value !== 0) bonuses[key] += value;
    }
  }
  return bonuses;
}

/**
 * Merge a research record into a skill-bonus record at the Chef
 * derivation points (the routes rebuild skill bonuses from server
 * records via skillBonusesFromRecords; research composes onto the
 * same record so every downstream engine — boss sim, roaming DPS /
 * survival, the vehicle tick — reads one record):
 *  - weaponDamage / shieldCapacity add (the keys already exist in
 *    the bonus vocabulary; the composites at skillBonuses.ts read
 *    them);
 *  - vehicleDecayReduction composes MULTIPLICATIVELY with the
 *    Fixer Fleet Engineer term: combined = 1 − (1 − skill)(1 −
 *    research), so 0.25 + Powertrain's 0.10 → ×0.675 decay.
 * Keys are only written when the research term is non-zero, so a
 * player with no completions derives a bit-identical record.
 */
export function mergeResearchBonuses(
  skillBonuses: Record<string, number>,
  research: ResearchBonuses,
): Record<string, number> {
  const merged = { ...skillBonuses };
  if (research.weaponDamage !== 0) {
    merged.weaponDamage = (merged.weaponDamage ?? 0) + research.weaponDamage;
  }
  if (research.shieldCapacity !== 0) {
    merged.shieldCapacity = (merged.shieldCapacity ?? 0) + research.shieldCapacity;
  }
  if (research.vehicleDecayReduction !== 0) {
    const skill = merged.vehicleDecayReduction ?? 0;
    merged.vehicleDecayReduction = 1 - (1 - skill) * (1 - research.vehicleDecayReduction);
  }
  return merged;
}

// ─── Levers ──────────────────────────────────────────────────────────

/**
 * The research lever surface (brief §9). Enrollment-time scalars
 * only — no lever touches unlock magnitudes (those are content,
 * like skill node values) and no lever can move a running
 * enrollment (terms snapshot at enroll). Registered in
 * src/server/economy/config.ts; the SQL enroll reads them through
 * cc_economy_config_number with identical clamps at the call site.
 */
export interface ResearchLeverValues {
  /** Multiplies catalog durations at enroll; snapshotted. */
  researchDurationScalar: number;
  /** Multiplies catalog costs at enroll; snapshotted. */
  researchCostScalar: number;
}

export const RESEARCH_LEVER_DEFAULTS: ResearchLeverValues = {
  researchDurationScalar: 1,
  researchCostScalar: 1,
};

export const RESEARCH_LEVER_CLAMPS: Record<
  keyof ResearchLeverValues,
  { min: number; max: number; integer?: boolean }
> = {
  researchDurationScalar: { min: 0.5, max: 2 },
  researchCostScalar: { min: 0.5, max: 3 },
};

function clampLever(key: keyof ResearchLeverValues, value: number): number {
  const clamp = RESEARCH_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

export function resolveResearchLevers(
  partial?: Partial<ResearchLeverValues> | null,
): ResearchLeverValues {
  const values: ResearchLeverValues = { ...RESEARCH_LEVER_DEFAULTS };
  if (!partial) return values;
  for (const key of Object.keys(RESEARCH_LEVER_DEFAULTS) as Array<keyof ResearchLeverValues>) {
    const raw = partial[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      values[key] = clampLever(key, raw);
    }
  }
  return values;
}

// ─── Enrollment terms (snapshotted at enroll) ────────────────────────

export interface ResearchEnrollmentTerms {
  /** Lever-scaled fee actually charged (destroyed). */
  costCredits: number;
  /** Lever-scaled duration the enrollment runs. */
  durationMs: number;
}

export function researchEnrollmentTerms(
  course: ResearchCourse,
  levers: ResearchLeverValues,
): ResearchEnrollmentTerms {
  return {
    costCredits: Math.floor(course.costCredits * levers.researchCostScalar),
    durationMs: Math.round(course.durationHours * 3_600_000 * levers.researchDurationScalar),
  };
}

// ─── Facts + state view ──────────────────────────────────────────────

/** One active enrollment (a research_enrollments row, camel-cased). */
export interface ResearchEnrollmentFacts {
  courseId: string;
  enrolledAt: string;
  completesAt: string;
  /** Snapshot: the fee that was charged. */
  costCredits: number;
  /** Snapshot: the duration the enrollment runs. */
  durationMs: number;
}

/** One completion (a research_completions row, camel-cased). */
export interface ResearchCompletionFacts {
  courseId: string;
  completedAt: string;
}

/** Server-record facts the view derives from (routes/stores supply). */
export interface ResearchFacts {
  playerLevel: number;
  /** Owned benches (profiles.workshop_benches, 1..3). */
  workshopBenches: number;
  credits: number;
  completed: ResearchCompletionFacts[];
  activeEnrollment: ResearchEnrollmentFacts | null;
  /** Server clock, ms epoch — remaining time is derived, never sent. */
  nowMs: number;
}

export type ResearchCourseStatus = 'completed' | 'enrolled' | 'available' | 'locked';

export interface ResearchCourseView extends ResearchCourse {
  status: ResearchCourseStatus;
  /** Factual unmet gates (empty unless locked). Facts only — no nudges. */
  lockReasons: string[];
  /** Enrolling is possible right now (gates met, track free, fee payable). */
  canEnroll: boolean;
  /** Lever-applied fee if enrolled now. */
  costNow: number;
  /** Lever-applied duration if enrolled now. */
  durationNowMs: number;
  /** Mastery XP this course pays at completion. */
  masteryXp: number;
}

export interface ResearchActiveView {
  courseId: string;
  courseName: string;
  faculty: string;
  enrolledAt: string;
  completesAt: string;
  remainingMs: number;
  /** 0..1 of the snapshotted duration elapsed at the facts' nowMs. */
  progressFraction: number;
  costCredits: number;
  durationMs: number;
}

export interface ResearchStateView {
  courses: ResearchCourseView[];
  faculties: Array<ResearchFaculty & { courseIds: string[] }>;
  activeEnrollment: ResearchActiveView | null;
  /** The player's credit balance (server fact — the panel prices against it). */
  credits: number;
  completedCount: number;
  totalCourses: number;
  /** Most recent completion (the Dashboard completion card reads it). */
  lastCompletion: ResearchCompletionFacts | null;
  /** The resolved bonus record from completions — display + engine parity. */
  bonuses: ResearchBonuses;
  cancelTerms: string;
}

export const RESEARCH_CANCEL_TERMS =
  'Cancelling forfeits the course: progress is lost and the enrollment fee is not refunded. Re-enrolling restarts from zero at the full price.';

const BENCH_NAMES: Record<number, string> = { 2: 'the Forge bench', 3: 'the Lab bench' };

/**
 * Derive the panel view from server facts. Pure: the routes (and
 * the in-memory twin's tests) share this derivation, so the Pg and
 * memory paths can never show different catalogs.
 */
export function researchStateView(
  facts: ResearchFacts,
  levers: ResearchLeverValues,
): ResearchStateView {
  const completedIds = new Set(facts.completed.map((c) => c.courseId));
  const activeId = facts.activeEnrollment?.courseId ?? null;

  const courses: ResearchCourseView[] = RESEARCH_COURSES.map((course) => {
    const terms = researchEnrollmentTerms(course, levers);
    const lockReasons: string[] = [];
    if (course.requiresLevel != null && facts.playerLevel < course.requiresLevel) {
      lockReasons.push(`Requires level ${course.requiresLevel}`);
    }
    if (course.prerequisite && !completedIds.has(course.prerequisite)) {
      lockReasons.push(`Requires ${researchCourse(course.prerequisite)?.name ?? course.prerequisite}`);
    }
    if (course.requiresBench != null && facts.workshopBenches < course.requiresBench) {
      lockReasons.push(`Requires ${BENCH_NAMES[course.requiresBench] ?? `bench ${course.requiresBench}`}`);
    }
    let status: ResearchCourseStatus;
    if (completedIds.has(course.id)) status = 'completed';
    else if (activeId === course.id) status = 'enrolled';
    else if (lockReasons.length > 0) status = 'locked';
    else status = 'available';
    const canEnroll =
      status === 'available' && activeId === null && facts.credits >= terms.costCredits;
    if (status === 'available' && activeId !== null && activeId !== course.id) {
      lockReasons.push('Another course is in progress — complete or cancel it first');
      status = 'locked';
    }
    return {
      ...course,
      status,
      lockReasons,
      canEnroll,
      costNow: terms.costCredits,
      durationNowMs: terms.durationMs,
      masteryXp: researchMasteryXpFor(course),
    };
  });

  let activeEnrollment: ResearchActiveView | null = null;
  if (facts.activeEnrollment) {
    const e = facts.activeEnrollment;
    const completesMs = Date.parse(e.completesAt);
    const enrolledMs = Date.parse(e.enrolledAt);
    const remainingMs = Math.max(0, completesMs - facts.nowMs);
    const progressFraction =
      e.durationMs > 0
        ? Math.min(1, Math.max(0, (facts.nowMs - enrolledMs) / e.durationMs))
        : 1;
    activeEnrollment = {
      courseId: e.courseId,
      courseName: researchCourse(e.courseId)?.name ?? e.courseId,
      faculty: researchCourse(e.courseId)?.faculty ?? '',
      enrolledAt: e.enrolledAt,
      completesAt: e.completesAt,
      remainingMs,
      progressFraction,
      costCredits: e.costCredits,
      durationMs: e.durationMs,
    };
  }

  const lastCompletion =
    facts.completed.length > 0
      ? facts.completed.reduce((a, b) => (a.completedAt >= b.completedAt ? a : b))
      : null;

  return {
    courses,
    faculties: RESEARCH_FACULTIES.map((f) => ({
      ...f,
      courseIds: RESEARCH_COURSES.filter((c) => c.faculty === f.id).map((c) => c.id),
    })),
    activeEnrollment,
    credits: facts.credits,
    completedCount: completedIds.size,
    totalCourses: RESEARCH_COURSES.length,
    lastCompletion,
    bonuses: computeResearchBonuses(completedIds),
    cancelTerms: RESEARCH_CANCEL_TERMS,
  };
}

// ─── Display helpers ─────────────────────────────────────────────────

/** "6 h" / "2 d" / "7 d" for a duration in ms (whole catalog units). */
export function formatResearchDuration(durationMs: number): string {
  const hours = durationMs / 3_600_000;
  if (hours < 24) return `${Math.round(hours * 10) / 10} h`;
  const days = hours / 24;
  return `${Math.round(days * 10) / 10} d`;
}

/** "3 d 7 h left" style remaining-time label for chips + the G-3 track. */
export function formatResearchRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return 'complete';
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h left`;
  if (hours > 0) return `${hours} h ${minutes} m left`;
  return `${minutes} m left`;
}
