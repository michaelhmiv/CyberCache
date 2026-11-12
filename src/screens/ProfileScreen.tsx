import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

import { useActivityStore, useInventoryStore, usePlayerStore, useSkillStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/api/statsService';
import { formatKillDeathRatio, killDeathRatio } from '@/lib/stats/statsHelpers';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { xpToNextLevel } from '@/content/simulation';
import { MobileCard } from '@/components/layout/MobileCard';
import { WorldPulseFeed } from '@/components/profile/WorldPulseFeed';
import { MasterySection } from '@/components/profile/MasterySection';
import { CacheRankPanel } from '@/components/profile/CacheRankPanel';
import { ResearchPanel } from '@/components/profile/ResearchPanel';
import { TrophyShelfPanel } from '@/components/profile/TrophyShelfPanel';
import { WardrobePanel } from '@/components/profile/WardrobePanel';
import { useStandingsBadge } from '@/components/profile/standingsBadge';
import { ProfileRecordTelemetry } from '@/components/profile/ProfileRecordTelemetry';
import {
  TM_AMBER,
  TM_FAINT,
  TM_INK,
  TM_STEEL,
  tmHeadStyle,
  tmMonoStyle,
} from '@/components/profile/profileTelemetryTheme';
import {
  TmDoorKey,
  TmPanel,
  TmPushButton,
} from '@/components/profile/profileTelemetry';
import {
  HunterPlateHero,
  PlatesBackRow,
  PlatesDoor,
  PlatesTreesDoor,
  PlatesWideDoor,
  type HubDoorDatum,
  type ResearchStatusLine,
} from '@/components/profile/HunterPlates';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { getResearchState } from '@/lib/chef/chefClient';
import type { ResearchStateView } from '@/content/research';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { SkillTreeScreen } from './SkillTreeScreen';
import { CollectionsScreen } from './CollectionsScreen';
import { LeaderboardsScreen } from './LeaderboardsScreen';
import { useAuth } from '@/auth/AuthProvider';
import { isGuestAccount } from '@/auth/accountState';
import { getMyProfileSummary, type ProfileSummary } from '@/lib/api/usernameService';
import { UsernameSetupModal } from '@/components/profile/UsernameSetupModal';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';
import { StatDetailPanel } from '@/components/profile/StatDetailPanel';
import { type ProgressionMetric } from '@/lib/api/progressionService';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';

interface ProfileScreenProps {
  onNavigate?: (screen: string) => void;
  /**
   * Deep-link focus (device feedback r2): 'skills' lands the player
   * on the Hunter → Skill Trees stop — the Dashboard "Skill Trees"
   * action routes here, so the player lands on the trees
   * themselves instead of the top of the Profile stop.
   */
  focusSection?: 'skills' | 'research' | 'wardrobe' | null;
}

/**
 * Hunter (Arena Plates menu, owner pick 2026-11-05; DESIGN.md
 * §2/§3) — the tab opens on a MENU, not a rail: a hero plate
 * (identity + announcements) over live-status doors in the Arena
 * Plates register (HunterPlates.tsx). Every stop is a destination
 * behind its door: Skill Trees first (Mastery is its segment),
 * Research, Cache Rank, Standings (the leaderboards behind the
 * badged door), Collections (the 81 proofs), Wardrobe (its own
 * stop — cosmetics demoted to the tail), Account (identity plate +
 * tools: link, settings, field manual, sign-out), and Profile &
 * Record last (identity, Trophy Shelf, the Standings door,
 * lifetime record). Every stop carries the plate back row to the
 * menu; there is no rail.
 */
type HunterStop = 'hub' | 'profile' | 'collections' | 'cacheRank' | 'research' | 'trees' | 'standings' | 'account' | 'wardrobe';

const STOP_LABELS: Record<Exclude<HunterStop, 'hub'>, string> = {
  profile: 'Profile & Record',
  collections: 'Collections',
  cacheRank: 'Cache Rank',
  research: 'Research',
  trees: 'Skill Trees',
  standings: 'Standings',
  account: 'Account',
  wardrobe: 'Wardrobe',
};

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const ActionRow: React.FC<{ glyph?: string; icon?: PxIconName; label: string; desc: string; onClick: () => void; tone?: string; testId?: string }> = ({ glyph, icon, label, desc, onClick, tone = '#FF9000', testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: tone, borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-10 w-10 shrink-0 items-center justify-center font-black" style={{ backgroundColor: `${tone}18`, color: tone, fontSize: '18px' }}>
      {icon ? <PxIcon name={icon} size={17} /> : glyph}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-black uppercase tracking-wide text-text-primary">{label}</div>
      {/* Audit DISP-02: descriptions wrap to two lines — never cut
          mid-word (the row has the full card width; nothing here may
          ellipsize a description). */}
      <div className="text-[10px] leading-snug text-text-muted [overflow-wrap:anywhere]">{desc}</div>
    </div>
  </button>
);

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate, focusSection = null }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const skillStore = useSkillStore();
  const deathLog = useSurvivalStore((s) => s.deathLog);
  const { account, user, signOut, signInWithGoogle, actionLoading } = useAuth();
  const [stats, setStats] = useState<PlayerPublicStats | null>(null);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [detailMetric, setDetailMetric] = useState<{ metric: ProgressionMetric; leaderboardMetric?: LeaderboardMetric; label: string; value: number; color: string } | null>(null);
  // Totals & Sources (Home consolidation, 2026-11-03): the full
  // all-metrics source breakdown lives behind this door now —
  // the deck's Hunter Totals panel is retired, and Home's hero
  // rundown covers the per-stat focused form. The summary is the
  // one shared assembly (no boss context: the standing build).
  const [totalsOpen, setTotalsOpen] = useState(false);
  const { summary: totalsSummary } = useCharacterStatSummary();
  const activityKind = useActivityStore((s) => s.current.kind);
  const [stop, setStop] = useState<HunterStop>(() => (focusSection === 'skills' ? 'trees' : focusSection === 'research' ? 'research' : focusSection === 'wardrobe' ? 'wardrobe' : 'hub'));
  const standingsBadge = useStandingsBadge();
  // The hub's Research door reports the real enrollment — the same
  // Chef research state the ResearchPanel renders. Loaded here so
  // the menu can print the course + progress before any stop opens;
  // a failed read leaves the door on its catalog line (no lure).
  const [researchState, setResearchState] = useState<ResearchStateView | null>(null);
  // Door taps ask the Standings earnings panel to scroll itself
  // into view + highlight: the badge's destination is the panel,
  // not just the page.
  const [earningsFocusNonce, setEarningsFocusNonce] = useState(0);
  const reduceMotion = useReducedMotion();

  const goToStop = React.useCallback((next: HunterStop) => {
    setStop(next);
  }, []);

  // Deep-link focus: 'skills' lands on the Skill Trees stop. The
  // stop adjusts during render when the focus prop changes (the
  // React-endorsed derived-state pattern — no effect needed).
  const [prevFocusSection, setPrevFocusSection] = useState(focusSection);
  if (focusSection !== prevFocusSection) {
    setPrevFocusSection(focusSection);
    if (focusSection === 'skills') goToStop('trees');
    if (focusSection === 'research') goToStop('research');
    if (focusSection === 'wardrobe') goToStop('wardrobe');
  }

  // Deep-link focus: when the player arrives via the Dashboard
  // "Skill Trees" action, bring the embedded SkillTreeScreen to them
  // once its stop is the lit one.
  const skillTreesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusSection !== 'skills' || stop !== 'trees') return;
    const el = skillTreesRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusSection, stop]);

  // Deep-link focus: 'wardrobe' arrives from the Gear page's
  // figure-stage door (Exec C) — since the Arena Plates menu the
  // Wardrobe is its own stop, so the focus lands on the stop
  // itself; no scroll anchor is needed.

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyStatsSummary().then((data) => {
      if (cancelled) return;
      setStats(data);
    });
    getMyProfileSummary().then((data) => {
      if (cancelled) return;
      setProfileSummary(data);
    });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (typeof getResearchState !== 'function') return;
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setResearchState(result.research);
      })
      .catch(() => {
        // Chef unreachable: the Research door stays on its
        // catalog line.
      });
    return () => { cancelled = true; };
  }, []);

  const weapons = inventory.getWeapons();
  const totalItems = inventory.items.length;
  const xpToNext = xpToNextLevel(player.level);
  // Clamped (audit HTR-06): banked XP past a threshold — above all
  // at the level cap — must never print a progress over 100%.
  const xpProgress = Math.min(100, Math.round((player.xp / xpToNext) * 100));
  // Budget points spent — weighted by listed cost (audit HTR-01), so the
  // hub's spent/available story agrees with the tree screen and the server.
  const spentSkillPoints = skillStore.getSpentBudget();
  const availableSkillPoints = Math.max(0, player.level - 1 - spentSkillPoints);
  const verifiedLabel = account?.accountType === 'verified'
    ? 'Verified account'
    : account?.accountType === 'guest'
      ? 'Guest account'
      : 'Email verification pending';

  // ── The hub (Arena Plates menu) ────────────────────────────────
  // Every door's status derives from the real profile at render:
  // per-tree spent from the skill store, the research line from the
  // Chef state above, wardrobe counts from the cosmetics view (the
  // same store the Wardrobe panel reads), the standings badge from
  // the weekly-races payload, cores from the player record.
  const cosmeticsView = useCosmeticsStore((s) => s.view);
  const wardrobePartsOwned = cosmeticsView?.parts.length ?? 0;
  const wardrobePartsWorn = Object.keys(cosmeticsView?.selection.equipped ?? {}).length;
  const treeSpent = [SkillTreeType.Gunslinger, SkillTreeType.Demolition, SkillTreeType.Scavenger, SkillTreeType.Fixer].map((tree) => ({
    label: String(tree),
    spent: getSkillTreeNodes(tree).reduce((sum, node) => sum + (skillStore.spent[node.id] || 0), 0),
  }));
  const researchLine: ResearchStatusLine | null = researchState?.activeEnrollment
    ? {
        courseLabel: researchState.activeEnrollment.courseName,
        progress: researchState.activeEnrollment.progressFraction,
      }
    : null;

  const hubDoors: HubDoorDatum[] = [
    {
      testId: 'hub-door-trees', icon: 'nodes', label: 'Skill Trees',
      status: availableSkillPoints > 0 ? `${availableSkillPoints} points unspent` : 'All points spent',
      hero: availableSkillPoints > 0 ? String(availableSkillPoints) : undefined,
      onClick: () => goToStop('trees'),
    },
    {
      testId: 'hub-door-research', icon: 'book', label: 'Research',
      status: researchLine ? `${researchLine.courseLabel} · in progress` : 'Course catalog · the parallel track',
      hero: researchLine ? `${Math.round(researchLine.progress * 100)}%` : undefined,
      onClick: () => goToStop('research'),
    },
    {
      testId: 'hub-door-cache-rank', icon: 'chevs', label: 'Cache Rank',
      status: 'Tracks, ranks, and token spend',
      onClick: () => goToStop('cacheRank'),
    },
    {
      testId: 'hub-door-standings', icon: 'flag', label: 'Standings',
      status: 'Weekly races · rewards auto-pay at settlement',
      badge: standingsBadge.unseenEarningsCount,
      badgeTestId: 'hunter-standings-count',
      onClick: () => {
        goToStop('standings');
        setEarningsFocusNonce((n) => n + 1);
      },
    },
    {
      testId: 'hub-door-collections', icon: 'shelf', label: 'Collections',
      status: 'The 81 proofs · legendary cores',
      hero: player.legendaryCores > 0 ? String(player.legendaryCores) : undefined,
      onClick: () => goToStop('collections'),
    },
    {
      testId: 'hub-door-wardrobe', icon: 'person', label: 'Wardrobe',
      status: wardrobePartsOwned > 0 ? `${wardrobePartsWorn} worn · ${wardrobePartsOwned} owned · pure cosmetic` : 'Skin parts · pure cosmetic — zero stats',
      onClick: () => goToStop('wardrobe'),
    },
    {
      testId: 'hub-door-account', icon: 'cog', label: 'Account',
      status: verifiedLabel,
      onClick: () => goToStop('account'),
    },
    {
      testId: 'hub-door-profile', icon: 'chart', label: 'Profile & Record',
      status: 'Identity · trophy shelf · lifetime record · totals & sources',
      quiet: true,
      onClick: () => goToStop('profile'),
    },
  ];

  const typeCounts: Record<string, number> = {};
  weapons.forEach((w) => { typeCounts[w.weaponType] = (typeCounts[w.weaponType] || 0) + 1; });
  const favoriteType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  // The current-activity data (label / target / scene) is read by
  // the Now feed itself (WorldPulseFeed) since drift-fix F4 merged
  // the Current Activity card into it — this screen no longer
  // derives a second copy.

  // K/D is arithmetic on the two numbers printed beside it — kills
  // and deaths from this same stats summary. The summary's ratio
  // field is null at zero deaths (the public-stats convention:
  // kills / NULLIF(deaths, 0)), and the pre-fix render coerced that
  // null to 0.00, printing a ratio no ledger supports next to
  // "12 kills / 0 deaths" (gear-truth slice). Zero deaths means no
  // ratio exists yet — '—', the public profile's own convention.
  const kdRatio = stats ? killDeathRatio(stats.total_kills, stats.total_deaths) : null;
  const kdText = stats ? formatKillDeathRatio(stats.total_kills, stats.total_deaths) : '—';

  const openDetail = (payload: { metric: ProgressionMetric; leaderboardMetric?: LeaderboardMetric; label: string; value: number; color: string }) => {
    setDetailMetric(payload);
  };

  // Perf (tab-switch latency, 2026-11-12): ONLY the active stop is
  // in the DOM. The previous shape rendered every stop at once and
  // hid the inactive ones with CSS (~2,485 DOM nodes on HUNTER),
  // so every tab switch paid the full subtree's layout/paint cost.
  // Unselected sections are absent — see
  // src/test/hunterLazySections.test.tsx.
  const stopSection = (id: HunterStop, children: React.ReactNode) => {
    if (stop !== id) return null;
    return (
      <motion.section
        key={id}
        data-testid={`hunter-section-${id}`}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        className="space-y-2"
      >
        {children}
      </motion.section>
    );
  };

  return (
    <div className="bl-page space-y-2 p-4 pb-20">
      <ResourceBar onOpenSettings={() => onNavigate?.('settings')} />

      {stopSection('hub', (
        <>
          {/* The menu (Arena Plates, owner pick 2026-11-05): hero
              plate + live-status doors. Skill Trees lead with the
              build itself; progression substance rides above the
              tail, where Wardrobe and Account sit demoted by
              position; Profile & Record closes the menu as the
              wide door. Every former rail resident has a door —
              no feature lost, no dead doors. */}
          <HunterPlateHero
            level={player.level}
            name={player.name}
            handleLine={(
              <>
                <span className={account?.hasUsername ? 'font-bold text-amber' : undefined}>
                  {account?.hasUsername ? `@${account.username ?? profileSummary?.username}` : 'No handle set'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Level {player.level}</span>
              </>
            )}
            xp={player.xp}
            xpToNext={xpToNext}
            xpProgress={xpProgress}
            availableSkillPoints={availableSkillPoints}
            earningsCount={standingsBadge.unseenEarningsCount}
            research={researchLine}
            onOpenTrees={() => goToStop('trees')}
            onOpenStandings={() => {
              goToStop('standings');
              setEarningsFocusNonce((n) => n + 1);
            }}
            onOpenResearch={() => goToStop('research')}
          />
          <PlatesTreesDoor door={hubDoors[0]} treeSpent={treeSpent} points={availableSkillPoints} />
          <div className="grid grid-cols-2 gap-2">
            <PlatesDoor door={hubDoors[1]} />
            <PlatesDoor door={hubDoors[2]} />
            <PlatesDoor door={hubDoors[3]} />
            <PlatesDoor door={hubDoors[4]} />
            <PlatesDoor door={hubDoors[5]} />
            <PlatesDoor door={hubDoors[6]} />
          </div>
          <PlatesWideDoor door={hubDoors[7]} />
        </>
      ))}

      {stopSection('profile', (
        <>
      <PlatesBackRow stopLabel={STOP_LABELS.profile} onBack={() => goToStop('hub')} />
      {/* Profile & Record in Register B, "Service Telemetry"
          (Instrument Panel; owner pick from the Hunter sub-page
          review PDF, 2026-11-05): identity as a unit readout,
          combat as channels, the lifetime record as one readout
          bank — every number printed exactly once, with the
          per-metric Totals drill-down riding the wells and rows.
          The composition lives in ProfileRecordTelemetry. */}
      <ProfileRecordTelemetry
        name={player.name}
        level={player.level}
        xp={player.xp}
        xpToNext={xpToNext}
        xpProgress={xpProgress}
        credits={player.credits}
        scrap={player.scrap}
        cacheKeys={player.cacheKeys}
        handle={account?.hasUsername ? `@${account.username ?? profileSummary?.username}` : null}
        canRename={!!account && !account.isAnonymous}
        canSetUsername={!!account && !account.isAnonymous}
        onRename={() => setRenameOpen(true)}
        onSetUsername={() => setSetupOpen(true)}
        verifiedLabel={verifiedLabel}
        accountVerified={account?.accountType === 'verified'}
        researchStudiedPct={researchState && researchState.totalCourses > 0 ? Math.round((researchState.completedCount / researchState.totalCourses) * 100) : null}
        researchActive={researchLine ? { courseLabel: researchLine.courseLabel, progressPct: Math.round(researchLine.progress * 100) } : null}
        treeSpent={treeSpent}
        availableSkillPoints={availableSkillPoints}
        onOpenTrees={() => goToStop('trees')}
        stats={stats}
        kdText={kdText}
        kdRatio={kdRatio}
        deathLog={deathLog}
        totalItemsFallback={totalItems}
        weaponsCountFallback={weapons.length}
        uniqueAffixes={new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}
        favoriteType={favoriteType ? favoriteType[0] : null}
        openDetail={openDetail}
      />

      {/* Now — the single merged feed (drift-fix F4, mock m36;
          DESIGN.md's Now law), reframed as a telemetry panel:
          current activity + World Pulse one-liners + the Killed
          By record in ONE panel. Every datum from those cards
          survives: Status is the feed's activity lead, Target and
          Scene ride its detail line, and the death record is the
          feed's final section. */}
      <TmPanel>
        <div className="mb-2.5 flex items-baseline gap-2">
          <div className="text-xs font-black uppercase tracking-wide" style={{ ...tmHeadStyle, color: TM_INK }}>Now</div>
          <div className="ml-auto text-right text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>One feed — activity, milestones, records</div>
        </div>
        <WorldPulseFeed>
          <div className="border-t border-border/60 pt-2">
            <div className="flex items-center gap-2">
              <PxIcon name="skull" size={15} className="text-red" />
              <div className="text-[11px] font-black uppercase tracking-wide text-text-primary">Killed By</div>
              <div className="ml-auto text-[11px] text-text-muted">{deathLog.length} recorded</div>
            </div>
            {deathLog.length === 0 ? (
              <div className="mt-1 text-[11px] text-text-muted">No deaths on file. Stay sharp out there.</div>
            ) : (
              <ul data-testid="death-log" className="mt-1 space-y-1 text-xs text-text-secondary">
                {deathLog.slice(0, 10).map((entry, i) => (
                  <li
                    key={`${entry.at}-${i}`}
                    data-testid="death-log-entry"
                    data-monster-id={entry.monsterId}
                    data-area-id={entry.areaId}
                    className="flex items-center justify-between gap-3 border-b border-border/40 pb-1 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1 break-words font-bold text-text-primary">{entry.monsterName}</div>
                    <div className="break-words text-[11px] text-text-muted">{resolveSceneLabel(entry.areaId)}</div>
                    <div className="shrink-0 text-[11px] text-text-muted">
                      {new Date(entry.at).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </WorldPulseFeed>
      </TmPanel>

      {/* Pinned Units — the Trophy Shelf as a spec sheet. The
          Wardrobe is NOT on this stop: the Arena Plates menu
          gives it its own door and stop (owner-approved,
          2026-11-05); the Gear page's figure-stage door (Exec C)
          lands there via the 'wardrobe' focus. */}
      <TrophyShelfPanel bare onOpenCollections={() => goToStop('collections')} />

      {/* Totals & Sources — the full source breakdown's home
          (Home consolidation): every effective stat with every
          contributor. Home's rundown heroes open the focused
          single-stat form of this same sheet. */}
      <TmPushButton
        label="Totals & Sources"
        sub="Every effective stat for your current build — and exactly where each number comes from"
        ledColor={TM_AMBER}
        accent={TM_AMBER}
        testId="profile-totals-sources-door"
        onClick={() => setTotalsOpen(true)}
      />

      {/* The doors row (prototype's raised keys): Standings
          carries its live race pills inside the key — the badge
          derives from the real weekly payload (standingsBadge.ts)
          and prints nothing without data behind it. The earnings
          pill is a NOTICE, not a claim prompt: weekly race
          rewards pay out automatically at settlement. */}
      <div className="grid grid-cols-3 gap-1.5">
        <TmDoorKey
          label="Standings"
          icon={<PxIcon name="flag" size={17} />}
          testId="standings-door"
          onClick={() => {
            goToStop('standings');
            setEarningsFocusNonce((n) => n + 1);
          }}
        >
          {(standingsBadge.unseenEarningsCount > 0 || standingsBadge.endsSoon || standingsBadge.buff || (standingsBadge.endsAt && !standingsBadge.endsSoon)) && (
            <span className="mt-0.5 flex flex-col items-center gap-1">
              {standingsBadge.endsAt && !standingsBadge.endsSoon && (
                <span className="text-[11px] leading-tight" style={{ ...tmMonoStyle, color: TM_FAINT }}>
                  Week closes {shortDay(standingsBadge.endsAt)}
                </span>
              )}
              {standingsBadge.unseenEarningsCount > 0 && (
                <span
                  data-testid="standings-earnings-pill"
                  className="relative inline-flex items-center gap-1 border border-amber/60 bg-amber/15 px-1.5 py-0.5 text-[11px] font-black text-amber"
                >
                  <PxIcon name="trophy" size={13} />
                  {standingsBadge.unseenEarningsCount} race {standingsBadge.unseenEarningsCount === 1 ? 'reward' : 'rewards'} earned
                </span>
              )}
              {standingsBadge.endsSoon && standingsBadge.endsAt && (
                <span
                  data-testid="standings-ends-soon-pill"
                  className="inline-flex items-center gap-1 border border-red/60 bg-red/10 px-1.5 py-0.5 text-[11px] font-black text-red"
                >
                  <PxIcon name="clock" size={13} />
                  Ends soon · {shortDay(standingsBadge.endsAt)}
                </span>
              )}
              {standingsBadge.buff && (
                <span
                  data-testid="standings-buff-pill"
                  className="inline-flex items-center gap-1 border border-green/50 bg-green/10 px-1.5 py-0.5 text-[11px] font-black text-green"
                >
                  <PxIcon name="burst" size={13} />
                  Drop luck +{Math.round(standingsBadge.buff.bonus * 100)}%
                </span>
              )}
            </span>
          )}
        </TmDoorKey>
        <TmDoorKey
          label="Activity"
          icon={<PxIcon name="book" size={17} />}
          testId="activity-log-door"
          onClick={() => onNavigate?.('activity-log')}
        />
        <TmDoorKey
          label="Account"
          icon={<PxIcon name="cog" size={17} />}
          onClick={() => goToStop('account')}
        />
      </div>
      <div className="pb-1 text-center text-[11px]" style={{ ...tmMonoStyle, color: TM_STEEL }}>
        END OF RECORD — {(stats?.total_kills ?? 0).toLocaleString('en-US')} KILLS ON FILE
      </div>
        </>
      ))}

      {stopSection('collections', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.collections} onBack={() => goToStop('hub')} />
          <CollectionsScreen embedded />
        </>
      ))}

      {stopSection('cacheRank', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.cacheRank} onBack={() => goToStop('hub')} />
          <CacheRankPanel />
        </>
      ))}

      {stopSection('research', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.research} onBack={() => goToStop('hub')} />
          <ResearchPanel />
        </>
      ))}

      {stopSection('trees', (
        <>
      <PlatesBackRow stopLabel={STOP_LABELS.trees} onBack={() => goToStop('hub')} />
      <div
        ref={skillTreesRef}
        data-testid="profile-skill-trees"
        className={focusSection === 'skills' ? 'scroll-mt-2 rounded-xl ring-2 ring-purple' : 'scroll-mt-2'}
      >
        {/* No card header here: the plate back row prints the
            stop's name (every header prints once), and the screen
            below wears the plate register itself — its stats row
            carries the available-points count the retired card
            header used to print. */}
        <SkillTreeScreen embedded />
      </div>

      <MasterySection />
        </>
      ))}

      {stopSection('standings', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.standings} onBack={() => goToStop('hub')} />
          <LeaderboardsScreen embedded focusEarningsNonce={earningsFocusNonce} />
        </>
      ))}

      {stopSection('wardrobe', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.wardrobe} onBack={() => goToStop('hub')} />
          {/* The Wardrobe's own stop (Arena Plates menu): the
              skin-part showcase + wear/remove surface, homed
              behind its own door at the menu's tail. The wrapper
              keeps the deep-link anchor testid the panel carried
              on the Profile stop. */}
          <div data-testid="profile-wardrobe-anchor" className="scroll-mt-2">
            <WardrobePanel />
          </div>
        </>
      ))}

      {stopSection('account', (
        <>
      <PlatesBackRow stopLabel={STOP_LABELS.account} onBack={() => goToStop('hub')} />
      <MobileCard className="space-y-2" rarityColor="#7CFC00">
        <div className="flex items-center gap-2">
          <PxIcon name="diamondIn" size={17} className="text-green" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Account Plate</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3"><span>Status</span><span className="text-right font-bold text-text-primary">{verifiedLabel}</span></div>
          <div className="flex justify-between gap-3"><span>Email</span><span className="truncate text-right font-bold text-text-primary">{account?.email ?? user?.email ?? 'None'}</span></div>
          <div className="flex justify-between gap-3"><span>User ID</span><span className="max-w-[170px] truncate text-right text-text-muted">{account?.userId ?? 'Not loaded'}</span></div>
        </div>
      </MobileCard>

      <div className="space-y-2">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Account Tools</div>
        {/* Guests get a deliberate path to link Google (flow-fix F9):
            linking upgrades the guest in place server-side, keeping
            all progress. Before this row the only link entry points
            were the sign-in screen a signed-in guest never sees again
            and the locked-feature wall. */}
        {isGuestAccount(account) && (
          <ActionRow glyph="G" label={actionLoading ? 'Linking…' : 'Link Google'} desc="Keep your progress — upgrade this guest account in place and unlock trading, services, and leaderboards" onClick={() => signInWithGoogle()} tone="#5AA7FF" />
        )}
        <ActionRow icon="cog" label="Settings" desc="Preferences, display, and local save controls" onClick={() => onNavigate?.('settings')} tone="#9CA3AF" />
        <ActionRow glyph="?" label="Field Manual" desc="Mechanics, progression, caches, combat, and economy rules" onClick={() => onNavigate?.('help')} tone="#F7D20B" />
        <ActionRow icon="star" label="Collections" desc="The trophy shelf — effects, bosses, frames, and named elites you've proven, plus your legendary cores" onClick={() => goToStop('collections')} tone="#FF9800" />
        <ActionRow icon="person" label="Identity" desc="Manage your public hunter name and profile identity" onClick={() => (account?.username || profileSummary?.username ? setRenameOpen(true) : setSetupOpen(true))} tone="#5AA7FF" />
        <ActionRow icon="power" label={actionLoading ? 'Signing out…' : 'Sign Out'} desc="End this CyberCache session on this device" onClick={() => signOut()} tone="#FF4B5C" />
      </div>
        </>
      ))}

      {setupOpen && (
        <UsernameSetupModal
          force={false}
          onComplete={() => {
            setSetupOpen(false);
            getMyProfileSummary().then(setProfileSummary);
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
      {renameOpen && (
        <UsernameSetupModal
          mode="rename"
          force={false}
          currentUsername={account?.username ?? profileSummary?.username}
          canRenameAt={profileSummary?.can_rename_at}
          onComplete={() => {
            setRenameOpen(false);
            getMyProfileSummary().then(setProfileSummary);
          }}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {detailMetric && (
        <StatDetailPanel
          open={!!detailMetric}
          onClose={() => setDetailMetric(null)}
          metric={detailMetric.metric}
          leaderboardMetric={detailMetric.leaderboardMetric}
          label={detailMetric.label}
          value={detailMetric.value}
          color={detailMetric.color}
        />
      )}
      {totalsOpen && (
        <CharacterStatBreakdownModal
          summary={totalsSummary}
          open={totalsOpen}
          onClose={() => setTotalsOpen(false)}
          activityKind={activityKind}
        />
      )}
    </div>
  );
};
