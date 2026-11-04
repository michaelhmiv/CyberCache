/**
 * SB-3 — "Start from build" prefill for dispatch (saved-builds
 * brief §3 / D7).
 *
 * A build is a REFERENCE list, never a claim (brief D8): this
 * module reads a build's slot map against the Chef's dispatch
 * candidate list and sorts every named item into exactly one
 * truth — the item can dispatch now (`ready`), or it cannot, with
 * the reason as data (`gone` / `listed` / `in_service` / `locked` /
 * `equipped`). Nothing here mutates anything: the panel takes the
 * ready ids into its ordinary pick state, manual toggles rule
 * afterward, and departure stays server-validated exactly as
 * before (migration 0032: an item departs only when its record is
 * `available` and unequipped at departure time).
 *
 * The candidate list is the Chef's own facts (every item record
 * the player owns, all states), so a build item missing from it
 * has left the player's records entirely — sold, traded away, or
 * deleted — and reads as `gone`. Items still on record in a
 * terminal state ('consumed' / 'salvaged') read as `gone` too.
 *
 * Family shapes follow the shipped forms exactly: a foot contract
 * takes the build's seven GEAR slots (its vehicle is not part of a
 * foot loadout and is never reported); a courier contract takes
 * the build's vehicle slot only. The belt is display state for
 * boss fights — dispatch has no belt, so it plays no role here.
 */
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import type {
  ChefDispatchCandidate,
  ChefDispatchMission,
} from '@/lib/chef/chefClient';

export type BuildPrefillStatus =
  | 'ready'
  | 'gone'
  | 'listed'
  | 'in_service'
  | 'locked'
  | 'equipped';

export interface BuildPrefillLine {
  slot: LoadoutSlot;
  itemId: string;
  /** The Chef-carried item name; null when the item is gone (its
   *  record — and its name — left with it). */
  name: string | null;
  status: BuildPrefillStatus;
  /** `in_service` only: when the mission holding the item returns
   *  it (the mission's ends_at, ISO). Null when no active mission
   *  on record names the item. */
  returnsAt: string | null;
}

export interface BuildPrefill {
  /** Gear ids that can dispatch now (foot family), in slot order. */
  readyItemIds: string[];
  /** The build's vehicle id when it can courier now, else null. */
  readyVehicleId: string | null;
  /** One line per non-empty build slot relevant to the family, in
   *  slot order — ready and flagged alike, so nothing a build
   *  names is ever silently dropped. */
  lines: BuildPrefillLine[];
}

const GEAR_SLOTS: readonly LoadoutSlot[] = [
  'primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic',
];

function classify(
  candidate: ChefDispatchCandidate | undefined,
  missions: readonly ChefDispatchMission[],
): { status: BuildPrefillStatus; returnsAt: string | null } {
  if (!candidate) return { status: 'gone', returnsAt: null };
  const state = candidate.runtimeState;
  if (state === 'in_service') {
    const holder = missions.find(
      (m) =>
        m.status === 'active' &&
        (m.loadout_item_ids.includes(candidate.id) || m.vehicle_item_id === candidate.id),
    );
    return { status: 'in_service', returnsAt: holder?.ends_at ?? null };
  }
  if (state === 'listed') return { status: 'listed', returnsAt: null };
  if (state === 'consumed' || state === 'salvaged') {
    return { status: 'gone', returnsAt: null };
  }
  if (candidate.equippedSlot !== null || state === 'equipped') {
    return { status: 'equipped', returnsAt: null };
  }
  if (candidate.isLocked || state === 'locked') {
    return { status: 'locked', returnsAt: null };
  }
  if (state === 'available') return { status: 'ready', returnsAt: null };
  // A state this client does not name: the item is committed
  // somewhere — never present it as ready.
  return { status: 'locked', returnsAt: null };
}

export function computeBuildPrefill(input: {
  slots: Record<LoadoutSlot, string | null>;
  family: 'foot' | 'courier';
  candidates: readonly ChefDispatchCandidate[];
  missions: readonly ChefDispatchMission[];
}): BuildPrefill {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const relevant: readonly LoadoutSlot[] =
    input.family === 'foot' ? GEAR_SLOTS : ['vehicle'];

  const lines: BuildPrefillLine[] = [];
  const readyItemIds: string[] = [];
  let readyVehicleId: string | null = null;

  for (const slot of relevant) {
    const itemId = input.slots[slot];
    if (!itemId) continue; // the build names nothing here — not a line
    const candidate = byId.get(itemId);
    const { status, returnsAt } = classify(candidate, input.missions);
    lines.push({
      slot,
      itemId,
      name: candidate?.name ?? null,
      status,
      returnsAt,
    });
    if (status === 'ready') {
      if (slot === 'vehicle') readyVehicleId = itemId;
      else readyItemIds.push(itemId);
    }
  }

  return { readyItemIds, readyVehicleId, lines };
}
