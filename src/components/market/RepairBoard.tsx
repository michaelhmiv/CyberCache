import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useActivityStore, usePlayerStore } from '@/store';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { fetchRepairBoard, verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { buildWorkshopServiceActivity } from '@/lib/activity/activityBuilders';
import { PATCH_KIT_BASES, REPAIR_KIT_TYPES } from '@/content/repair';
import { RepairBayScene } from '@/components/pixelArt/ActionScenes';

/**
 * Repair Services board (mechanics & repair, migration 0025).
 *
 * The open market for vehicle repair labor: owners escrow the FULL
 * price up front, terms are fixed at posting, any mechanic accepts
 * and supplies the patch kits (price = kits + labor), and the server
 * settles payout from work actually done — full price on completion,
 * pro-rata otherwise, minus the shared market fee (destroyed). This
 * screen is a consumer only: every number it shows comes from the
 * server's board view (GET /api/repair/board) and every action is a
 * verified op. There is no NPC mechanic and no private hire — worst
 * case, you walk.
 */

interface RepairVehicleViewT {
  itemId: string;
  classId: string | null;
  className: string | null;
  rarity: string | null;
  conditionCurrent: number;
  conditionMax: number;
}

interface RepairJobViewT {
  id: string;
  ownerUserId: string;
  providerUserId: string | null;
  status: string;
  outcome: string | null;
  vehicle: RepairVehicleViewT | null;
  targetPoints: number;
  pointsRestored: number;
  progress: number;
  kitProgress: number;
  priceCredits: number;
  creditsPerPoint: number;
  kitType: string | null;
  kitsConsumed: Array<{ kitType: string; quality: number; pointsApplied: number }>;
  paidCredits: number | null;
  feeCredits: number | null;
  xpAwarded: number | null;
  createdAtMs: number;
  acceptedAtMs: number | null;
  completedAtMs: number | null;
  expiresAtMs: number | null;
  reclaimable: boolean;
  queuePosition: number | null;
}

interface RepairBoardViewT {
  open: RepairJobViewT[];
  mine: RepairJobViewT[];
  work: RepairJobViewT[];
  stats: {
    medianCreditsPerPoint: number | null;
    medianSampleSize: number;
    myMasteryLevel: number;
    myJobsCompleted: number;
    myJobsAbandoned: number;
  };
  levers: {
    serviceXpPerPoint: number;
    repairAbandonWindowHours: number;
    repairListingExpiryDays: number;
    marketFeeRate: number;
  };
}

const KIT_LABELS: Record<string, string> = {
  PatchKit: 'Patch Kit',
  FieldPatchKit: 'Field Patch Kit',
  MasterPatchKit: 'Master Patch Kit',
};

function vehicleSpriteId(classId: string | null): string {
  return classId ? `vehicle-${classId.replace(/_/g, '-')}` : 'vehicle-dune-buggy';
}

function vehicleLabel(job: RepairJobViewT): string {
  return job.vehicle?.className ?? 'Vehicle';
}

function fmtTimeLeft(expiresAtMs: number | null): string {
  if (!expiresAtMs) return '';
  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return 'expiring…';
  const h = Math.floor(ms / 3600000);
  return h >= 24 ? `${Math.floor(h / 24)}d left` : `${h}h left`;
}

export const RepairBoard: React.FC = () => {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const consumables = usePlayerStore((s) => s.consumables);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const activity = useActivityStore();

  const [board, setBoard] = useState<RepairBoardViewT | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptKit, setAcceptKit] = useState<Record<string, string>>({});
  const [postVehicleId, setPostVehicleId] = useState<string>('');
  const [postPrice, setPostPrice] = useState<string>('');
  const [postTarget, setPostTarget] = useState<string>('');

  const refresh = useCallback(() => {
    void fetchRepairBoard()
      .then((result) => {
        setBoard(result as unknown as RepairBoardViewT);
        setError(null);
      })
      .catch((err) => setError(formatRpcError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  };

  const wornVehicles = useMemo(
    () => vehicles.filter((v) => v.conditionCurrent < v.conditionMax),
    [vehicles],
  );
  const postVehicle = wornVehicles.find((v) => v.id === postVehicleId) ?? wornVehicles[0];
  const postDeficit = postVehicle ? Math.ceil(postVehicle.conditionMax - postVehicle.conditionCurrent) : 0;

  const activeWork = board?.work.find((j) => j.status === 'active') ?? null;
  const completedWork = board?.work.filter((j) => j.status === 'completed') ?? [];
  const lastCompleted = completedWork[0] ?? null;
  const sceneJob = activeWork ?? lastCompleted;

  return (
    <div className="space-y-3" data-testid="repair-board">
      <div className="border border-border bg-surface/95 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-base font-black text-text-primary">Repair Services</div>
            <div className="text-[11px] text-text-muted">
              Post a vehicle, escrow the price, and any mechanic can take the job — they supply
              the patch kits; the price covers kits + labor. No NPC mechanic: unfilled jobs
              expire and refund in full.
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              refresh();
            }}
            className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
        {board && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
            <span>
              Your repair mastery: <span className="font-bold text-text-primary">Lv {board.stats.myMasteryLevel}</span>
            </span>
            <span>
              Jobs you finished: <span className="font-bold text-text-primary">{board.stats.myJobsCompleted}</span>
            </span>
            <span>
              Abandonments: <span className="font-bold text-text-primary">{board.stats.myJobsAbandoned}</span>
            </span>
            <span>
              Board median:{' '}
              <span className="font-bold text-text-primary">
                {board.stats.medianCreditsPerPoint != null
                  ? `${board.stats.medianCreditsPerPoint.toFixed(1)} cr/point (${board.stats.medianSampleSize} jobs)`
                  : 'no completed jobs yet'}
              </span>
            </span>
            <span>
              Service fee {Math.round(board.levers.marketFeeRate * 100)}% (destroyed) ·{' '}
              {board.levers.serviceXpPerPoint} XP per point restored · listings live{' '}
              {board.levers.repairListingExpiryDays}d
            </span>
          </div>
        )}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      <RepairBayScene
        progress={activeWork ? activeWork.progress : lastCompleted ? 1 : 0}
        causeLabel={sceneJob ? vehicleLabel(sceneJob) : 'Repair bay'}
        buysLabel={sceneJob ? `${sceneJob.kitsConsumed.length} kits used` : 'awaiting a job'}
        result={activeWork ? undefined : lastCompleted ? 'success' : undefined}
        vehicleSpriteId={sceneJob ? vehicleSpriteId(sceneJob.vehicle?.classId ?? null) : undefined}
      />
      {activeWork && (
        <div className="text-[11px] text-text-muted -mt-1">
          In the bay: {vehicleLabel(activeWork)} — {Math.floor(activeWork.pointsRestored)}/
          {activeWork.targetPoints} points restored. Work accrues only while Workshop Service
          targets this job.
        </div>
      )}

      {/* Post a job */}
      <div className="border border-border bg-surface/95 p-3 space-y-2">
        <div className="text-sm font-black text-text-primary">Post a repair job</div>
        {wornVehicles.length === 0 ? (
          <div className="text-[11px] text-text-muted">
            None of your vehicles need repair right now. Condition wears as you roam.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <select
                value={postVehicle?.id ?? ''}
                onChange={(e) => {
                  setPostVehicleId(e.target.value);
                  setPostTarget('');
                }}
                className="px-2 py-1.5 text-xs font-bold border border-border bg-background text-text-primary"
                aria-label="Vehicle to repair"
              >
                {wornVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {Math.floor(v.conditionCurrent)}/{v.conditionMax} condition
                  </option>
                ))}
              </select>
              <input
                value={postTarget}
                onChange={(e) => setPostTarget(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={`Points (full = ${postDeficit})`}
                className="w-36 px-2 py-1.5 text-xs border border-border bg-background text-text-primary placeholder:text-text-muted"
                aria-label="Points to restore (blank = full)"
              />
              <input
                value={postPrice}
                onChange={(e) => setPostPrice(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Price in credits (escrowed)"
                className="w-44 px-2 py-1.5 text-xs border border-border bg-background text-text-primary placeholder:text-text-muted"
                aria-label="Job price in credits"
              />
              <button
                type="button"
                disabled={busy || !postVehicle || !postPrice}
                onClick={() =>
                  void run(async () => {
                    await verifiedOps.postRepairJob(
                      postVehicle!.id,
                      Number(postPrice),
                      postTarget ? Number(postTarget) : undefined,
                    );
                    setPostPrice('');
                    setPostTarget('');
                  })
                }
                className="px-3 py-1.5 text-xs font-bold border border-amber bg-amber text-bg disabled:opacity-40"
              >
                Post + escrow
              </button>
            </div>
            <div className="text-[11px] text-text-muted">
              The full price leaves your balance into escrow at posting and the terms never
              change. Completion pays the mechanic in full; anything else pays pro-rata for
              points actually restored and refunds the rest.
              {board?.stats.medianCreditsPerPoint != null && postVehicle && (
                <>
                  {' '}At the board median ({board.stats.medianCreditsPerPoint.toFixed(1)} cr/pt),
                  this job prices around{' '}
                  {Math.round(board.stats.medianCreditsPerPoint * (postTarget ? Number(postTarget) : postDeficit))}{' '}
                  credits.
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Open postings */}
      <div className="space-y-2">
        <div className="text-sm font-black text-text-primary">Open postings</div>
        {board && board.open.length === 0 && (
          <div className="text-[11px] text-text-muted">No open jobs. Post yours above — or check back after the next roam.</div>
        )}
        {(board?.open ?? []).map((job) => {
          const mine = job.ownerUserId === myId;
          const kit = acceptKit[job.id] ?? 'PatchKit';
          const owned = consumables[kit] ?? 0;
          return (
            <div key={job.id} className="border border-border bg-surface/95 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-text-primary">
                  {vehicleLabel(job)}
                  <span className="ml-2 text-[11px] font-normal text-text-muted">
                    {job.vehicle?.rarity ?? ''}
                  </span>
                </div>
                <div className="text-sm font-black text-amber">{job.priceCredits} cr</div>
              </div>
              <div className="text-[11px] text-text-muted">
                Restore {job.targetPoints} points (now {Math.floor(job.vehicle?.conditionCurrent ?? 0)}/
                {job.vehicle?.conditionMax ?? 100}) · {job.creditsPerPoint.toFixed(1)} cr/point ·{' '}
                {fmtTimeLeft(job.expiresAtMs)}
                {mine && ' · your posting'}
              </div>
              {!mine && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={kit}
                    onChange={(e) => setAcceptKit((prev) => ({ ...prev, [job.id]: e.target.value }))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-background text-text-primary"
                    aria-label="Kit you will supply"
                  >
                    {REPAIR_KIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {KIT_LABELS[t]} — base {PATCH_KIT_BASES[t]} (own {consumables[t] ?? 0})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || owned < 1}
                    onClick={() => void run(() => verifiedOps.acceptRepairJob(job.id, kit))}
                    className="px-3 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
                  >
                    {owned < 1 ? `No ${KIT_LABELS[kit]}s` : 'Accept job'}
                  </button>
                  <span className="text-[11px] text-text-muted">
                    You supply the kits as you work; payout is the full price on completion.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* My postings */}
      {board && board.mine.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-black text-text-primary">My postings</div>
          {board.mine.map((job) => (
            <div key={job.id} className="border border-border bg-surface/95 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-text-primary">{vehicleLabel(job)}</div>
                <div className="text-[11px] text-text-muted">
                  {job.status}
                  {job.outcome ? ` · ${job.outcome}` : ''} · {job.priceCredits} cr escrowed
                </div>
              </div>
              <div className="text-[11px] text-text-muted">
                {Math.floor(job.pointsRestored)}/{job.targetPoints} points restored
                {job.paidCredits != null && job.paidCredits > 0
                  ? ` · paid ${job.paidCredits} cr (fee ${job.feeCredits ?? 0})`
                  : ''}
                {job.status === 'listed' && ' · waiting for a mechanic'}
              </div>
              {(job.status === 'listed' || job.status === 'active') && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => verifiedOps.cancelRepairJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-red-400 disabled:opacity-40"
                  >
                    {job.status === 'listed' ? 'Cancel (full refund)' : 'Cancel job'}
                  </button>
                  {job.reclaimable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => verifiedOps.reclaimRepairJob(job.id))}
                      className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
                    >
                      Reclaim vehicle (mechanic idle {board.levers.repairAbandonWindowHours}h)
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* My workbench */}
      {board && board.work.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-black text-text-primary">My workbench</div>
          {board.work
            .filter((j) => j.status === 'active')
            .map((job) => (
              <div key={job.id} className="border border-border bg-surface/95 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-text-primary">
                    {vehicleLabel(job)}
                    {job.queuePosition != null && job.queuePosition > 1 && (
                      <span className="ml-2 text-[11px] font-normal text-text-muted">
                        queue #{job.queuePosition}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {job.kitType ? KIT_LABELS[job.kitType] ?? job.kitType : ''} · {job.priceCredits} cr
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-text-muted">
                    <span>Restored</span>
                    <span>
                      {Math.floor(job.pointsRestored)} / {job.targetPoints} points ·{' '}
                      {job.kitsConsumed.length} kits used
                    </span>
                  </div>
                  <div className="h-2 bg-background border border-border">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.round(job.progress * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await activity.start(
                          buildWorkshopServiceActivity({
                            id: job.id,
                            label: `Repairing ${vehicleLabel(job)}`,
                          }),
                        );
                      })
                    }
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
                  >
                    Work on it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => verifiedOps.finishRepairJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-emerald-400 disabled:opacity-40"
                  >
                    Deliver now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => verifiedOps.cancelRepairJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-red-400 disabled:opacity-40"
                  >
                    Quit job
                  </button>
                </div>
                <div className="text-[11px] text-text-muted">
                  Delivering early pays pro-rata for points restored so far — full price only at
                  the full target.
                </div>
              </div>
            ))}
          {completedWork.slice(0, 5).map((job) => (
            <div key={job.id} className="border border-border bg-surface/60 p-2 text-[11px] text-text-muted">
              {vehicleLabel(job)} — {job.outcome ?? job.status}: restored{' '}
              {Math.floor(job.pointsRestored)}/{job.targetPoints} pts, earned {job.paidCredits ?? 0} cr
              (fee {job.feeCredits ?? 0})
              {job.xpAwarded != null ? ` · +${job.xpAwarded} XP` : ''}
            </div>
          ))}
        </div>
      )}

      {loading && !board && <div className="text-xs text-text-muted">Loading the board…</div>}
    </div>
  );
};
