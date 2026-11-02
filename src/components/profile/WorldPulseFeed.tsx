import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { useActivityStore, useBossStore, useInventoryStore, usePlayerStore, useWorkshopStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { xpToNextLevel } from '@/content/simulation';

type PulseEntry = {
  id: string;
  label: string;
  detail: string;
  icon: PxIconName;
  tone: string;
};

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

export const WorldPulseFeed: React.FC = () => {
  const activity = useActivityStore();
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const workshop = useWorkshopStore();

  const publicPayload = activity.current.publicPayload;
  const activityLabel = safeText(publicPayload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(publicPayload.target_label);
  const latestBoss = bossStore.defeatedBossIds
    .map((id) => REGION_1_BOSSES.find((boss) => boss.id === id))
    .filter(Boolean)
    .at(-1);
  const strongestWeapon = inventory.getWeapons().sort((a, b) => b.combatPower - a.combatPower)[0];
  // Workshop jobs are server state now (0024): "ready" output means
  // units the server has already settled into completions — read from
  // the mirrored server view, never from a local clock.
  const workshopJobs = workshop.server?.jobs ?? [];
  const activeWorkshopJobs = workshopJobs.filter(
    (j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused',
  );
  const jobsWithOutput = activeWorkshopJobs.filter((j) => j.unitsCompleted > 0).length;

  const entries: PulseEntry[] = [
    {
      id: 'current-activity',
      label: activity.current.kind === 'idle_standby' ? 'Standing by' : activityLabel,
      detail: activityTarget ? `Target: ${activityTarget}` : 'No active target selected.',
      icon: 'signal',
      tone: '#5AA7FF',
    },
    {
      id: 'level-progress',
      label: `Level ${player.level} Gunrunner`,
      detail: `${player.xp} / ${xpToNextLevel(player.level)} XP toward next level.`,
      icon: 'crown',
      tone: '#FF9000',
    },
    {
      id: 'boss-progress',
      label: latestBoss ? `${latestBoss.name} defeated` : 'No boss defeats yet',
      detail: `${bossStore.defeatedBossIds.length} / ${REGION_1_BOSSES.length} Region 1 bosses defeated.`,
      icon: 'skull',
      tone: '#FF4B5C',
    },
    {
      id: 'best-weapon',
      label: strongestWeapon ? strongestWeapon.name : 'No weapon recorded',
      detail: strongestWeapon ? `${strongestWeapon.rarity} ${strongestWeapon.weaponType} · ${strongestWeapon.combatPower} combat power.` : 'Find gear through activity-backed combat and caches.',
      icon: 'grid',
      tone: '#F7D20B',
    },
    {
      id: 'workshop-state',
      label: `${activeWorkshopJobs.length} bench job${activeWorkshopJobs.length === 1 ? '' : 's'}`,
      detail: jobsWithOutput > 0 ? `${jobsWithOutput} job${jobsWithOutput === 1 ? '' : 's'} already produced units.` : 'No completed workshop output waiting.',
      icon: 'cog',
      tone: '#A855F7',
    },
  ];

  return (
    <MobileCard className="space-y-2" rarityColor="#5AA7FF">
      <div className="flex items-center gap-2">
        <PxIcon name="signal" size={17} className="text-blue" />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">World Pulse</div>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => {
          return (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg border border-border bg-bg/60 p-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-surface-raised font-black" style={{ color: entry.tone, fontSize: '14px' }}>
                <PxIcon name={entry.icon} size={13} />
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
