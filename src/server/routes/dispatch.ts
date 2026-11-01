/**
 * Dispatch routes (Dispatch slice, migration 0032).
 *
 *   GET  /api/dispatch/me       — board + bay state (settles due first)
 *   POST /api/dispatch/preview  — price a contract from server records
 *   POST /api/dispatch/start    — commit a spare loadout / vehicle
 *   POST /api/dispatch/recall   — end a running contract, pro-rata
 *
 * Trust model (the #207 pattern): identity comes from the JWT only;
 * bodies carry intent — an offer id, item/vehicle ids, a nonce. All
 * terms (payouts, strength, fuel, wear, breakdown) are recomputed
 * HERE from the content owner (src/content/dispatch.ts) over the
 * store's server records; the SQL applier then re-validates every
 * state fact and locks the committed instances. A forged payout,
 * duration, or class in the body changes nothing: the body never
 * carries terms.
 *
 * Dispatch is parallel to the personal action slot — nothing here
 * reads or writes active_actions.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, DispatchCandidateItem, Json } from '../gameplay/store';
import {
  courierPayoutLines,
  courierProjection,
  dispatchOffersForDate,
  dispatchStrengthFactor,
  findDispatchOffer,
  footPayoutLines,
  resolveDispatchLevers,
  roamingAreaById,
  vehicleClassEligibleForTier,
  type DispatchLeverValues,
  type DispatchOffer,
} from '../../content/dispatch';
import { getVehicleClass, VEHICLE_CONDITION_MAX } from '../../lib/vehicles/vehicles';
import type { Vehicle } from '../../types/items';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type DispatchConfig = AuthConfig & {
  economyConfig?: EconomyConfig;
  /** Clock override (tests pin the offer board to a fixed date). */
  now?: () => Date;
};

async function dispatchLevers(config: DispatchConfig): Promise<DispatchLeverValues> {
  if (!config.economyConfig) return resolveDispatchLevers();
  const values = await config.economyConfig.snapshot();
  return resolveDispatchLevers(values);
}

function nowOf(config: DispatchConfig): Date {
  return config.now ? config.now() : new Date();
}

/** Dispatch applier error → HTTP status. */
function dispatchErrorStatus(message: string): number {
  if (message.includes('Profile not found')) return 404;
  if (
    message.includes('nonce is required') ||
    message.includes('Unknown dispatch') ||
    message.includes('Invalid dispatch') ||
    message.includes('Dispatch queue full') ||
    message.includes('Dispatch item') ||
    message.includes('Dispatch loadout') ||
    message.includes('Dispatch mission') ||
    message.includes('Dispatch payout') ||
    message.includes('Vehicles ride courier') ||
    message.includes('Courier vehicle') ||
    message.includes('Courier assignment') ||
    message.includes('Vehicle class cannot run') ||
    message.includes('Insufficient vehicle fuel') ||
    message.includes('Destination locked')
  ) {
    return 400;
  }
  return 500;
}

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = dispatchErrorStatus(message);
  if (status === 500) console.error(`[chef] ${fallback}:`, message);
  res.status(status).json({ error: fallback, detail: message });
}

interface PricedContract {
  offer: DispatchOffer;
  terms: Json;
  /** Player-facing projection (the prep screen's numbers). */
  view: Json;
  /** Refusal reasons (empty = eligible). Start refuses on any. */
  reasons: string[];
}

/**
 * Price one offer against the player's server records. Shared by
 * preview (reasons are data) and start (reasons refuse). The terms
 * built here are the departure snapshot the SQL applier stores.
 */
