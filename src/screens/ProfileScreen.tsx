import React, { useEffect, useState } from 'react';

import { useActivityStore, useInventoryStore, usePlayerStore, useSkillStore, useSurvivalStore } from '@/store';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/api/statsService';
import { formatDuration, topBreakdown } from '@/lib/stats/statsHelpers';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { xpToNextLevel } from '@/content/simulation';
import { MobileCard } from '@/components/layout/MobileCard';
import { WorldPulseFeed } from '@/components/profile/WorldPulseFeed';
import { SkillTreeScreen } from './SkillTreeScreen';
import { useAuth } from '@/auth/AuthProvider';
import { getMyProfileSummary, type ProfileSummary } from '@/lib/api/usernameService';
import { UsernameSetupModal } from '@/components/profile/UsernameSetupModal';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { StatCard } from '@/components/profile/StatCard';
import { StatDetailPanel } from '@/components/profile/StatDetailPanel';
import { ProgressionHistoryCard } from '@/components/progression/ProgressionHistoryCard';
import { getMyProgressionSnapshots, type ProgressionMetric } from '@/lib/api/progressionService';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';

interface ProfileScreenProps {
  onNavigate?: (screen: string) => void;
}

const ActionRow: React.FC<{ glyph: string; label: string; desc: string; onClick: () => void; tone?: string }> = ({ glyph, label, desc, onClick, tone = '#FF9000' }) => (
  <button
    onClick={onClick}
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: tone, borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-10 w-10 shrink-0 items-center justify-center font-black" style={{ backgroundColor: `${tone}18`, color: tone, fontSize: '18px' }}>
      {glyph}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-black uppercase tracking-wide text-text-primary">{label}</div>
      <div className="text-[10px] text-text-muted">{desc}</div>
    </div>
  </button>
);

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const activity = useActivityStore();
  const skillStore = useSkillStore();
  const deathLog = useSurvivalStore((s) => s.deathLog);
  const { account, user, signOut, actionLoading } = useAuth();
  const [stats, setStats] = useState<PlayerPublicStats | null>(null);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [detailMetric, setDetailMetric] = useState<{ metric: ProgressionMetric; leaderboardMetric?: LeaderboardMetric; label: string; value: number; color: string } | null>(null);
  const [snapshots, setSnapshots] = useState<Array<{ snapshot_at: string; [key: string]: unknown }>>([]);

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
  const payload = activity.current.publicPayload;
  const activityLabel = safeText(payload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(payload.target_label) ?? 'No target';
  const activityScene = activity.current.sceneKey ?? safeText(payload.scene_key) ?? 'standby';
  const topAreas = topBreakdown(stats?.kills_by_area, 3);
  const topWeaponTypes = topBreakdown(stats?.kills_by_weapon_type, 3);

  const sparklineFor = (metric: ProgressionMetric): number[] => {
    return snapshots.map((s) => (typeof s[metric] === 'number' ? (s[metric] as number) : 0));
  };

  const openDetail = (payload: { metric: ProgressionMetric; leaderboardMetric?: LeaderboardMetric; label: string; value: number; color: string }) => {
    setDetailMetric(payload);
  };

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <ResourceBar />

      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 -rotate-2 items-center justify-center border-[3px] border-border bg-amber/15 text-2xl font-black text-amber shadow-[5px_5px_0_rgba(0,0,0,0.75)]">
            {player.level}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-black uppercase tracking-wide text-text-primary">{player.name}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              {account?.hasUsername ? (
                <>
                  <span className="text-amber">@{account.username ?? profileSummary?.username}</span>
                  {account && !account.isAnonymous && (
                    <button
                      onClick={() => setRenameOpen(true)}
                      className="text-[10px] underline hover:text-amber"
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
            </div>
            <div className="mt-1.5 h-2 overflow-hidden border-2 border-border bg-bg" style={{ clipPath: 'polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%)' }}>
              <div className="h-full bg-amber transition-all" style={{ width: `${Math.min(100, xpProgress)}%` }} />
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">{player.xp} / {xpToNext} XP ({xpProgress}%)</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#5AA7FF">
        <div className="flex items-center gap-2">
          <span className="font-black text-blue" style={{ fontSize: '16px' }}>📡</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Current Activity</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3"><span>Status</span><span className="text-right font-bold text-text-primary">{activityLabel}</span></div>
          <div className="flex justify-between gap-3"><span>Target</span><span className="truncate text-right font-bold text-text-primary">{activityTarget}</span></div>
          <div className="flex justify-between gap-3"><span>Scene</span><span className="truncate text-right text-text-muted">{activityScene}</span></div>
        </div>
        <div className="text-[10px] text-text-muted">This panel reads sanitized activity fields and avoids internal runtime details.</div>
      </MobileCard>

      <WorldPulseFeed />

      <MobileCard className="space-y-2" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <span className="font-black text-red" style={{ fontSize: '16px' }}>☠</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Killed By</div>
          <div className="ml-auto text-[10px] text-text-muted">{deathLog.length} recorded</div>
        </div>
        {deathLog.length === 0 ? (
          <div className="text-[10px] text-text-muted">No deaths on file. Stay sharp out there.</div>
        ) : (
          <ul data-testid="death-log" className="space-y-1 text-xs text-text-secondary">
            {deathLog.slice(0, 10).map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                data-testid="death-log-entry"
                data-monster-id={entry.monsterId}
                data-area-id={entry.areaId}
                className="flex items-center justify-between gap-3 border-b border-border/40 pb-1 last:border-b-0"
              >
                <div className="min-w-0 flex-1 truncate font-bold text-text-primary">{entry.monsterName}</div>
                <div className="truncate text-[10px] text-text-muted">{entry.areaId}</div>
                <div className="shrink-0 text-[10px] text-text-muted">
                  {new Date(entry.at).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <span className="font-black text-red" style={{ fontSize: '16px' }}>⚡</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Skill Trees</div>
          <div className="ml-auto text-[10px] text-text-muted">{availableSkillPoints} pts available</div>
        </div>
        <SkillTreeScreen embedded />
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#7CFC00">
        <div className="flex items-center gap-2">
          <span className="font-black text-green" style={{ fontSize: '16px' }}>◈</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Account Plate</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3"><span>Status</span><span className="text-right font-bold text-text-primary">{verifiedLabel}</span></div>
          <div className="flex justify-between gap-3"><span>Email</span><span className="truncate text-right font-bold text-text-primary">{account?.email ?? user?.email ?? 'None'}</span></div>
          <div className="flex justify-between gap-3"><span>User ID</span><span className="max-w-[170px] truncate text-right text-text-muted">{account?.userId ?? 'Not loaded'}</span></div>
        </div>
      </MobileCard>

      <div className="space-y-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Progression</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Level" value={stats?.player_level ?? player.level} color="#FF9000" metric="level" leaderboardMetric="level" sparklineValues={sparklineFor('level')} onClick={() => openDetail({ metric: 'level', leaderboardMetric: 'level', label: 'Level', value: stats?.player_level ?? player.level, color: '#FF9000' })} />
          <StatCard label="XP" value={stats?.player_xp ?? player.xp} color="#FF9000" metric="xp" leaderboardMetric="xp" sparklineValues={sparklineFor('xp')} onClick={() => openDetail({ metric: 'xp', leaderboardMetric: 'xp', label: 'XP', value: stats?.player_xp ?? player.xp, color: '#FF9000' })} />
          <StatCard label="Mastery XP" value={stats?.total_mastery_xp ?? 0} color="#7CFC00" metric="total_mastery_xp" leaderboardMetric="total_mastery_xp" sparklineValues={sparklineFor('total_mastery_xp')} onClick={() => openDetail({ metric: 'total_mastery_xp', leaderboardMetric: 'total_mastery_xp', label: 'Mastery XP', value: stats?.total_mastery_xp ?? 0, color: '#7CFC00' })} />
          <StatCard label="Mastery Lv" value={stats?.highest_mastery_level ?? 0} color="#7CFC00" metric="highest_mastery_level" leaderboardMetric="highest_mastery_level" sparklineValues={sparklineFor('highest_mastery_level')} onClick={() => openDetail({ metric: 'highest_mastery_level', leaderboardMetric: 'highest_mastery_level', label: 'Highest Mastery Level', value: stats?.highest_mastery_level ?? 0, color: '#7CFC00' })} />
        </div>

        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Combat</div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Kills" value={stats?.total_kills ?? 0} color="#FF4B5C" metric="total_kills" leaderboardMetric="total_kills" sparklineValues={sparklineFor('total_kills')} onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'total_kills', label: 'Kills', value: stats?.total_kills ?? 0, color: '#FF4B5C' })} />
          <StatCard label="Deaths" value={stats?.total_deaths ?? 0} color="#FF4B5C" metric="total_deaths" sparklineValues={sparklineFor('total_deaths')} />
          <StatCard label="K/D" value={(stats?.kill_death_ratio ?? 0).toFixed(2)} color="#FF4B5C" metric="total_kills" leaderboardMetric="kdr" sparklineValues={sparklineFor('total_kills')} onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'kdr', label: 'Kill / Death Ratio', value: stats?.kill_death_ratio ?? 0, color: '#FF4B5C' })} />
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
          <span className="font-black text-amber" style={{ fontSize: '16px' }}>⚔</span>
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
            <div className="font-black text-text-primary">{(stats?.kill_death_ratio ?? 0).toFixed(2)}</div>
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
          <span className="font-black text-red" style={{ fontSize: '16px' }}>◎</span>
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

      <MobileCard className="space-y-2" rarityColor="#7CFC00">
        <div className="flex items-center gap-2">
          <span className="font-black text-green" style={{ fontSize: '16px' }}>★</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Mastery</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Total Mastery XP</span><span className="font-bold text-text-primary">{(stats?.total_mastery_xp ?? 0).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Highest Mastery Level</span><span className="font-bold text-text-primary">{stats?.highest_mastery_level ?? 0}</span></div>
        </div>
      </MobileCard>

      <div className="space-y-2">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Account Tools</div>
        <ActionRow glyph="⚙" label="Settings" desc="Preferences, display, and local save controls" onClick={() => onNavigate?.('settings')} tone="#9CA3AF" />
        <ActionRow glyph="?" label="Field Manual" desc="Mechanics, progression, caches, combat, and economy rules" onClick={() => onNavigate?.('help')} tone="#F7D20B" />
        <ActionRow glyph="☻" label="Identity" desc="Manage your public hunter name and profile identity" onClick={() => (account?.username || profileSummary?.username ? setRenameOpen(true) : setSetupOpen(true))} tone="#5AA7FF" />
        <ActionRow glyph="⏻" label={actionLoading ? 'Signing out…' : 'Sign Out'} desc="End this CyberCache session on this device" onClick={() => signOut()} tone="#FF4B5C" />
      </div>
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
    </div>
  );
};
