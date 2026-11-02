import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useEconomyTransactLock } from '@/auth/useEconomyTransactLock';
import { useActivityStore, useInventoryStore, useLoadoutStore, useMarketStore, usePlayerStore } from '@/store';
import { fetchShieldTechBoard, verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { buildWorkshopServiceActivity } from '@/lib/activity/activityBuilders';
import { legalShieldTechTargets, rebasedShieldPayload } from '@/content/shieldTech';
import { SHIELD_BEHAVIORS, describeShieldBehavior, shieldBehaviorOf, type ShieldBehaviorId } from '@/lib/combat/shieldBehaviors';
import {
  hasServiceBoardBrowseTerms,
  type ServiceBoardQuery,
} from '@/lib/market/boardQuery';
import { DEFAULT_LISTING_LIMIT } from '@/lib/market/listingQuery';
import { ServiceBoardControls, type ServiceBoardSortOption } from '@/components/market/ServiceBoardControls';
import type { GearItem, Shield } from '@/types/items';
import type { Rarity } from '@/types/game';
import { ShieldTechBayScene } from '@/components/pixelArt/ActionScenes';

/**
 * Shield-Tech Services board (migration 0044).
 *
 * The open market for shield behavior recalibration: owners escrow
 * the FULL price up front, terms are fixed at posting, any shield
 * tech accepts and supplies the Calibration Cores (price = cores +
 * labor), and the server settles payout from work actually done —
 * full price on completion, pro-rata otherwise, minus the shared
 * market fee (destroyed). The behavior flip lands only at 100%, and
 * a Legendary shield can never be recalibrated down to Standard
 * (R8 — the target picker never offers it and the server refuses
 * it). This screen is a consumer only: every number it shows comes
 * from the server's board view (GET /api/shieldtech/board) and every
 * action is a verified op. There is no NPC shield tech and no
 * private hire.
 */

interface ShieldTechShieldViewT {
  itemId: string;
  rarity: string | null;
  capacity: number | null;
  behavior: ShieldBehaviorId;
  behaviorName: string;
}

interface ShieldTechJobRequirementsT {
  escrowCredits: number;
  canTake: boolean;
  blockers: string[];
  coresOnHand: number;
  estimatedCores: number | null;
  coversTarget: boolean;
  estimatedHours: number | null;
}

interface ShieldTechJobViewT {
  id: string;
  ownerUserId: string;
  ownerName: string | null;
  providerUserId: string | null;
  providerName: string | null;
  status: string;
  outcome: string | null;
  shield: ShieldTechShieldViewT | null;
  fromBehavior: ShieldBehaviorId | null;
  fromBehaviorName: string | null;
  fromBehaviorDescription: string | null;
  toBehavior: ShieldBehaviorId | null;
  toBehaviorName: string | null;
  toBehaviorDescription: string | null;
  flipApplied: boolean | null;
  targetPoints: number;
  pointsCalibrated: number;
  progress: number;
  coreProgress: number;
  priceCredits: number;
  creditsPerPoint: number;
  estimatedCoresForReader: number | null;
  kitsConsumed: Array<{ kitType: string; quality: number; pointsApplied: number }>;
  paidCredits: number | null;
  feeCredits: number | null;
  xpAwarded: number | null;
  createdAtMs: number;
  acceptedAtMs: number | null;
  completedAtMs: number | null;
  expiresAtMs: number | null;
  lastProgressAtMs: number | null;
  reclaimable: boolean;
  queuePosition: number | null;
  requirements: ShieldTechJobRequirementsT | null;
}

interface ShieldTechBoardViewT {
  open: ShieldTechJobViewT[];
  openTotal: number;
  mine: ShieldTechJobViewT[];
  work: ShieldTechJobViewT[];
  medianPerThousandByRarity: Record<string, number | null>;
  stats: {
    medianSampleSize: number;
    myMasteryLevel: number;
    myMasteryXp: number;
    myJobsCompleted: number;
    myJobsAbandoned: number;
  };
  levers: {
    shieldTechXpPerPoint: number;
    shieldTechAbandonWindowHours: number;
    shieldTechListingExpiryDays: number;
    marketFeeRate: number;
  };
}

const BOARD_PAGE_SIZE = DEFAULT_LISTING_LIMIT;

const SHIELD_TECH_SORT_OPTIONS: ServiceBoardSortOption[] = [
  { value: 'newest', label: 'Sort: Newest' },
  { value: 'pay_desc', label: 'Sort: Priciest' },
  { value: 'pay_asc', label: 'Sort: Cheapest' },
  { value: 'condition', label: 'Sort: Smallest job' },
  { value: 'expiring', label: 'Sort: Expiring soon' },
];

const isShieldItem = (item: GearItem): item is Shield => 'hp' in item && !('weaponType' in item);

function shieldLabel(job: ShieldTechJobViewT): string {
  return `${job.shield?.rarity ?? ''} Shield`.trim();
}

function swapLabel(job: ShieldTechJobViewT): string {
  return `${job.fromBehaviorName ?? '?'} → ${job.toBehaviorName ?? '?'}`;
}

function fmtTimeLeft(expiresAtMs: number | null): string {
  if (!expiresAtMs) return '';
  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return 'expiring…';
  const hrs = Math.floor(ms / 3600000);
  return hrs >= 24 ? `${Math.floor(hrs / 24)}d left` : `${hrs}h left`;
}

export const ShieldTechBoard: React.FC = () => {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const consumables = usePlayerStore((s) => s.consumables);
  const inventory = useInventoryStore((s) => s.items);
  const loadout = useLoadoutStore();

  // Real-item invariant: the bay hunter carries the player's actual
  // weapon state — unequipped renders the gun-free rig.
  const hunterWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy');
  const activity = useActivityStore();

  const [board, setBoard] = useState<ShieldTechBoardViewT | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preselect = useMarketStore((s) => s.shieldTechPreselect);
  const setPreselect = useMarketStore((s) => s.setShieldTechPreselect);
  const [postShieldId, setPostShieldId] = useState<string>('');
  // GearHub deep link: until the owner picks a shield themselves,
  // the handed-off shield drives the form (derived, not copied into
  // state); picking a shield or leaving the tab clears the hand-off.
  const effectivePostShieldId = postShieldId || preselect || '';
  const [postBehavior, setPostBehavior] = useState<string>('');
  const [postPrice, setPostPrice] = useState<string>('');

  // Browse state (market-lane parity): the query lives in the
  // market store so it survives tab switches; an untouched board
  // fetches unqueried (the full board, oldest first), and any
  // browse term switches fetches to paged queries of the Buy
  // lane's page size, appended by Load more.
  const boardQuery = useMarketStore((s) => s.shieldTechBoardQuery);
  const setBoardQuery = useMarketStore((s) => s.setShieldTechBoardQuery);
  const browseActive = hasServiceBoardBrowseTerms(boardQuery);
  const [extraOpen, setExtraOpen] = useState<ShieldTechJobViewT[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageArgs = useCallback(
    (offset: number): ServiceBoardQuery =>
      (browseActive ? { ...boardQuery, limit: BOARD_PAGE_SIZE, offset } : {}),
    [boardQuery, browseActive],
  );

  const refresh = useCallback(() => {
    void fetchShieldTechBoard(pageArgs(0))
      .then((result) => {
        setBoard(result as unknown as ShieldTechBoardViewT);
        setExtraOpen([]);
        setError(null);
      })
      .catch((err) => setError(formatRpcError(err)))
      .finally(() => setLoading(false));
  }, [pageArgs]);

  // Mount fetch is immediate; browse changes refetch debounced
  // (the Buy lane's 200ms), restarting at page 1.
  const firstFetch = useRef(true);
  useEffect(() => {
    if (firstFetch.current) {
      firstFetch.current = false;
      refresh();
      return;
    }
    const timer = setTimeout(refresh, 200);
    return () => clearTimeout(timer);
  }, [refresh]);

  const openJobs = useMemo(
    () => [...(board?.open ?? []), ...extraOpen],
    [board, extraOpen],
  );
  const openTotal = board?.openTotal ?? 0;

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    void fetchShieldTechBoard(pageArgs(openJobs.length))
      .then((result) => {
        const page = result as unknown as ShieldTechBoardViewT;
        setExtraOpen((prev) => [...prev, ...page.open]);
        setError(null);
      })
      .catch((err) => setError(formatRpcError(err)))
      .finally(() => setLoadingMore(false));
  }, [pageArgs, openJobs.length]);

  useEffect(() => () => {
    useMarketStore.getState().setShieldTechPreselect(null);
  }, []);

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

  // Guest-visibility law (2026-11-01): the board renders for every
  // session (the read accepts any JWT) — the lock sits on the
  // transact actions. A guest tapping Post / Accept / Cancel gets
  // the sign-in prompt; the server refuses the op regardless
  // (cc_post_shieldtech_job / cc_accept_shieldtech_job check
  // can_use_player_economy). The self-lane enqueue is NOT an economy
  // op and is deliberately untouched — guests recalibrate their own
  // shields (0044 test-pinned). "Work on it" likewise stays on run().
  const { locked: economyLocked, guardTransact, prompt: transactLockPrompt } = useEconomyTransactLock();
  const runTransact = (action: string, fn: () => Promise<unknown>) =>
    guardTransact(action, () => void run(fn));

  const equippedIds = useMemo(
    () => new Set(Object.values(loadout.slots).filter(Boolean) as string[]),
    [loadout.slots],
  );
  const myShields = useMemo(
    () => inventory.filter((i) => isShieldItem(i) && !i.isLocked && !equippedIds.has(i.id)),
    [inventory, equippedIds],
  );
  const postShield = myShields.find((s) => s.id === effectivePostShieldId) ?? myShields[0];
  const postFrom = postShield ? shieldBehaviorOf(postShield) : null;
  const postTargets = postShield && postFrom
    ? legalShieldTechTargets(postShield.rarity as Rarity, postFrom)
    : [];
  const postTarget = postTargets.includes(postBehavior as ShieldBehaviorId)
    ? (postBehavior as ShieldBehaviorId)
    : postTargets[0];
  const postMedian = postShield ? board?.medianPerThousandByRarity[postShield.rarity] ?? null : null;
  const postSuggested = postShield && postMedian != null
    ? Math.round((postMedian * postShield.hp) / 1000)
    : null;

  const activeWork = board?.work.find((j) => j.status === 'active') ?? null;
  const completedWork = board?.work.filter((j) => j.status === 'completed') ?? [];
  const lastCompleted = completedWork[0] ?? null;
  const sceneJob = activeWork ?? lastCompleted;
  const myCores = consumables['CalibrationCore'] ?? 0;

  return (
    <div className="space-y-3" data-testid="shieldtech-board">
      <div className="border border-border bg-surface/95 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-base font-black text-text-primary">Shield Tech</div>
            <div className="text-[11px] text-text-muted">
              Post a shield, escrow the price, and any shield tech can take the job — they
              supply the Calibration Cores; the price covers cores + labor. The behavior
              flip lands only at 100% calibration. No NPC tech: unfilled jobs expire and
              refund in full.
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
              Your shield-tech mastery: <span className="font-bold text-text-primary">Lv {board.stats.myMasteryLevel}</span>
            </span>
            <span>
              Jobs you finished: <span className="font-bold text-text-primary">{board.stats.myJobsCompleted}</span>
            </span>
            <span>
              Abandonments: <span className="font-bold text-text-primary">{board.stats.myJobsAbandoned}</span>
            </span>
            <span>
              Your Calibration Cores: <span className="font-bold text-text-primary">{myCores}</span>
            </span>
            <span>
              Service fee {Math.round(board.levers.marketFeeRate * 100)}% (destroyed) ·{' '}
              {board.levers.shieldTechXpPerPoint} XP per point calibrated · listings live{' '}
              {board.levers.shieldTechListingExpiryDays}d
            </span>
          </div>
        )}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      {transactLockPrompt}

      <ShieldTechBayScene
        progress={activeWork ? activeWork.progress : lastCompleted ? 1 : 0}
        causeLabel={sceneJob ? `${shieldLabel(sceneJob)} — ${swapLabel(sceneJob)}` : 'Calibration rig'}
        buysLabel={sceneJob ? `${sceneJob.kitsConsumed.length} cores used` : 'awaiting a job'}
        result={activeWork ? undefined : lastCompleted ? 'success' : undefined}
        behaviorGlyphId={sceneJob?.toBehavior ? `glyph-behavior-${sceneJob.toBehavior}` : null}
        unarmed={!hunterWeapon}
      />
      {activeWork && (
        <div className="text-[11px] text-text-muted -mt-1">
          In the rig: {shieldLabel(activeWork)} — {Math.floor(activeWork.pointsCalibrated)}/
          {activeWork.targetPoints} points calibrated ({swapLabel(activeWork)}). Work accrues
          only while Workshop Service targets this job.
        </div>
      )}

      {/* Post a job */}
      <div className="border border-border bg-surface/95 p-3 space-y-2">
        <div className="text-sm font-black text-text-primary">Post a recalibration</div>
        {myShields.length === 0 ? (
          <div className="text-[11px] text-text-muted">
            No available shields to recalibrate. Equipped and locked shields stay out of the
            rig — unequip first if you want one recalibrated.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <select
                value={postShield?.id ?? ''}
                onChange={(e) => {
                  setPostShieldId(e.target.value);
                  setPostBehavior('');
                  setPreselect(null);
                }}
                className="px-2 py-1.5 text-xs font-bold border border-border bg-background text-text-primary"
                aria-label="Shield to recalibrate"
              >
                {myShields.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.rarity}, {SHIELD_BEHAVIORS[shieldBehaviorOf(s)].name}, {s.hp} HP
                  </option>
                ))}
              </select>
              <select
                value={postTarget ?? ''}
                onChange={(e) => setPostBehavior(e.target.value)}
                className="px-2 py-1.5 text-xs font-bold border border-border bg-background text-text-primary"
                aria-label="Target behavior"
              >
                {postTargets.map((t) => (
                  <option key={t} value={t}>
                    → {SHIELD_BEHAVIORS[t].name}
                  </option>
                ))}
              </select>
              <input
                value={postPrice}
                onChange={(e) => setPostPrice(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Price in credits (escrowed)"
                className="w-44 px-2 py-1.5 text-xs border border-border bg-background text-text-primary placeholder:text-text-muted"
                aria-label="Job price in credits"
              />
              <button
                type="button"
                disabled={busy || !postShield || !postTarget || !postPrice}
                onClick={() =>
                  runTransact('post a shield-tech job', async () => {
                    await verifiedOps.postShieldTechJob(postShield!.id, postTarget!, Number(postPrice));
                    setPostPrice('');
                  })
                }
                className="px-3 py-1.5 text-xs font-bold border border-amber bg-amber text-bg disabled:opacity-40"
              >
                Post + escrow{economyLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}
              </button>
            </div>
            {postShield && postTarget && (
              <div className="text-[11px] text-text-muted">
                {SHIELD_BEHAVIORS[postTarget].name}: {
                  // The to-line priced on the rebased shield the owner
                  // will actually receive (Turtle targets show their
                  // real post-flip capacity).
                  describeShieldBehavior(
                    postTarget,
                    rebasedShieldPayload(
                      postShield as unknown as Record<string, unknown>,
                      postTarget,
                    ) as unknown as Shield,
                  )
                }{' '}
                Work size is the shield's stored capacity: {postShield.hp} calibration points.
                The full price leaves your balance into escrow at posting and the terms never
                change. Completion pays the tech in full; anything else pays pro-rata for
                points actually calibrated and refunds the rest.
                {postShield.rarity === 'Legendary' && (
                  <> A Legendary shield can never be recalibrated down to Standard (R8).</>
                )}
                {postSuggested != null && (
                  <>
                    {' '}At the board median for {postShield.rarity} shields, this job prices
                    around {postSuggested} credits.
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Open postings */}
      <div className="space-y-2">
        <div className="text-sm font-black text-text-primary">Open postings</div>
        <ServiceBoardControls
          query={boardQuery}
          onChange={setBoardQuery}
          total={board ? openTotal : null}
          searchPlaceholder="Search shields, behaviors, owners…"
          sortOptions={SHIELD_TECH_SORT_OPTIONS}
          noun="job"
        >
          <div className="flex gap-2">
            <select
              value={boardQuery.fromBehavior ?? ''}
              onChange={(e) => setBoardQuery({ fromBehavior: e.target.value || undefined })}
              aria-label="Current behavior filter"
              className="flex-1 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
            >
              <option value="">From: any behavior</option>
              {Object.entries(SHIELD_BEHAVIORS).map(([id, def]) => (
                <option key={id} value={id}>From: {def.name}</option>
              ))}
            </select>
            <select
              value={boardQuery.toBehavior ?? ''}
              onChange={(e) => setBoardQuery({ toBehavior: e.target.value || undefined })}
              aria-label="Target behavior filter"
              className="flex-1 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
            >
              <option value="">To: any behavior</option>
              {Object.entries(SHIELD_BEHAVIORS).map(([id, def]) => (
                <option key={id} value={id}>To: {def.name}</option>
              ))}
            </select>
          </div>
        </ServiceBoardControls>
        {board && openJobs.length === 0 && (
          <div className="text-[11px] text-text-muted">
            {browseActive
              ? 'No jobs match those filters. Loosen a band or clear the search.'
              : 'No open jobs. Post yours above — or check back after the next roam.'}
          </div>
        )}
        {openJobs.map((job) => {
          const mine = job.ownerUserId === myId;
          const median = job.shield?.rarity ? board?.medianPerThousandByRarity[job.shield.rarity] ?? null : null;
          const req = job.requirements;
          return (
            <div key={job.id} className="border border-border bg-surface/95 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-text-primary">
                  {shieldLabel(job)}
                  <span className="ml-2 text-[11px] font-normal text-text-muted">{swapLabel(job)}</span>
                </div>
                <div className="text-sm font-black text-amber">{job.priceCredits} cr</div>
              </div>
              <div className="text-[11px] text-text-muted">
                Calibrate {job.targetPoints} points · {job.creditsPerPoint.toFixed(2)} cr/point ·{' '}
                {fmtTimeLeft(job.expiresAtMs)}
                {req == null && job.estimatedCoresForReader != null && ` · ≈${job.estimatedCoresForReader} cores at your efficiency`}
                {median != null && ` · board median ${median.toFixed(0)} cr / 1,000 pts for ${job.shield?.rarity}`}
                {job.ownerName && ` · posted by ${job.ownerName}`}
                {mine && ' · your posting'}
              </div>
              {req && !mine && (
                <div className="text-[11px] text-text-muted">
                  <span className="font-bold text-text-primary">Escrow held: {req.escrowCredits} cr.</span>{' '}
                  {req.blockers.includes('unverified') ? (
                    <>Sign in with a verified account to take jobs.</>
                  ) : req.blockers.includes('no_supply') ? (
                    <>Needs Calibration Cores to start — you have none. The tech supplies the cores; the price covers cores + labor.</>
                  ) : (
                    <>
                      You supply the cores: ≈{req.estimatedCores ?? '—'} to finish
                      {req.estimatedHours != null && ` (~${req.estimatedHours}h at your pace)`} · you have {req.coresOnHand}.
                      {!req.coversTarget && (
                        <> Your stock won&apos;t cover the full job — work stalls when you run dry, and banked points are kept.</>
                      )}
                    </>
                  )}
                </div>
              )}
              {job.fromBehaviorDescription && (
                <div className="text-[11px] text-text-muted">
                  <span className="font-bold text-text-primary">{job.fromBehaviorName}:</span>{' '}
                  {job.fromBehaviorDescription}
                </div>
              )}
              {job.toBehaviorDescription && (
                <div className="text-[11px] text-text-muted">
                  <span className="font-bold text-text-primary">{job.toBehaviorName}:</span>{' '}
                  {job.toBehaviorDescription}
                </div>
              )}
              {!mine && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || (!economyLocked && myCores < 1)}
                    onClick={() => runTransact('take this shield-tech job', () => verifiedOps.acceptShieldTechJob(job.id))}
                    className="px-3 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
                  >
                    {economyLocked ? (<>Accept job<Lock size={11} className="ml-1 inline" aria-hidden /></>) : myCores < 1 ? 'No Calibration Cores' : 'Accept job'}
                  </button>
                  <span className="text-[11px] text-text-muted">
                    You supply the cores as you work; payout is the full price on completion.
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {openJobs.length < openTotal && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-border bg-surface-raised py-2 text-xs font-bold text-text-secondary disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : `Load more (${(openTotal - openJobs.length).toLocaleString()} more)`}
          </button>
        )}
      </div>

      {/* My postings */}
      {board && board.mine.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-black text-text-primary">My postings</div>
          {board.mine.map((job) => (
            <div key={job.id} className="border border-border bg-surface/95 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-text-primary">
                  {shieldLabel(job)}
                  <span className="ml-2 text-[11px] font-normal text-text-muted">{swapLabel(job)}</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {job.status}
                  {job.outcome ? ` · ${job.outcome}` : ''} · {job.priceCredits} cr escrowed
                </div>
              </div>
              <div className="text-[11px] text-text-muted">
                {Math.floor(job.pointsCalibrated)}/{job.targetPoints} points calibrated
                {job.paidCredits != null && job.paidCredits > 0
                  ? ` · paid ${job.paidCredits} cr (fee ${job.feeCredits ?? 0})`
                  : ''}
                {job.status === 'completed' && job.flipApplied === true && ' · behavior flipped'}
                {job.status === 'completed' && job.flipApplied === false && ' · flip refused (shield changed under the job)'}
                {job.status === 'listed' && ' · waiting for a shield tech'}
              </div>
              {(job.status === 'listed' || job.status === 'active') && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runTransact('manage this job', () => verifiedOps.cancelShieldTechJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-red-400 disabled:opacity-40"
                  >
                    {job.status === 'listed' ? 'Cancel (full refund)' : 'Cancel job'}
                  </button>
                  {job.reclaimable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runTransact('manage this job', () => verifiedOps.reclaimShieldTechJob(job.id))}
                      className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-amber disabled:opacity-40"
                    >
                      Reclaim shield (tech idle {board.levers.shieldTechAbandonWindowHours}h)
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
                    {shieldLabel(job)}
                    <span className="ml-2 text-[11px] font-normal text-text-muted">{swapLabel(job)}</span>
                    {job.queuePosition != null && job.queuePosition > 1 && (
                      <span className="ml-2 text-[11px] font-normal text-text-muted">
                        queue #{job.queuePosition}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted">{job.priceCredits} cr</div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-text-muted">
                    <span>Calibrated</span>
                    <span>
                      {Math.floor(job.pointsCalibrated)} / {job.targetPoints} points ·{' '}
                      {job.kitsConsumed.length} cores used
                    </span>
                  </div>
                  <div className="h-2 bg-background border border-border">
                    <div
                      className="h-full bg-cyan-500"
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
                            label: `Calibrating ${shieldLabel(job)} (${swapLabel(job)})`,
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
                    onClick={() => runTransact('manage this job', () => verifiedOps.finishShieldTechJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-emerald-400 disabled:opacity-40"
                  >
                    Deliver now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runTransact('manage this job', () => verifiedOps.cancelShieldTechJob(job.id))}
                    className="px-2 py-1 text-xs font-bold border border-border bg-surface hover:text-red-400 disabled:opacity-40"
                  >
                    Quit job
                  </button>
                </div>
                <div className="text-[11px] text-text-muted">
                  Delivering early pays pro-rata for points calibrated so far — the flip lands
                  only at the full target.
                </div>
              </div>
            ))}
          {completedWork.slice(0, 5).map((job) => (
            <div key={job.id} className="border border-border bg-surface/60 p-2 text-[11px] text-text-muted">
              {shieldLabel(job)} ({swapLabel(job)}) — {job.outcome ?? job.status}: calibrated{' '}
              {Math.floor(job.pointsCalibrated)}/{job.targetPoints} pts, earned {job.paidCredits ?? 0} cr
              (fee {job.feeCredits ?? 0})
              {job.xpAwarded != null ? ` · +${job.xpAwarded} XP` : ''}
              {job.flipApplied === true ? ' · flipped' : ''}
            </div>
          ))}
        </div>
      )}

      {loading && !board && <div className="text-xs text-text-muted">Loading the board…</div>}
    </div>
  );
};