async function priceContract(
  store: ChefGameplayStore,
  config: DispatchConfig,
  playerId: string,
  offerId: string,
  itemIds: string[],
  vehicleItemId: string | null,
): Promise<PricedContract | { notFound: string }> {
  const offer = findDispatchOffer(nowOf(config), offerId);
  if (!offer) return { notFound: 'Unknown dispatch offer' };
  const area = roamingAreaById(offer.areaId);
  if (!area) return { notFound: 'Unknown dispatch offer' };
  const facts = await store.getDispatchFacts(playerId);
  if (!facts) return { notFound: 'Profile not found' };
  const levers = await dispatchLevers(config);
  const reasons: string[] = [];
  if (facts.profile.player_level < area.unlockLevel) {
    reasons.push(`Destination locked — requires hunter level ${area.unlockLevel}`);
  }
  const seed = `${playerId}:${offer.id}`;
  const byId = new Map(facts.items.map((i) => [i.id, i]));

  if (offer.family === 'foot') {
    const items: DispatchCandidateItem[] = [];
    const seen = new Set<string>();
    for (const id of itemIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const item = byId.get(id);
      if (!item) {
        reasons.push('Dispatch item not found');
        continue;
      }
      if (item.runtime_state !== 'available' || item.equipped_slot !== null) {
        reasons.push(`Item is not spare: ${itemName(item)}`);
      }
      if (item.kind === 'vehicle') {
        reasons.push('Vehicles ride courier contracts, not foot loadouts');
      }
      items.push(item);
    }
    if (items.length === 0 && reasons.length === 0) reasons.push('Pick at least one spare item for the loadout');
    if (items.length > 8) reasons.push('Dispatch loadout must carry 1 to 8 items');
    const strength = dispatchStrengthFactor(
      items.map((i) => ({ itemLevel: i.item_level, rarity: i.rarity })),
      area,
    );
    const lines = footPayoutLines(area, offer.durationHours, strength, levers, seed);
    return {
      offer,
      reasons,
      terms: {
        family: 'foot',
        offer_id: offer.id,
        seed,
        area_id: area.id,
        duration_hours: offer.durationHours,
        loadout_item_ids: items.map((i) => i.id),
        loadout_strength: strength,
        payout_credits: lines.credits,
        payout_scrap: lines.scrap,
        payout_material_id: lines.materialId,
        payout_material_units: lines.materialUnits,
      },
      view: {
        family: 'foot',
        areaId: area.id,
        areaName: area.name,
        dangerRating: area.dangerRating,
        durationHours: offer.durationHours,
        strengthFactor: strength,
        payout: lines,
      },
    };
  }

  // Courier: the vehicle does the work; the gate reads its class.
  const vehicle = vehicleItemId ? byId.get(vehicleItemId) ?? null : null;
  if (!vehicleItemId) reasons.push('Pick a spare vehicle for the contract');
  if (vehicleItemId && !vehicle) reasons.push('Courier vehicle not found');
  if (vehicle) {
    if (vehicle.kind !== 'vehicle') reasons.push('Courier assignment is not a vehicle');
    if (vehicle.runtime_state !== 'available' || vehicle.equipped_slot !== null) {
      reasons.push(
        vehicle.equipped_slot !== null
          ? 'That vehicle is equipped — your ride stays with you; couriers are for spare vehicles'
          : `Vehicle is ${vehicle.runtime_state} and cannot be assigned`,
      );
    }
    const classId = vehicleClassId(vehicle);
    if (!vehicleClassEligibleForTier(classId, offer.durationHours)) {
      const def = getVehicleClass(classId);
      reasons.push(
        `${def?.displayName ?? 'That vehicle'} cannot run this tier — its class band is below the gate`,
      );
    }
  }
  const vehicleInput = vehicle ? vehicleAsInput(vehicle) : { vehicleClassId: null, affixes: [] };
  const condition = vehicle ? vehicle.condition_current ?? VEHICLE_CONDITION_MAX : VEHICLE_CONDITION_MAX;
  const projection = courierProjection(vehicleInput, condition, area, offer.durationHours, levers);
  if (vehicle && facts.profile.vehicle_fuel < projection.fuelUnits) {
    const shortfallCells = Math.ceil((projection.fuelUnits - facts.profile.vehicle_fuel) / 100);
    reasons.push(`Insufficient vehicle fuel — needs ${shortfallCells} more Generic Fuel Cell${shortfallCells === 1 ? '' : 's'}`);
  }
  const lines = courierPayoutLines(area, offer.durationHours, vehicleInput, levers, seed);
  return {
    offer,
    reasons,
    terms: {
      family: 'courier',
      offer_id: offer.id,
      seed,
      area_id: area.id,
      duration_hours: offer.durationHours,
      loadout_item_ids: [],
      loadout_strength: 0,
      payout_credits: lines.credits,
      payout_scrap: lines.scrap,
      payout_material_id: lines.materialId,
      payout_material_units: lines.materialUnits,
      vehicle_item_id: vehicle?.id ?? null,
      vehicle_class_id: vehicle ? vehicleClassId(vehicle) : null,
      route_ticks: projection.routeTicks,
      fuel_charged_units: projection.fuelUnits,
      condition_at_departure: condition,
      wear_projected: projection.wearProjected,
      breakdown_fraction: projection.breakdownFraction,
      cargo_bonus_units: lines.cargoBonusUnits,
      premium_multiplier: levers.courierPremiumMultiplier,
    },
    view: {
      family: 'courier',
      areaId: area.id,
      areaName: area.name,
      dangerRating: area.dangerRating,
      durationHours: offer.durationHours,
      vehicleId: vehicle?.id ?? null,
      vehicleName: vehicle ? itemName(vehicle) : null,
      vehicleClassId: vehicle ? vehicleClassId(vehicle) : null,
      fuelUnits: projection.fuelUnits,
      fuelCells: projection.fuelCells,
      fuelAvailable: facts.profile.vehicle_fuel,
      wearProjected: projection.wearProjected,
      returnCondition: projection.returnCondition,
      breaksDown: projection.breaksDown,
      breakdownFraction: projection.breakdownFraction,
      payout: {
        credits: lines.credits,
        scrap: lines.scrap,
        materialId: lines.materialId,
        materialUnits: lines.materialUnits,
      },
      cargoBonusUnits: lines.cargoBonusUnits,
      premiumMultiplier: levers.courierPremiumMultiplier,
    },
  };
}

