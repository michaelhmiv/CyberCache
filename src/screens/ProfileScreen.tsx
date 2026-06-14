import React, { useEffect, useState } from 'react';
import { Activity, Award, Box, HelpCircle, LogOut, Settings, ShieldCheck, Skull, Sword, Target, TrendingUp, User, Zap } from 'lucide-react';
import { useActivityStore, useBossStore, useInventoryStore, usePlayerStore, useSkillStore, useSurvivalStore } from '@/store';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/supabase/statsService';
import { formatDuration, topBreakdown } from '@/lib/stats/statsHelpers';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { xpToNextLevel } from '@/content/simulation';
import { MobileCard } from '@/components/layout/MobileCard';
import { WorldPulseFeed } from '@/components/profile/WorldPulseFeed';
import { SkillTreeScreen } from './SkillTreeScreen';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useAuth } from '@/auth/AuthProvider';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';

interface ProfileScreenProps {
  onNavigate?: (screen: string) => void;
}

const ActionRow: React.FC<{ icon: React.ElementType; label: string; desc: string; onClick: () => void; tone?: string }> = ({ icon: Icon, label, desc, onClick, tone = '#FF9000' }) => (
  <button
    onClick={onClick}
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: tone, borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-10 w-10 shrink-0 items-center justify-center" style={{ backgroundColor: `${tone}18` }}>
      <Icon size={18} style={{ color: tone }} />
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
  const bossStore = useBossStore();
  const activity = useActivityStore();
  const skillStore = useSkillStore();
  const deathLog = useSurvivalStore((s) => s.deathLog);
  const { account, user, signOut, actionLoading } = useAuth();
  const [stats, setStats] = useState<PlayerPublicStats | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyStatsSummary().then((data) => {
      if (cancelled) return;
      setStats(data);
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
            <div className="text-xs text-text-muted">Level {player.level} Gunrunner</div>
            <div className="mt-1.5 h-2 overflow-hidden border-2 border-border bg-bg" style={{ clipPath: 'polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%)' }}>
              <div className="h-full bg-amber transition-all" style={{ width: `${Math.min(100, xpProgress)}%` }} />
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">{player.xp} / {xpToNext} XP ({xpProgress}%)</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#5AA7FF">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-blue" />
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
          <Skull size={16} className="text-red" />
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
          <Zap size={16} className="text-red" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Skill Trees</div>
          <div className="ml-auto text-[10px] text-text-muted">{availableSkillPoints} pts available</div>
        </div>
        <SkillTreeScreen embedded />
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#7CFC00">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-green" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Account Plate</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3"><span>Status</span><span className="text-right font-bold text-text-primary">{verifiedLabel}</span></div>
          <div className="flex justify-between gap-3"><span>Email</span><span className="truncate text-right font-bold text-text-primary">{account?.email ?? user?.email ?? 'None'}</span></div>
          <div className="flex justify-between gap-3"><span>User ID</span><span className="max-w-[170px] truncate text-right text-text-muted">{account?.userId ?? 'Not loaded'}</span></div>
        </div>
      </MobileCard>

      <div className="grid grid-cols-2 gap-2">
        <MobileCard className="space-y-1" rarityColor="#FF9000">
          <div className="flex items-center gap-2"><TrendingUp size={16} className="text-amber" /><div className="text-xs font-bold text-text-primary">Credits</div></div>
          <div className="text-lg font-black text-text-primary">{player.credits.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1" rarityColor="#A855F7">
          <div className="flex items-center gap-2"><Box size={16} className="text-purple" /><div className="text-xs font-bold text-text-primary">Scrap</div></div>
          <div className="text-lg font-black text-text-primary">{player.scrap.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1" rarityColor="#FF4B5C">
          <div className="flex items-center gap-2"><Target size={16} className="text-red" /><div className="text-xs font-bold text-text-primary">Bosses</div></div>
          <div className="text-lg font-black text-text-primary">{bossStore.defeatedBossIds.length} / {REGION_1_BOSSES.length}</div>
        </MobileCard>
        <MobileCard className="space-y-1" rarityColor="#7CFC00">
          <div className="flex items-center gap-2"><Award size={16} className="text-green" /><div className="text-xs font-bold text-text-primary">Items</div></div>
          <div className="text-lg font-black text-text-primary">{totalItems}</div>
        </MobileCard>
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
          <Sword size={16} className="text-amber" />
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
          <Target size={16} className="text-red" />
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
          <Award size={16} className="text-green" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Mastery</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Total Mastery XP</span><span className="font-bold text-text-primary">{(stats?.total_mastery_xp ?? 0).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Highest Mastery Level</span><span className="font-bold text-text-primary">{stats?.highest_mastery_level ?? 0}</span></div>
        </div>
      </MobileCard>

      <div className="space-y-2">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Account Tools</div>
        <ActionRow icon={Settings} label="Settings" desc="Preferences, display, and local save controls" onClick={() => onNavigate?.('settings')} tone="#9CA3AF" />
        <ActionRow icon={HelpCircle} label="Field Manual" desc="Mechanics, progression, caches, combat, and economy rules" onClick={() => onNavigate?.('help')} tone="#F7D20B" />
        <ActionRow icon={User} label="Identity" desc="Titles, badges, collections, and profile hooks" onClick={() => onNavigate?.('profile')} tone="#5AA7FF" />
        <ActionRow icon={LogOut} label={actionLoading ? 'Signing out…' : 'Sign Out'} desc="End this CyberCache session on this device" onClick={() => signOut()} tone="#FF4B5C" />
      </div>
    </div>
  );
};
