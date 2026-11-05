import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { useActivityStore, useInventoryStore, useWorkshopStore } from '@/store';
import { buildWorkshopServiceActivity } from '@/lib/activity/activityBuilders';
import { humanizeWorkshopError } from '@/lib/workshop/errors';
import { chipClip } from '@/lib/ui/clips';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * Repairs & Service — the service lane's home inside Home's Craft
 * workspace (crafting consolidation, owner ruling 2026-11-04).
 *
 * Repair jobs (started in the Garage on a vehicle) and shield-tech
 * jobs (started from a shield's inspect sheet) are craft_jobs on the
 * WORKSHOP SERVICE lane: they progress only while `workshop_service`
 * is the player's active action, aimed at the job (server lane rule,
 * craftEngine). They used to be manageable only from the Garage card
 * or buried in the bench's job list; here they get their own section
 * with the lane's truth printed on it and the management verbs in
 * place — progress, Work (aim the service action at the job), and
 * Cancel (the same workshop cancel op the Garage uses; unapplied
 * kits/cores refund whole). Outputs land automatically at
 * completion — condition restored, behavior flipped — there is no
 * claim step. A job's rush ticket is chosen where the job starts
 * (the Garage, at enqueue); this section manages the work itself.
 *
 * Display only: every number here is the server's workshop view;
 * the Chef remains the authority.
 */

export const isServiceLaneJob = (job: WorkshopJobView): boolean =>
  job.kind === 'repair' || job.kind === 'shieldtech';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

const ServiceJobRow: React.FC<{
  job: WorkshopJobView;
  itemName: string | null;
  isTargeted: boolean;
  onWork: (job: WorkshopJobView) => void;
  onCancel: (jobId: string) => void;
  busy: boolean;
}> = ({ job, itemName, isTargeted, onWork, onCancel, busy }) => {
  const isRepair = job.kind === 'repair';
  const progressPct = Math.min(
    100,
    ((job.unitsCompleted * job.unitDurationMs + job.accruedMs) /
      Math.max(1, job.unitsTotal * job.unitDurationMs)) * 100,
  );
  const stateLabel = isTargeted && job.state === 'running'
    ? 'Working now'
    : job.state === 'running'
      ? 'Running'
      : job.state === 'queued'
        ? 'Queued'
        : job.state === 'paused'
          ? 'Paused'
          : job.state;
  return (
    <div className="border border-border bg-bg/70 p-2.5 space-y-1.5" data-testid={`service-job-${job.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-bold text-text-primary">
          {itemName ?? job.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="border border-border bg-surface px-1.5 py-0.5 text-[11px] font-bold text-text-secondary" style={chipClip}>
            {isRepair ? 'Repair' : 'Shield-tech'}
          </span>
          <span className={`text-[11px] font-bold ${job.state === 'running' ? 'text-green' : job.state === 'paused' ? 'text-red' : 'text-amber'}`}>
            {stateLabel}
          </span>
        </span>
      </div>
      <div className="text-[11px] text-text-secondary">
        {isRepair
          ? <>{job.repairKitType ?? 'PatchKit'} · {job.unitsCompleted}/{job.unitsTotal} kits applied · {Math.floor(job.repairPointsRestored)} condition restored so far</>
          : <>{job.shieldtechFromBehavior ?? '?'} → {job.shieldtechToBehavior ?? '?'} · {job.unitsCompleted}/{job.unitsTotal} cores applied{(job.shieldtechPointsApplied ?? 0) > 0 ? ` · ${job.shieldtechPointsApplied} coverage applied` : ''} — the flip lands at full coverage</>}
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>{formatDuration(job.remainingMs)} left</span>
        <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(job.unitDurationMs)}/unit</span>
      </div>
      <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
        <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="flex gap-2">
        {!isTargeted && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onWork(job)}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-amber text-bg text-[11px] font-bold active:bg-amber/80 transition-colors disabled:opacity-50"
          >
            {isRepair ? 'Work this repair' : 'Work this recalibration'}
          </motion.button>
        )}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => onCancel(job.id)}
          disabled={busy}
          className="py-2 px-3 rounded-lg bg-red/10 border border-red/30 text-red text-[11px] font-bold active:bg-red/20 transition-colors disabled:opacity-50"
        >
          Cancel
        </motion.button>
      </div>
      <div className="text-[11px] text-text-muted">
        Cancel refunds every {isRepair ? 'kit' : 'core'} not yet applied, whole — applied work stays done.
      </div>
    </div>
  );
};

export const RepairServiceSection: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const jobs = useWorkshopStore((s) => s.server?.jobs);
  const cancel = useWorkshopStore((s) => s.cancel);
  const refresh = useWorkshopStore((s) => s.refresh);
  const activity = useActivityStore();
  const items = useInventoryStore((s) => s.items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serviceJobs = (jobs ?? []).filter(
    (j) => isServiceLaneJob(j) && (j.state === 'running' || j.state === 'queued' || j.state === 'paused'),
  );

  const itemNameFor = (job: WorkshopJobView): string | null => {
    const itemId = job.kind === 'repair' ? job.repairItemId : job.shieldtechItemId;
    if (!itemId) return null;
    return items.find((i) => i.id === itemId)?.name ?? null;
  };

  const workJob = async (job: WorkshopJobView) => {
    if (busyId) return;
    setBusyId(job.id);
    setError(null);
    try {
      const name = itemNameFor(job);
      await activity.start(
        buildWorkshopServiceActivity({
          id: job.id,
          label: job.kind === 'repair' ? `Repairing ${name ?? 'vehicle'}` : `Recalibrating ${name ?? 'shield'}`,
        }),
      );
      await refresh();
    } catch (err) {
      setError(humanizeWorkshopError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <MobileCard className="space-y-2" >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber">
          <PxIcon name="wrench" size={13} /> Repairs &amp; Service
        </div>
        {serviceJobs.length > 0 && (
          <span className="text-[11px] font-bold text-text-muted">{serviceJobs.length} active</span>
        )}
      </div>
      <div className="text-[11px] text-text-secondary leading-relaxed">
        Repairs and shield recalibrations run on the service lane: they progress only while
        Workshop Service is your current action, aimed at the job. The Work button aims it.
      </div>
      {serviceJobs.length === 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] text-text-secondary leading-relaxed">
            No service jobs right now. Repairs start in the Garage on a vehicle; shield
            recalibration starts from a shield&apos;s inspect sheet in your Inventory.
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.('garage')}
            className="w-full py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-[11px] font-bold active:bg-amber/20 transition-colors"
          >
            Open the Garage
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {serviceJobs.map((job) => (
            <ServiceJobRow
              key={job.id}
              job={job}
              itemName={itemNameFor(job)}
              isTargeted={activity.current.kind === 'workshop_service' && activity.current.targetId === job.id}
              onWork={(j) => void workJob(j)}
              onCancel={(id) => void cancel(id)}
              busy={busyId === job.id}
            />
          ))}
        </div>
      )}
      {error && <div className="text-[11px] text-red">{error}</div>}
    </MobileCard>
  );
};