function vehicleClassId(item: DispatchCandidateItem): string | null {
  const payload = item.payload as Record<string, unknown>;
  return typeof payload.vehicleClassId === 'string' ? payload.vehicleClassId : null;
}

function vehicleAsInput(item: DispatchCandidateItem): Pick<Vehicle, 'vehicleClassId' | 'affixes'> {
  const payload = item.payload as Record<string, unknown>;
  return {
    vehicleClassId: vehicleClassId(item) as Vehicle['vehicleClassId'],
    affixes: (Array.isArray(payload.affixes) ? payload.affixes : []) as Vehicle['affixes'],
  };
}

function itemName(item: DispatchCandidateItem): string {
  const payload = item.payload as Record<string, unknown>;
  if (typeof payload.name === 'string' && payload.name) return payload.name;
  if (item.kind === 'vehicle') return getVehicleClass(vehicleClassId(item))?.displayName ?? 'Vehicle';
  return `${item.rarity ?? 'Common'} ${item.kind} (Lv ${item.item_level})`;
}

/** The full dispatch state view (board + bay + candidates). */
async function dispatchStateView(store: ChefGameplayStore, config: DispatchConfig, playerId: string): Promise<Json | null> {
  const facts = await store.getDispatchFacts(playerId);
  if (!facts) return null;
  const levers = await dispatchLevers(config);
  const missions = await store.listDispatchMissions(playerId, 20);
  const offers = dispatchOffersForDate(nowOf(config)).map((offer) => {
    const area = roamingAreaById(offer.areaId);
    return {
      ...offer,
      areaName: area?.name ?? offer.areaId,
      dangerRating: area?.dangerRating ?? 'Medium',
      areaUnlockLevel: area?.unlockLevel ?? 1,
      areaLocked: (area?.unlockLevel ?? 1) > facts.profile.player_level,
    };
  });
  const candidates = facts.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: itemName(item),
    itemLevel: item.item_level,
    rarity: item.rarity,
    runtimeState: item.runtime_state,
    equippedSlot: item.equipped_slot,
    isLocked: item.is_locked,
    vehicleClassId: item.kind === 'vehicle' ? vehicleClassId(item) : null,
    conditionCurrent: item.condition_current,
    conditionMax: item.condition_max,
  }));
  return {
    slots: levers.dispatchQueueSlots,
    slotsUsed: missions.filter((m) => m.status === 'active').length,
    playerLevel: facts.profile.player_level,
    vehicleFuel: facts.profile.vehicle_fuel,
    offers,
    missions,
    candidates,
  };
}

