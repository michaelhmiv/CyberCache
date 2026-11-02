/**
 * boardRequirements — what taking a service-board job demands of
 * the READER, computed server-side so the requirement sits on the
 * job card's face instead of surfacing as a refused accept.
 *
 * Both lanes share one shape of truth (the rulings in
 * src/content/repair.ts, inherited by src/content/shieldTech.ts):
 * the TAKER supplies the consumable the lane burns — patch kits on
 * repair jobs (type chosen at accept), Calibration Cores on
 * shield-tech jobs — and accept requires a verified account, a job
 * that is not the reader's own, and at least one unit of supply.
 * Mastery is NEVER a gate: it prices speed and efficiency only, and
 * both show up here as the reader's own pace estimates.
 *
 * Estimates walk the reader's real batches in the burn order the
 * settlers use (worst quality first, then oldest — cc_consume_
 * consumable_batch's FIFO), at the efficiency the accept snapshot
 * would stamp. The repair rate mirrors the accept snapshot's
 * mastery × Fixer composition; the one term deliberately excluded
 * is the research Wrench Basics multiplier, which only ever makes
 * the real job faster — the card quotes the pace the reader is
 * guaranteed, never a faster one. Running dry mid-job is legal in
 * both lanes (work stalls, banked points are kept), so holdings
 * below the target are a warning on the card, not a blocker.
 */

/** One consumable batch reduced to what an estimate needs. */
export interface SupplyBatch {
  quality: number;
  quantity: number;
}

/** The reader facts both board builders price requirements from. */
export interface ServiceReaderFacts {
  /** can_use_player_economy — the accept gate's own predicate. */
  verified: boolean;
  /** Supply batches per consumable type, in burn order
   *  (worst quality first, then oldest). */
  batchesByType: ReadonlyMap<string, readonly SupplyBatch[]>;
  /** Work rate at the reader's mastery (+ Fixer terms, repair). */
  workRatePointsPerHour: number;
  /** Per-unit yield multiplier the accept snapshot would stamp. */
  efficiency: number;
}

export type ServiceJobBlocker = 'unverified' | 'own_job' | 'no_supply';

/** Requirements on an open repair posting, for the reader. */
export interface RepairJobRequirements {
  /** Credits the owner escrowed up front (the job's price). */
  escrowCredits: number;
  /** True when the reader could accept right now. */
  canTake: boolean;
  /** Why not, when canTake is false — shown on the card's face. */
  blockers: ServiceJobBlocker[];
  /** One entry per patch-kit type: what the reader holds and what
   *  finishing would burn at the reader's efficiency. */
  kitOptions: RepairKitOption[];
  /** Wall-clock hours to finish the full target at the reader's
   *  work rate (null when the rate is unknown). */
  estimatedHours: number | null;
}

export interface RepairKitOption {
  kitType: string;
  /** Total units of this type the reader holds. */
  onHand: number;
  /** Units burned to reach the target walking the reader's batches
   *  in burn order — null when the reader's stock cannot cover the
   *  target (they would run dry partway; legal, but flagged). */
  estimatedKits: number | null;
  coversTarget: boolean;
}

/** Requirements on an open shield-tech posting, for the reader. */
export interface ShieldTechJobRequirements {
  escrowCredits: number;
  canTake: boolean;
  blockers: ServiceJobBlocker[];
  /** Calibration Cores the reader holds, all batches. */
  coresOnHand: number;
  /** Cores burned to finish, walking the reader's batches in burn
   *  order at the reader's efficiency — null when the reader's
   *  stock cannot cover the target. */
  estimatedCores: number | null;
  coversTarget: boolean;
  estimatedHours: number | null;
}

/**
 * Units of one supply walked worst-first until the target is
 * covered: each unit yields `pointsPerUnit(quality)` at the
 * reader's efficiency. Returns the unit count, or null when the
 * whole stock cannot cover the target.
 */
export function unitsNeededForTarget(
  batchesWorstFirst: readonly SupplyBatch[],
  targetPoints: number,
  pointsPerUnit: (quality: number) => number,
): number | null {
  if (targetPoints <= 0) return null;
  let covered = 0;
  let count = 0;
  for (const batch of batchesWorstFirst) {
    for (let i = 0; i < batch.quantity; i += 1) {
      covered += pointsPerUnit(batch.quality);
      count += 1;
      if (covered >= targetPoints) return count;
    }
  }
  return null;
}

export function totalOnHand(batches: readonly SupplyBatch[] | undefined): number {
  return (batches ?? []).reduce((sum, b) => sum + Math.max(0, b.quantity), 0);
}

function estimatedHours(targetPoints: number, rate: number): number | null {
  if (!(rate > 0) || targetPoints <= 0) return null;
  return Math.round((targetPoints / rate) * 10) / 10;
}

export function repairJobRequirements(input: {
  ownerUserId: string;
  callerId: string;
  targetPoints: number;
  priceCredits: number;
  kitTypes: readonly string[];
  kitBase: (kitType: string) => number;
  kitRestorePoints: (kitBase: number, qualityPct: number, efficiency: number) => number;
  reader: ServiceReaderFacts;
}): RepairJobRequirements {
  const blockers: ServiceJobBlocker[] = [];
  if (!input.reader.verified) blockers.push('unverified');
  if (input.ownerUserId === input.callerId) blockers.push('own_job');
  const kitOptions = input.kitTypes.map((kitType) => {
    const batches = input.reader.batchesByType.get(kitType) ?? [];
    const onHand = totalOnHand(batches);
    const estimatedKits = unitsNeededForTarget(batches, input.targetPoints, (quality) =>
      input.kitRestorePoints(input.kitBase(kitType), quality, input.reader.efficiency));
    return { kitType, onHand, estimatedKits, coversTarget: estimatedKits !== null };
  });
  if (!kitOptions.some((o) => o.onHand >= 1)) blockers.push('no_supply');
  return {
    escrowCredits: input.priceCredits,
    canTake: blockers.length === 0,
    blockers,
    kitOptions,
    estimatedHours: estimatedHours(input.targetPoints, input.reader.workRatePointsPerHour),
  };
}

export function shieldTechJobRequirements(input: {
  ownerUserId: string;
  callerId: string;
  targetPoints: number;
  priceCredits: number;
  coreType: string;
  coresNeeded: (
    batchesWorstFirst: Array<{ quality: number; quantity: number }>,
    targetPoints: number,
    efficiency: number,
  ) => number | null;
  reader: ServiceReaderFacts;
}): ShieldTechJobRequirements {
  const blockers: ServiceJobBlocker[] = [];
  if (!input.reader.verified) blockers.push('unverified');
  if (input.ownerUserId === input.callerId) blockers.push('own_job');
  const batches = input.reader.batchesByType.get(input.coreType) ?? [];
  const coresOnHand = totalOnHand(batches);
  if (coresOnHand < 1) blockers.push('no_supply');
  const estimatedCores = input.coresNeeded(
    batches.map((b) => ({ quality: b.quality, quantity: b.quantity })),
    input.targetPoints,
    input.reader.efficiency,
  );
  return {
    escrowCredits: input.priceCredits,
    canTake: blockers.length === 0,
    blockers,
    coresOnHand,
    estimatedCores,
    coversTarget: estimatedCores !== null,
    estimatedHours: estimatedHours(input.targetPoints, input.reader.workRatePointsPerHour),
  };
}
