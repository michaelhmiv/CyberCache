import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { useActivityStore, useBossStore, useInventoryStore, usePlayerStore, useWorkshopStore } from '@/store';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { xpToNextLevel } from '@/content/simulation';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';

type PulseEntry = {
  id: string;
  label: string;
  detail: string;
  icon: PxIconName;
  tone: string;
};

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

export const WorldPulseFeed: React.FC<{
  bare?: boolean;
  /**
   * Children (drift-fix F4) render inside the default feed form as
   * its final section, above the footer line — the Hunter Profile
   * stop's "Now" panel passes the Killed By record here so the
   * merged feed stays one panel (DESIGN.md's Now law; mock m36).
   * The feed form itself is one-liners: icon, bold lead, em-dash
   * detail, all wrapping at the 11px floor, never truncated.
   */
  children?: React.ReactNode;
}> = ({ bare = false, children }) => {
  const activity = useActivityStore();
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const workshop = useWorkshopStore();

  const publicPayload = activity.current.publicPayload;
  const activityLabel = safeText(publicPayload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(publicPayload.target_label);
  // The Scene row of the retired Current Activity card folds into
  // the feed's activity line (resolved player label, never the raw
  // scene key — QC 2026-11-02, A3).
  const activityScene = resolveSceneLabel(activity.current.sceneKey, safeText(publicPayload.scene_key));
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

  // Bare form (redesign Wave C): Home's deck "Now" panel hosts
  // the feed — the panel prints the one header, so the card
  // chrome, the feed's own "World Pulse" header, and the
  // developer-voice footer line all stay with the Profile form.
  if (bare) {
    return (
      <div className="space-y-2">
        {entries.map((entry) => {
          return (
            <div key={entry.id} className="flex items-start gap-2 border border-border bg-bg/60 p-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-surface-raised font-black" style={{ color: entry.tone, fontSize: '14px' }}>
                <PxIcon name={entry.icon} size={13} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-text-primary">{entry.label}</div>
                <div className="text-[11px] text-text-muted leading-snug">{entry.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Feed form (drift-fix F4) — the default: one-liners inside the
  // host's Now panel. The old standalone "World Pulse" card form
  // is retired — Profile was its only host, and the approved
  // composition merges World Pulse + current activity + the death
  // record into the one Now panel (mock m36; DESIGN.md's Now law).
  // The Scene suffix on the activity line is feed-form only, so
  // Home's bare form keeps its signed wording.
  return (
    <div className="space-y-1.5">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-2 text-xs leading-snug">
          <span className="mt-px shrink-0" style={{ color: entry.tone }}>
            <PxIcon name={entry.icon} size={13} />
          </span>
          <div className="min-w-0">
            <b className="break-words font-black text-text-primary">{entry.label}</b>{' '}
            <span className="break-words text-[11px] text-text-muted">
              — {entry.detail}
              {entry.id === 'current-activity' ? ` · ${activityScene}` : ''}
            </span>
          </div>
        </div>
      ))}
      {children}
      <div className="text-[11px] text-text-muted">The latest from your hunts, finds, and feats across the wastes.</div>
    </div>
  );
};
