import React from 'react';
import { Award, Box, HelpCircle, LogOut, Settings, ShieldCheck, Target, TrendingUp, User } from 'lucide-react';
import { usePlayerStore, useInventoryStore, useBossStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useAuth } from '@/auth/AuthProvider';

interface ProfileScreenProps {
  onNavigate?: (screen: string) => void;
}

const ActionRow: React.FC<{ icon: React.ElementType; label: string; desc: string; onClick: () => void; tone?: string }> = ({ icon: Icon, label, desc, onClick, tone = '#FF9000' }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface border border-border text-left active:scale-[0.98] transition-transform"
    style={{ borderLeftColor: tone, borderLeftWidth: 5 }}
  >
    <div className="bl-well w-10 h-10 flex items-center justify-center shrink-0" style={{ backgroundColor: `${tone}18` }}>
      <Icon size={18} style={{ color: tone }} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-black text-text-primary">{label}</div>
      <div className="text-[10px] text-text-muted">{desc}</div>
    </div>
  </button>
);

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const { account, user, signOut, actionLoading } = useAuth();

  const weapons = inventory.getWeapons();
  const totalItems = inventory.items.length;
  const xpToNext = player.level * 100;
  const xpProgress = Math.round((player.xp / xpToNext) * 100);
  const verifiedLabel = account?.accountType === 'verified'
    ? 'Verified account'
    : account?.accountType === 'guest'
      ? 'Guest account'
      : 'Email verification pending';

  const typeCounts: Record<string, number> = {};
  weapons.forEach((w) => { typeCounts[w.weaponType] = (typeCounts[w.weaponType] || 0) + 1; });
  const favoriteType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div>
        <div className="bl-title text-3xl leading-none text-text-primary">Profile</div>
        <div className="text-xs text-text-muted mt-1">Identity, account status, public stats, settings, and guide access.</div>
      </div>

      <MobileCard className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center text-amber font-black text-xl border-2 border-amber/30">
            {player.level}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-black text-text-primary truncate">{player.name}</div>
            <div className="text-xs text-text-muted">Level {player.level} Gunrunner</div>
            <div className="h-1.5 bg-surface-raised rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${Math.min(100, xpProgress)}%` }} />
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">{player.xp} / {xpToNext} XP ({xpProgress}%)</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-green" />
          <div className="text-xs font-black text-text-primary">Account</div>
        </div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between gap-3"><span>Status</span><span className="text-text-primary font-bold text-right">{verifiedLabel}</span></div>
          <div className="flex justify-between gap-3"><span>Email</span><span className="text-text-primary font-bold text-right truncate">{account?.email ?? user?.email ?? 'None'}</span></div>
          <div className="flex justify-between gap-3"><span>User ID</span><span className="text-text-muted text-right truncate max-w-[170px]">{account?.userId ?? 'Not loaded'}</span></div>
        </div>
      </MobileCard>

      <div className="grid grid-cols-2 gap-2">
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-amber" />
            <div className="text-xs font-bold text-text-primary">Credits</div>
          </div>
          <div className="text-lg font-black text-text-primary">{player.credits.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Box size={16} className="text-purple" />
            <div className="text-xs font-bold text-text-primary">Scrap</div>
          </div>
          <div className="text-lg font-black text-text-primary">{player.scrap.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-red" />
            <div className="text-xs font-bold text-text-primary">Bosses</div>
          </div>
          <div className="text-lg font-black text-text-primary">{bossStore.defeatedBossIds.length} / {REGION_1_BOSSES.length}</div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Award size={16} className="text-green" />
            <div className="text-xs font-bold text-text-primary">Items</div>
          </div>
          <div className="text-lg font-black text-text-primary">{totalItems}</div>
        </MobileCard>
      </div>

      <MobileCard className="space-y-2">
        <div className="text-xs font-bold text-text-muted uppercase">Collection</div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Weapons</span><span className="text-text-primary">{weapons.length}</span></div>
          <div className="flex justify-between"><span>Favorite Type</span><span className="text-amber font-bold">{favoriteType ? favoriteType[0] : 'None'}</span></div>
          <div className="flex justify-between"><span>Legendary Items</span><span className="text-amber font-bold">{weapons.filter((w) => w.rarity === 'Legendary').length}</span></div>
          <div className="flex justify-between"><span>Unique Affixes</span><span className="text-text-primary">{new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}</span></div>
        </div>
      </MobileCard>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-text-muted font-black">Account Tools</div>
        <ActionRow icon={Settings} label="Settings" desc="Preferences, display, and local save controls" onClick={() => onNavigate?.('settings')} tone="#9CA3AF" />
        <ActionRow icon={HelpCircle} label="Guide" desc="Mechanics, progression, caches, combat, and economy rules" onClick={() => onNavigate?.('help')} tone="#06B6D4" />
        <ActionRow icon={User} label="Public Identity" desc="Titles, badges, collections, and public profile hooks" onClick={() => onNavigate?.('profile')} tone="#5AA7FF" />
        <ActionRow icon={LogOut} label={actionLoading ? 'Signing out…' : 'Sign Out'} desc="End this CyberCache session on this device" onClick={() => signOut()} tone="#FF4B5C" />
      </div>
    </div>
  );
};
