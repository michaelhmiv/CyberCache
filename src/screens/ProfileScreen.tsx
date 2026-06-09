import React from 'react';
import { Activity, Award, Box, HelpCircle, LogOut, Settings, ShieldCheck, Target, TrendingUp, User, Zap } from 'lucide-react';
import { useActivityStore, usePlayerStore, useInventoryStore, useBossStore, useSkillStore } from '@/store';
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
  const { account, user, signOut, actionLoading } = useAuth();

  const weapons = inventory.getWeapons();
  const totalItems = inventory.items.length;
  const xpToNext = player.level * 100;
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

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Hunter Dossier</div>
          <div className="text-xs text-text-muted mt-1">Identity, account status, activity, stats, settings, and guide access.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <User size={22} />
        </div>
      </div>

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
          <div className="flex justify-between"><span>Weapons</span><span className="text-text-primary">{weapons.length}</span></div>
          <div className="flex justify-between"><span>Favorite Type</span><span className="font-bold text-amber">{favoriteType ? favoriteType[0] : 'None'}</span></div>
          <div className="flex justify-between"><span>Legendary Items</span><span className="font-bold text-amber">{weapons.filter((w) => w.rarity === 'Legendary').length}</span></div>
          <div className="flex justify-between"><span>Unique Affixes</span><span className="text-text-primary">{new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}</span></div>
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
