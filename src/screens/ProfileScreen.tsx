import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';

import { useActivityStore, useInventoryStore, usePlayerStore, useSkillStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/api/statsService';
import { formatKillDeathRatio, topBreakdown } from '@/lib/stats/statsHelpers';
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
import { SkillTreeScreen } from './SkillTreeScreen';
import { CollectionsScreen } from './CollectionsScreen';
import { LeaderboardsScreen } from './LeaderboardsScreen';
import { useAuth } from '@/auth/AuthProvider';
import { isGuestAccount } from '@/auth/accountState';
import { getMyProfileSummary, type ProfileSummary } from '@/lib/api/usernameService';
import { UsernameSetupModal } from '@/components/profile/UsernameSetupModal';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';
import { CareerRecordPlate, CombatRecordPlate, Plate, RecordHeroPlate, TotalsDoorPlate } from '@/components/profile/ProfileRecordPlates';
import { StatDetailPanel } from '@/components/profile/StatDetailPanel';
import { ProgressionHistoryCard } from '@/components/progression/ProgressionHistoryCard';
import { type ProgressionMetric } from '@/lib/api/progressionService';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';

interface ProfileScreenProps {
  onNavigate?: (screen: string) => void;
  /**
   * Deep-link focus (device feedback r2): 'skills' lands the player
   * on the Hunter → Skill Trees rail stop — the Dashboard "Skill
   * Trees" action routes here, so the player lands on the trees
   * themselves instead of the top of the Profile stop.
   */
  focusSection?: 'skills' | 'research' | 'wardrobe' | null;
  /**
   * PROTOTYPE SEAM (design/hunter-subpages-profile, never merged):
   * the fixture harness may hand the screen its /stats/me payload
   * directly. Production callers never pass this; the live fetch
   * below remains the only source when it is undefined.
   */
  fixtureStats?: PlayerPublicStats | null;
}

/**
 * Hunter (redesign v2, DESIGN.md §2/§3) — the tab's rail stops.
 * Every stop is a destination: Profile (identity, Trophy Shelf, the
 * Standings door, lifetime record), Collections (the 81 proofs),
 * Cache Rank, Research, Skill Trees (Mastery is its segment),
 * Standings (the leaderboards behind the badged door), and Account
 * (identity plate + tools: link, settings, field manual, sign-out).
 * The rail scrolls horizontally rather than shrinking its labels
 * (DESIGN.md §6); full stop names print here AND on the stops.
 */
type HunterStop = 'profile' | 'collections' | 'cacheRank' | 'research' | 'trees' | 'standings' | 'account';

const HUNTER_STOPS: Array<{ id: HunterStop; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

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

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate, focusSection = null, fixtureStats }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const skillStore = useSkillStore();
  const deathLog = useSurvivalStore((s) => s.deathLog);
  const { account, user, signOut, signInWithGoogle, actionLoading } = useAuth();
  const [stats, setStats] = useState<PlayerPublicStats | null>(fixtureStats ?? null);
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
  const [stop, setStop] = useState<HunterStop>(() => (focusSection === 'skills' ? 'trees' : focusSection === 'research' ? 'research' : 'profile'));
  // Stops whose content mounts lazily on first visit and stays
  // mounted (the two full screens: Collections, Standings) — the
  // always-resident stops are the panels that already lived here.
  const [visitedStops, setVisitedStops] = useState<ReadonlySet<HunterStop>>(() => new Set<HunterStop>(['profile']));
  const standingsBadge = useStandingsBadge();
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
    if (focusSection === 'wardrobe') goToStop('profile');
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
  // figure-stage door (Exec C) — the Wardrobe panel lives on the
  // Profile stop; scroll it into view once that stop is lit.
  const wardrobeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusSection !== 'wardrobe' || stop !== 'profile') return;
    const el = wardrobeRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusSection, stop]);

  useEffect(() => {
    if (fixtureStats !== undefined) return;
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
  }, [user, fixtureStats]);

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
  const kdText = stats ? formatKillDeathRatio(stats.total_kills, stats.total_deaths) : '—';

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

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Hunter sections"
        data-testid="hunter-rail"
      >
        {HUNTER_STOPS.map((s) => {
          const active = stop === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`hunter-stop-${s.id}`}
              onClick={() => goToStop(s.id)}
              className={`flex shrink-0 items-center gap-1.5 border-2 px-2.5 py-1.5 text-xs font-black uppercase tracking-wide transition-colors ${
                active
                  ? 'border-amber bg-amber/15 text-amber'
                  : 'border-border bg-surface text-text-muted'
              }`}
            >
              <PxIcon name={s.icon} size={13} />
              {s.label}
              {s.id === 'standings' && standingsBadge.unseenEarningsCount > 0 && (
                <span
                  data-testid="hunter-standings-count"
                  className="relative border border-amber/60 bg-amber/25 px-1 text-[11px] font-black leading-tight text-amber"
                >
                  {/* Unseen settled earnings — a notice count, not a
                      claim: race rewards auto-pay at settlement, so
                      no claim pulse (§10 reserves the pulse for real
                      claim actions). Viewing the Standings earnings
                      panel clears it. */}
                  {standingsBadge.unseenEarningsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {stopSection('profile', (
        <>
      {/* PROTOTYPE (design/hunter-subpages-profile): the identity
          panel becomes the RECORD PLATE — the boss plate's hero
          promoted to a person. Arena painting behind a hard scrim,
          the level as a gauge well, XP as a fraction + thread, and
          the Trophy Shelf seated inside the same plate. */}
      <RecordHeroPlate
        name={player.name}
        level={player.level}
        xp={player.xp}
        xpToNext={xpToNext}
        xpProgress={xpProgress}
        joinedLabel={stats?.joined_at ? `In the field since ${new Date(stats.joined_at).toLocaleDateString()}` : 'Career record'}
        unspentPoints={availableSkillPoints}
        onOpenTrees={() => goToStop('trees')}
        handleLine={(
          <>
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
          </>
        )}
      >
        <div className="mt-3" style={{ borderTop: '2px groove #2E2113' }}>
          <TrophyShelfPanel bare onOpenCollections={() => goToStop('collections')} />
        </div>
      </RecordHeroPlate>

      {/* Totals & Sources — the full source breakdown's home
          (Home consolidation): every effective stat with every
          contributor, the surface the deck's Hunter Totals panel
          used to host. Home's rundown heroes open the focused
          single-stat form of this same sheet. */}
      <TotalsDoorPlate onOpen={() => setTotalsOpen(true)} />

      {/* Wardrobe (Parts M4) — the skin-part showcase + wear/remove
          surface. M4 placed it directly after the identity block;
          F4 folded the Trophy Shelf into that block, so the Wardrobe
          stands as the next first-class panel, before Standings.
          The wrapper is the deep-link anchor for the Gear page's
          figure-stage Wardrobe door (Exec C): a 'wardrobe' focus
          scrolls here and rings the panel. */}
      <div
        ref={wardrobeRef}
        data-testid="profile-wardrobe-anchor"
        className={focusSection === 'wardrobe' ? 'scroll-mt-2 rounded-xl ring-2 ring-amber' : 'scroll-mt-2'}
      >
        <WardrobePanel />
      </div>

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
      <Plate testId="profile-now-plate">
       <div className="space-y-2 px-3.5 py-3">
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
       </div>
      </Plate>

      <LifetimeStatsPanel />

      {/* AL-3 second door: the totals above say what you have; the
          log says how it happened. */}
      <ActivityLogDoor onOpen={() => onNavigate?.('activity-log')} />

      {/* PROTOTYPE: the four stat-card grids become ONE career
          record slab — engraved groups, stamped rows, each number
          printed once. Tappable rows keep their StatDetailPanel
          wiring exactly as the cards had it. */}
      <CareerRecordPlate
        groups={[
          {
            title: 'Hunter',
            rows: [
              { label: 'Hunter Level', value: String(stats?.player_level ?? player.level), testId: 'career-level', onClick: () => openDetail({ metric: 'level', leaderboardMetric: 'level', label: 'Hunter Level', value: stats?.player_level ?? player.level, color: '#FF9000' }) },
              { label: 'Hunter XP', value: (stats?.player_xp ?? player.xp).toLocaleString(), testId: 'career-xp', onClick: () => openDetail({ metric: 'xp', leaderboardMetric: 'xp', label: 'Hunter XP', value: stats?.player_xp ?? player.xp, color: '#FF9000' }) },
            ],
          },
          {
            title: 'Masteries',
            rows: [
              { label: 'Mastery XP (all tracks)', value: (stats?.total_mastery_xp ?? 0).toLocaleString(), onClick: () => openDetail({ metric: 'total_mastery_xp', leaderboardMetric: 'total_mastery_xp', label: 'Mastery XP (all tracks)', value: stats?.total_mastery_xp ?? 0, color: '#7CFC00' }) },
              { label: 'Highest Mastery Lv', value: String(stats?.highest_mastery_level ?? 0), onClick: () => openDetail({ metric: 'highest_mastery_level', leaderboardMetric: 'highest_mastery_level', label: 'Highest Mastery Level', value: stats?.highest_mastery_level ?? 0, color: '#7CFC00' }) },
            ],
          },
          {
            title: 'Economy',
            rows: [
              { label: 'Net Worth', value: (stats?.net_worth ?? 0).toLocaleString(), onClick: () => openDetail({ metric: 'net_worth', leaderboardMetric: 'net_worth', label: 'Net Worth', value: stats?.net_worth ?? 0, color: '#7CFC00' }) },
              { label: 'Credits', value: player.credits.toLocaleString(), onClick: () => openDetail({ metric: 'credits', label: 'Credits', value: player.credits, color: '#5AA7FF' }) },
              { label: 'Scrap', value: player.scrap.toLocaleString(), onClick: () => openDetail({ metric: 'scrap', label: 'Scrap', value: player.scrap, color: '#A855F7' }) },
            ],
          },
          {
            title: 'Collection',
            rows: [
              { label: 'Items', value: (stats?.total_items ?? totalItems).toLocaleString(), onClick: () => openDetail({ metric: 'total_items', leaderboardMetric: 'total_items', label: 'Total Items', value: stats?.total_items ?? totalItems, color: '#FFEA3A' }) },
              { label: 'Weapons', value: (stats?.weapons_owned ?? weapons.length).toLocaleString() },
              { label: 'Legendaries', value: (stats?.legendary_items ?? 0).toLocaleString(), onClick: () => openDetail({ metric: 'legendary_items', leaderboardMetric: 'legendary_items', label: 'Legendary Items', value: stats?.legendary_items ?? 0, color: '#FFEA3A' }) },
              { label: 'Highest Item Level', value: String(stats?.highest_item_level ?? 0) },
              { label: 'Unique Affixes', value: String(new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size) },
              { label: 'Favorite Type', value: favoriteType ? favoriteType[0] : 'None' },
            ],
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-2">
        <ProgressionHistoryCard metric="level" label="Level" color="#FF9000" />
        <ProgressionHistoryCard metric="net_worth" label="Net Worth" color="#7CFC00" />
        <ProgressionHistoryCard metric="total_kills" label="Kills" color="#FF4B5C" />
        <ProgressionHistoryCard metric="credits" label="Credits" color="#5AA7FF" />
      </div>

      {/* PROTOTYPE: Field Stats + Combat Breakdown + the combat
          half of the Collection Patch fold into ONE combat record
          plate, fed by the same /stats/me summary. */}
      <CombatRecordPlate
        data={{
          totalKills: stats?.total_kills ?? 0,
          totalDeaths: stats?.total_deaths ?? 0,
          kdText,
          longestStreak: stats?.longest_kill_streak ?? 0,
          highestBossTier: stats?.highest_boss_tier ?? 0,
          activeSeconds: stats?.active_play_seconds ?? 0,
          idleSeconds: stats?.idle_play_seconds ?? 0,
          topAreas,
          topWeaponTypes,
        }}
      />
        </>
      ))}

      {stopSection('collections', (
        visitedStops.has('collections') ? <CollectionsScreen embedded /> : null
      ))}

      {stopSection('cacheRank', (
        <CacheRankPanel />
      ))}

      {stopSection('research', (
        <ResearchPanel />
      ))}

      {stopSection('trees', (
        <>
      <div
        ref={skillTreesRef}
        data-testid="profile-skill-trees"
        className={focusSection === 'skills' ? 'scroll-mt-2 rounded-xl ring-2 ring-purple' : 'scroll-mt-2'}
      >
        <MobileCard className="space-y-3" rarityColor="#FF4B5C">
          <div className="flex items-center gap-2">
            <PxIcon name="bolt" size={17} className="text-red" />
            <div className="text-xs font-black uppercase tracking-wide text-text-primary">Skill Trees</div>
            <div className="ml-auto text-[10px] text-text-muted">{availableSkillPoints} pts available</div>
          </div>
          <SkillTreeScreen embedded />
        </MobileCard>
      </div>

      <MasterySection />
        </>
      ))}

      {stopSection('standings', (
        visitedStops.has('standings') ? (
          <>
            <div className="flex items-center gap-2">
              <PxIcon name="crown" size={17} className="text-amber" />
              <div className="text-lg font-black uppercase tracking-wide text-text-primary">Standings</div>
            </div>
            <LeaderboardsScreen embedded focusEarningsNonce={earningsFocusNonce} />
          </>
        ) : null
      ))}

      {stopSection('account', (
        <>
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