function bodyIds(body: Record<string, unknown>, key: string): string[] {
  const raw = body[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function bodyNonce(body: Record<string, unknown>, playerId: string, label: string): string {
  return typeof body.nonce === 'string' && body.nonce.trim().length >= 8
    ? body.nonce
    : `dispatch-${label}:${playerId}:${Date.now()}`;
}

export function createGetDispatchHandler(store: ChefGameplayStore, config: DispatchConfig) {
  return async function handleGetDispatch(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      try {
        await store.settleDispatchDue(playerId);
      } catch (err) {
        sendStoreError(res, 'Dispatch settlement failed', err);
        return;
      }
      const state = await dispatchStateView(store, config, playerId);
      if (!state) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, dispatch: state });
    } catch (err) {
      sendRouteError(res, 'Dispatch state failed', err);
    }
  };
}

export function createPreviewDispatchHandler(store: ChefGameplayStore, config: DispatchConfig) {
  return async function handlePreviewDispatch(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt as string | undefined, body.playerId as string | undefined);
      const offerId = typeof body.offerId === 'string' ? body.offerId : '';
      const priced = await priceContract(
        store, config, playerId, offerId,
        bodyIds(body, 'itemIds'),
        typeof body.vehicleItemId === 'string' ? body.vehicleItemId : null,
      );
      if ('notFound' in priced) {
        res.status(priced.notFound === 'Profile not found' ? 404 : 400).json({ error: priced.notFound });
        return;
      }
      res.json({
        verified: true,
        eligible: priced.reasons.length === 0,
        reasons: priced.reasons,
        preview: priced.view,
      });
    } catch (err) {
      sendRouteError(res, 'Dispatch preview failed', err);
    }
  };
}

export function createStartDispatchHandler(store: ChefGameplayStore, config: DispatchConfig) {
  return async function handleStartDispatch(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt as string | undefined, body.playerId as string | undefined);
      // Settle due first: a finished contract frees its slot.
      try {
        await store.settleDispatchDue(playerId);
      } catch (err) {
        sendStoreError(res, 'Dispatch settlement failed', err);
        return;
      }
      // Nonce replay short-circuit: a consumed start nonce returns
      // its stored departure BEFORE pricing — after departure the
      // committed instances are in_service, so re-pricing the same
      // request would refuse the very state the first call created.
      if (typeof body.nonce === 'string' && body.nonce.trim().length >= 8) {
        const prior = await store.getDispatchDeparture(playerId, body.nonce);
        if (prior) {
          const state = await dispatchStateView(store, config, playerId);
          res.json({ verified: true, departed: prior, dispatch: state, idempotentReplay: true });
          return;
        }
      }
      const offerId = typeof body.offerId === 'string' ? body.offerId : '';
      const priced = await priceContract(
        store, config, playerId, offerId,
        bodyIds(body, 'itemIds'),
        typeof body.vehicleItemId === 'string' ? body.vehicleItemId : null,
      );
      if ('notFound' in priced) {
        res.status(priced.notFound === 'Profile not found' ? 404 : 400).json({ error: priced.notFound });
        return;
      }
      if (priced.reasons.length > 0) {
        res.status(400).json({ error: 'Dispatch refused', detail: priced.reasons[0], reasons: priced.reasons });
        return;
      }
      let departed: Json;
      try {
        departed = await store.departDispatch(playerId, bodyNonce(body, playerId, 'start'), priced.terms);
      } catch (err) {
        sendStoreError(res, 'Dispatch departure failed', err);
        return;
      }
      const state = await dispatchStateView(store, config, playerId);
      res.json({ verified: true, departed, dispatch: state });
    } catch (err) {
      sendRouteError(res, 'Dispatch start failed', err);
    }
  };
}

export function createRecallDispatchHandler(store: ChefGameplayStore, config: DispatchConfig) {
  return async function handleRecallDispatch(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt as string | undefined, body.playerId as string | undefined);
      const missionId = typeof body.missionId === 'string' ? body.missionId : '';
      if (!missionId) {
        res.status(400).json({ error: 'Dispatch mission not found' });
        return;
      }
      let settlement: Json;
      try {
        settlement = await store.recallDispatch(playerId, bodyNonce(body, playerId, 'recall'), missionId);
      } catch (err) {
        sendStoreError(res, 'Dispatch recall failed', err);
        return;
      }
      const state = await dispatchStateView(store, config, playerId);
      res.json({ verified: true, settlement, dispatch: state });
    } catch (err) {
      sendRouteError(res, 'Dispatch recall failed', err);
    }
  };
}
