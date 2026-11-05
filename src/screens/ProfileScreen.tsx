import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

import { useActivityStore, useInventoryStore, usePlayerStore, useSkillStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/api/statsService';
import { formatDuration, formatKillDeathRatio, killDeathRatio, topBreakdown } from '@/lib/stats/statsHelpers';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { xpToNextLevel } from '@/content/simulation';
import { MobileCard } from '@/components/layout/MobileCard';
import { WorldPulseFeed } from '@/components/profile/WorldPulseFeed';
import { MasterySection } from '@/components/profile/MasterySection';
import { CacheRankPanel } from '@/components/profile/CacheRankPanel';
import { ResearchPanel } from '@/components/profile/ResearchPanel';
import { TrophyShelfPanel } from '@/components/profile/TrophyShelfPanel';
import { WardrobePanel } from '@/components/profile/WardrobePanel';
import { LifetimeStatsPanel } from '@/components/profile/LifetimeStatsPanel';
import { ActivityLogDoor } from '@/components/profile/ActivityLogDoor';
import { StandingsDoor } from '@/components/profile/StandingsDoor';
import { useStandingsBadge } from '@/components/profile/standingsBadge';
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
import { StatCard } from '@/components/profile/StatCard';
import { StatDetailPanel } from '@/components/profile/StatDetailPanel';
import { ProgressionHistoryCard } from '@/components/progression/ProgressionHistoryCard';
import { getMyProgressionSnapshots, type ProgressionMetric } from '@/lib/api/progressionService';
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
  const [snapshots, setSnapshots] = useState<Array<{ snapshot_at: string; [key: string]: unknown }>>([]);
  const [stop, setStop] = useState<HunterStop>(() => (focusSection === 'skills' ? 'trees' : focusSection === 'research' ? 'research' : focusSection === 'wardrobe' ? 'wardrobe' : 'hub'));
  // Stops whose content mounts lazily on first visit and stays
  // mounted (the two full screens: Collections, Standings) — the
  // always-resident stops are the panels that already lived here.
  const [visitedStops, setVisitedStops] = useState<ReadonlySet<HunterStop>>(() => new Set<HunterStop>(['hub']));
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
    setVisitedStops((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
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
    getMyProgressionSnapshots({ limit: 30 }).then((data) => {
      if (cancelled) return;
      setSnapshots(data);
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
  const xpProgress = Math.round((player.xp / xpToNext) * 100);
  const spentSkillPoints = skillStore.getTotalSpent();
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
  const topAreas = topBreakdown(stats?.kills_by_area, 3);
  const topWeaponTypes = topBreakdown(stats?.kills_by_weapon_type, 3);

  // K/D is arithmetic on the two numbers printed beside it — kills
  // and deaths from this same stats summary. The summary's ratio
  // field is null at zero deaths (the public-stats convention:
  // kills / NULLIF(deaths, 0)), and the pre-fix render coerced that
  // null to 0.00, printing a ratio no ledger supports next to
  // "12 kills / 0 deaths" (gear-truth slice). Zero deaths means no
  // ratio exists yet — '—', the public profile's own convention.
  const kdRatio = stats ? killDeathRatio(stats.total_kills, stats.total_deaths) : null;
  const kdText = stats ? formatKillDeathRatio(stats.total_kills, stats.total_deaths) : '—';

  const sparklineFor = (metric: ProgressionMetric): number[] => {
    return snapshots.map((s) => (typeof s[metric] === 'number' ? (s[metric] as number) : 0));
  };

  const openDetail = (payload: { metric: ProgressionMetric; leaderboardMetric?: LeaderboardMetric; label: string; value: number; color: string }) => {
    setDetailMetric(payload);
  };

  const stopSection = (id: HunterStop, children: React.ReactNode) => (
    <motion.section
      key={id}
      data-testid={`hunter-section-${id}`}
      initial={false}
      animate={{ opacity: stop === id ? 1 : 0, y: stop === id ? 0 : 6 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      className={stop === id ? 'space-y-4' : 'hidden'}
      aria-hidden={stop !== id}
    >
      {children}
    </motion.section>
  );

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
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
      {/* Identity + Trophy Shelf share ONE panel (drift-fix F4,
          mock m36): compact identity line on top, the shelf section
          below it. The XP bar is NOT repeated here — it lives in
          the Strip (F1); this panel prints the XP numbers only. */}
      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center border-2 border-amber bg-amber/15 text-xl font-black text-amber">
            {player.level}
          </div>
          <div className="min-w-0 flex-1">
            <div className="break-words text-[19px] font-black uppercase leading-tight tracking-wide text-text-primary">{player.name}</div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
              {account?.hasUsername ? (
                <>
                  <span className="font-bold text-amber">@{account.username ?? profileSummary?.username}</span>
                  {account && !account.isAnonymous && (
                    <button
                      onClick={() => setRenameOpen(true)}
                      className="text-[11px] underline hover:text-amber"
                    >
                      Rename
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span>No handle set</span>
                  {account && !account.isAnonymous && (
                    <button
                      onClick={() => setSetupOpen(true)}
                      className="text-amber underline"
                    >
                      Set username
                    </button>
                  )}
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Level {player.level}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">{player.xp} / {xpToNext} XP ({xpProgress}%)</div>
          </div>
        </div>

        <TrophyShelfPanel bare onOpenCollections={() => goToStop('collections')} />
      </MobileCard>

      {/* Totals & Sources — the full source breakdown's home
          (Home consolidation): every effective stat with every
          contributor, the surface the deck's Hunter Totals panel
          used to host. Home's rundown heroes open the focused
          single-stat form of this same sheet. */}
      <ActionRow
        icon="chart"
        label="Totals & Sources"
        desc="Every effective stat for your current build — and exactly where each number comes from"
        tone="#FF9000"
        testId="profile-totals-sources-door"
        onClick={() => setTotalsOpen(true)}
      />

      {/* The Wardrobe is NOT on this stop anymore: the Arena
          Plates menu gives it its own door and its own stop
          (owner-approved, 2026-11-05) — cosmetics demoted to the
          menu's tail. The panel itself lives on the wardrobe
          stop below; the Gear page's figure-stage door (Exec C)
          lands there via the 'wardrobe' focus. */}

      <StandingsDoor
        badge={standingsBadge}
        onOpen={() => {
          goToStop('standings');
          setEarningsFocusNonce((n) => n + 1);
        }}
      />

      {/* Now — the single merged feed (drift-fix F4, mock m36;
          DESIGN.md's Now law): current activity + World Pulse
          one-liners + the Killed By record in ONE panel, replacing
          the three stacked cards (Current Activity / World Pulse /
          Killed By). Every datum from those cards survives: Status
          is the feed's activity lead, Target and Scene ride its
          detail line, and the death record is the feed's final
          section. */}
      <MobileCard className="space-y-2" rarityColor="#5AA7FF">
        <div className="flex items-baseline gap-2">
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Now</div>
          <div className="ml-auto text-right text-[11px] text-text-muted">One feed — activity, milestones, records</div>
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
      </MobileCard>

      <LifetimeStatsPanel />

      {/* AL-3 second door: the totals above say what you have; the
          log says how it happened. */}
      <ActivityLogDoor onOpen={() => onNavigate?.('activity-log')} />

      <div className="space-y-3">
        {/* Hunter level/XP and Mastery XP/levels are SEPARATE
            progression systems (gear-truth slice): masteries are
            per-track profession XP that accrue independently of the
            hunter's level, so the two pairs get their own labeled
            groups instead of one undifferentiated "Progression"
            grid where a Mastery Lv 6 sat unexplained beside a
            Hunter Level 1. */}
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Hunter</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Hunter Level" value={stats?.player_level ?? player.level} color="#FF9000" metric="level" leaderboardMetric="level" sparklineValues={sparklineFor('level')} onClick={() => openDetail({ metric: 'level', leaderboardMetric: 'level', label: 'Hunter Level', value: stats?.player_level ?? player.level, color: '#FF9000' })} />
          <StatCard label="Hunter XP" value={stats?.player_xp ?? player.xp} color="#FF9000" metric="xp" leaderboardMetric="xp" sparklineValues={sparklineFor('xp')} onClick={() => openDetail({ metric: 'xp', leaderboardMetric: 'xp', label: 'Hunter XP', value: stats?.player_xp ?? player.xp, color: '#FF9000' })} />
        </div>

        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Masteries</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Mastery XP (all tracks)" value={stats?.total_mastery_xp ?? 0} color="#7CFC00" metric="total_mastery_xp" leaderboardMetric="total_mastery_xp" sparklineValues={sparklineFor('total_mastery_xp')} onClick={() => openDetail({ metric: 'total_mastery_xp', leaderboardMetric: 'total_mastery_xp', label: 'Mastery XP (all tracks)', value: stats?.total_mastery_xp ?? 0, color: '#7CFC00' })} />
          <StatCard label="Highest Mastery Lv" value={stats?.highest_mastery_level ?? 0} color="#7CFC00" metric="highest_mastery_level" leaderboardMetric="highest_mastery_level" sparklineValues={sparklineFor('highest_mastery_level')} onClick={() => openDetail({ metric: 'highest_mastery_level', leaderboardMetric: 'highest_mastery_level', label: 'Highest Mastery Level', value: stats?.highest_mastery_level ?? 0, color: '#7CFC00' })} />
        </div>

        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Combat</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Kills" value={stats?.total_kills ?? 0} color="#FF4B5C" metric="total_kills" leaderboardMetric="total_kills" sparklineValues={sparklineFor('total_kills')} onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'total_kills', label: 'Kills', value: stats?.total_kills ?? 0, color: '#FF4B5C' })} />
          <StatCard label="Deaths" value={stats?.total_deaths ?? 0} color="#FF4B5C" metric="total_deaths" sparklineValues={sparklineFor('total_deaths')} />
          <StatCard label="K/D" value={kdText} color="#FF4B5C" metric="total_kills" leaderboardMetric="kdr" sparklineValues={sparklineFor('total_kills')} onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'kdr', label: 'Kill / Death Ratio', value: kdRatio ?? 0, color: '#FF4B5C' })} />
          <StatCard label="Boss Tier" value={stats?.highest_boss_tier ?? 0} color="#FF4B5C" metric="highest_boss_tier" leaderboardMetric="highest_boss_tier" sparklineValues={sparklineFor('highest_boss_tier')} onClick={() => openDetail({ metric: 'highest_boss_tier', leaderboardMetric: 'highest_boss_tier', label: 'Highest Boss Tier', value: stats?.highest_boss_tier ?? 0, color: '#FF4B5C' })} />
        </div>

        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Economy</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Net Worth" value={stats?.net_worth ?? 0} color="#7CFC00" metric="net_worth" leaderboardMetric="net_worth" sparklineValues={sparklineFor('net_worth')} onClick={() => openDetail({ metric: 'net_worth', leaderboardMetric: 'net_worth', label: 'Net Worth', value: stats?.net_worth ?? 0, color: '#7CFC00' })} />
          <StatCard label="Credits" value={player.credits} color="#5AA7FF" metric="credits" isPrivate sparklineValues={sparklineFor('credits')} onClick={() => openDetail({ metric: 'credits', label: 'Credits', value: player.credits, color: '#5AA7FF' })} />
          <StatCard label="Scrap" value={player.scrap} color="#A855F7" metric="scrap" isPrivate sparklineValues={sparklineFor('scrap')} onClick={() => openDetail({ metric: 'scrap', label: 'Scrap', value: player.scrap, color: '#A855F7' })} />
        </div>

        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Collection</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Items" value={stats?.total_items ?? totalItems} color="#FFEA3A" metric="total_items" leaderboardMetric="total_items" sparklineValues={sparklineFor('total_items')} onClick={() => openDetail({ metric: 'total_items', leaderboardMetric: 'total_items', label: 'Total Items', value: stats?.total_items ?? totalItems, color: '#FFEA3A' })} />
          <StatCard label="Weapons" value={stats?.weapons_owned ?? weapons.length} color="#FFEA3A" metric="weapons_owned" sparklineValues={sparklineFor('weapons_owned')} />
          <StatCard label="Legendaries" value={stats?.legendary_items ?? 0} color="#FFEA3A" metric="legendary_items" leaderboardMetric="legendary_items" sparklineValues={sparklineFor('legendary_items')} onClick={() => openDetail({ metric: 'legendary_items', leaderboardMetric: 'legendary_items', label: 'Legendary Items', value: stats?.legendary_items ?? 0, color: '#FFEA3A' })} />
          <StatCard label="Highest IL" value={stats?.highest_item_level ?? 0} color="#FFEA3A" metric="highest_item_level" sparklineValues={sparklineFor('highest_item_level')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ProgressionHistoryCard metric="level" label="Level" color="#FF9000" />
        <ProgressionHistoryCard metric="net_worth" label="Net Worth" color="#7CFC00" />
        <ProgressionHistoryCard metric="total_kills" label="Kills" color="#FF4B5C" />
        <ProgressionHistoryCard metric="credits" label="Credits" color="#5AA7FF" />
      </div>

      <MobileCard className="space-y-2" rarityColor="#FFEA3A">
        <div className="text-xs font-black uppercase tracking-wide text-text-muted">Collection Patch</div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Total Items</span><span className="text-text-primary">{stats?.total_items ?? totalItems}</span></div>
          <div className="flex justify-between"><span>Weapons</span><span className="text-text-primary">{stats?.weapons_owned ?? weapons.length}</span></div>
          <div className="flex justify-between"><span>Legendary Items</span><span className="font-bold text-amber">{stats?.legendary_items ?? weapons.filter((w) => w.rarity === 'Legendary').length}</span></div>
          <div className="flex justify-between"><span>Highest Item Level</span><span className="text-text-primary">{stats ? stats.highest_item_level : '—'}</span></div>
          <div className="flex justify-between"><span>Unique Affixes</span><span className="text-text-primary">{new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}</span></div>
          <div className="flex justify-between"><span>Favorite Type</span><span className="font-bold text-amber">{favoriteType ? favoriteType[0] : 'None'}</span></div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-2">
          <PxIcon name="crosshair" size={17} className="text-amber" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Field Stats</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="space-y-1">
            <div className="text-text-muted">Kills</div>
            <div className="font-black text-text-primary">{(stats?.total_kills ?? 0).toLocaleString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-text-muted">Deaths</div>
            <div className="font-black text-text-primary">{(stats?.total_deaths ?? 0).toLocaleString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-text-muted">K/D</div>
            <div className="font-black text-text-primary">{kdText}</div>
          </div>
          <div className="space-y-1">
            <div className="text-text-muted">Best Streak</div>
            <div className="font-black text-text-primary">{(stats?.longest_kill_streak ?? 0).toLocaleString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-text-muted">Active Time</div>
            <div className="font-black text-text-primary">{formatDuration(stats?.active_play_seconds ?? 0)}</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <PxIcon name="rings" size={17} className="text-red" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Combat Breakdown</div>
        </div>
        <div className="space-y-2 text-xs">
          <div>
            <div className="mb-1 text-text-muted">Top Areas</div>
            {topAreas.length === 0 ? (
              <div className="text-text-muted">No data yet.</div>
            ) : (
              <ul className="space-y-1">
                {topAreas.map((a) => (
                  <li key={a.name} className="flex justify-between">
                    <span className="text-text-secondary">{a.name}</span>
                    <span className="font-bold text-text-primary">{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-text-muted">Top Weapon Types</div>
            {topWeaponTypes.length === 0 ? (
              <div className="text-text-muted">No data yet.</div>
            ) : (
              <ul className="space-y-1">
                {topWeaponTypes.map((t) => (
                  <li key={t.name} className="flex justify-between">
                    <span className="text-text-secondary">{t.name}</span>
                    <span className="font-bold text-text-primary">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </MobileCard>
        </>
      ))}

      {stopSection('collections', (
        <>
          <PlatesBackRow stopLabel={STOP_LABELS.collections} onBack={() => goToStop('hub')} />
          {visitedStops.has('collections') ? <CollectionsScreen embedded /> : null}
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
        visitedStops.has('standings') ? (
          <>
            <PlatesBackRow stopLabel={STOP_LABELS.standings} onBack={() => goToStop('hub')} />
            <LeaderboardsScreen embedded focusEarningsNonce={earningsFocusNonce} />
          </>
        ) : null
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
