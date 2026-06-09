import React, { useMemo } from 'react';
import { Activity, Crosshair, Hammer, PackageSearch, Radio, Trophy } from 'lucide-react';
import { useActivityStore, useBossStore, useInventoryStore, usePlayerStore, useWorkshopStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { useNow } from '@/hooks/useNow';

type PulseEntry = {
  id: string;
  label: string;
  detail: string;
  icon: React.ElementType;
  tone: string;
};

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

export const WorldPulseFeed: React.FC = () => {
  const activity = useActivityStore();
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const workshop = useWorkshopStore();
  const now = useNow();

  const publicPayload = activity.current.publicPayload;
  const activityLabel = safeText(publicPayload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(publicPayload.target_label);
  const latestBoss = bossStore.defeatedBossIds
    .map((id) => REGION_1_BOSSES.find((boss) => boss.id === id))
    .filter(Boolean)
    .at(-1);
  const strongestWeapon = inventory.getWeapons().sort((a, b) => b.combatPower - a.combatPower)[0];
  const readyQueues = useMemo(
    () => workshop.activeQueues.filter((queue) => Math.floor((now - queue.startedAt) / queue.durationMs) > queue.claimedCount).length,
    [workshop.activeQueues, now],
  );

  const entries: PulseEntry[] = [
    {
      id: 'current-activity',
      label: activity.current.kind === 'idle_standby' ? 'Standing by' : activityLabel,
      detail: activityTarget ? `Target: ${activityTarget}` : 'No active target selected.',
      icon: Activity,
      tone: '#5AA7FF',
    },
    {
      id: 'level-progress',
      label: `Level ${player.level} Gunrunner`,
      detail: `${player.xp} / ${player.level * 100} XP toward next level.`,
      icon: Trophy,
      tone: '#FF9000',
    },
    {
      id: 'boss-progress',
      label: latestBoss ? `${latestBoss.name} defeated` : 'No boss defeats yet',
      detail: `${bossStore.defeatedBossIds.length} / ${REGION_1_BOSSES.length} Region 1 bosses defeated.`,
      icon: Crosshair,
      tone: '#FF4B5C',
    },
    {
      id: 'best-weapon',
      label: strongestWeapon ? strongestWeapon.name : 'No weapon recorded',
      detail: strongestWeapon ? `${strongestWeapon.rarity} ${strongestWeapon.weaponType} · ${strongestWeapon.combatPower} combat power.` : 'Find gear through activity-backed combat and caches.',
      icon: PackageSearch,
      tone: '#F7D20B',
    },
    {
      id: 'workshop-state',
      label: `${workshop.activeQueues.length} passive bench queue${workshop.activeQueues.length === 1 ? '' : 's'}`,
      detail: readyQueues > 0 ? `${readyQueues} queue${readyQueues === 1 ? '' : 's'} ready to claim.` : 'No completed workshop output waiting.',
      icon: Hammer,
      tone: '#A855F7',
    },
  ];

  return (
    <MobileCard className="space-y-2" rarityColor="#5AA7FF">
      <div className="flex items-center gap-2">
        <Radio size={16} className="text-blue" />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">World Pulse</div>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg border border-border bg-bg/60 p-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-surface-raised" style={{ color: entry.tone }}>
                <Icon size={14} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-text-primary">{entry.label}</div>
                <div className="text-[10px] text-text-muted leading-snug">{entry.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-text-muted">This feed is derived from current stores and activity state. It does not mint rewards, rolls, or events.</div>
    </MobileCard>
  );
};
