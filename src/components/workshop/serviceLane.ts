import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * The service lane (crafting consolidation, 2026-11-04): repair
 * and shield-tech jobs are the jobs the Garage and the shield
 * bench start. They settle under `workshop_service` — never the
 * crafting lane — and they are managed in the bench workspace's
 * Repairs & Service section, not the Workshop's Bench Jobs list.
 * One predicate, shared by both surfaces so the two lists can
 * never disagree about which jobs are service jobs.
 */
export function isServiceLaneJob(job: WorkshopJobView): boolean {
  return job.kind === 'repair' || job.kind === 'shieldtech';
}
