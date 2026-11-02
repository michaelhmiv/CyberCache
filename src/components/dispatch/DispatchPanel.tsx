import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  getDispatchState,
  newDispatchNonce,
  previewDispatch,
  recallDispatch,
  startDispatch,
  type ChefDispatchCandidate,
  type ChefDispatchMission,
  type ChefDispatchOffer,
  type ChefDispatchState,
} from '@/lib/chef/chefClient';

/**
 * Dispatch panel (0032) — the contract board + bay.
 *
 * Foot contracts commit a SPARE loadout; courier contracts commit a
 * SPARE vehicle (never the equipped ride). Everything priced here —
 * payouts, fuel, projected wear, the breakdown point — comes from
 * the Chef's preview over server records; this panel sends intent
 * only (offer id + item/vehicle ids + nonce) and renders server
 * state. Missions run parallel to the personal action slot: nothing
 * here touches roaming/crafting/boss state. Renders nothing until
 * the Chef answers, so an unreachable Chef omits the surface.
 */

function remainingLabel(endsAt: string, nowMs: number): string {
  const ms = Date.parse(endsAt) - nowMs;
  if (ms <= 0) return 'due — refresh to settle';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

function missionLine(m: ChefDispatchMission): string {
  const paid = m.payout_fraction !== null && m.payout_fraction !== undefined
    ? `paid ×${Math.round(m.payout_fraction * 100)}%`
    : '';
  const broke = m.breakdown_fraction !== null && m.breakdown_fraction < 1
    && m.payout_fraction !== null && m.payout_fraction >= m.breakdown_fraction - 1e-9;
  return `${m.contract_family === 'courier' ? 'Courier' : 'Foot'} · ${m.duration_hours}h · ${m.payout_credits} cr · ${m.payout_scrap} scrap${m.payout_material_id ? ` · ${m.payout_material_units} ${m.payout_material_id}` : ''}${paid ? ` · ${paid}` : ''}${broke ? ' · BROKE DOWN' : ''}`;
}

export const DispatchPanel: React.FC = () => {
  const [state, setState] = useState<ChefDispatchState | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [pickedItems, setPickedItems] = useState<string[]>([]);
  const [pickedVehicle, setPickedVehicle] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Countdown clock: sampled on mount and on every interaction
  // (refresh / depart / recall) — no timers in components per the
  // architecture guard, no impure calls during render.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const result = await getDispatchState();
    setState(result.dispatch);
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDispatchState()
      .then((result) => {
        if (!cancelled) {
          setState(result.dispatch);
          setNowMs(Date.now());
        }
      })
      .catch(() => { /* Chef unreachable: panel stays hidden. */ });
    return () => { cancelled = true; };
  }, []);

  const offer: ChefDispatchOffer | null = useMemo(
    () => state?.offers.find((o) => o.id === offerId) ?? null,
    [state, offerId],
  );

  // Re-price whenever the prep selection changes. (Clearing the old
  // preview happens in the offer-select handler, not here — no
  // synchronous setState in effects.)
  useEffect(() => {
    if (!offer) return;
    let cancelled = false;
    previewDispatch({
      offerId: offer.id,
      itemIds: offer.family === 'foot' ? pickedItems : [],
      vehicleItemId: offer.family === 'courier' ? pickedVehicle : null,
    })
      .then((result) => {
        if (cancelled) return;
        setPreview(result.preview);
        setReasons(result.reasons);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed');
      });
    return () => { cancelled = true; };
  }, [offer, pickedItems, pickedVehicle]);

  const depart = useCallback(async () => {
    if (!offer || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startDispatch({
        nonce: newDispatchNonce('start'),
        offerId: offer.id,
        itemIds: offer.family === 'foot' ? pickedItems : [],
        vehicleItemId: offer.family === 'courier' ? pickedVehicle : null,
      });
      if (result.dispatch) setState(result.dispatch);
      else await refresh();
      setPickedItems([]);
      setPickedVehicle(null);
      setOfferId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Departure failed');
    } finally {
      setBusy(false);
    }
  }, [offer, busy, pickedItems, pickedVehicle, refresh]);

  const recall = useCallback(async (missionId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recallDispatch({ nonce: newDispatchNonce('recall'), missionId });
      if (result.dispatch) setState(result.dispatch);
      else await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recall failed');
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  if (!state) return null;

  const active = state.missions.filter((m) => m.status === 'active');
  const history = state.missions.filter((m) => m.status !== 'active');
  const spareGear = state.candidates.filter((c) => c.kind !== 'vehicle');
  const vehicles = state.candidates.filter((c) => c.kind === 'vehicle');
  const slotsFull = state.slotsUsed >= state.slots;

  const toggleItem = (c: ChefDispatchCandidate) => {
    setPickedItems((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id].slice(0, 8)));
  };

  const payout = (preview?.payout ?? null) as { credits?: number; scrap?: number; materialId?: string | null; materialUnits?: number } | null;

  return (
    <div className="space-y-3">
      <MobileCard className="space-y-2" rarityColor="#7FD4FF">
        <div className="flex items-center justify-between">
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Dispatch Bay</div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-bold text-text-muted">
              Slots {state.slotsUsed}/{state.slots} · Fuel {Math.floor(state.vehicleFuel)} units
            </div>
            <button
              onClick={() => { refresh().catch(() => { /* stale state stays */ }); }}
              className="bl-secondary px-2 py-0.5 text-[10px] font-black"
            >
              <span className="inline-flex items-center gap-1"><PxIcon name="recycle" size={13} /> Settle</span>
            </button>
          </div>
        </div>
        {active.length === 0 && <div className="text-xs text-text-muted">No contracts out. Pick one from the board below.</div>}
        {active.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
            <div className="text-xs text-text-primary">{missionLine(m)}<div className="text-[10px] text-text-muted">{remainingLabel(m.ends_at, nowMs)}</div></div>
            <button
              onClick={() => recall(m.id)}
              disabled={busy}
              className="bl-secondary shrink-0 px-2 py-1 text-[10px] font-black disabled:opacity-50"
            >
              Recall
            </button>
          </div>
        ))}
        {history.length > 0 && (
          <div className="border-t border-border/60 pt-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Returned</div>
            {history.slice(0, 5).map((m) => (
              <div key={m.id} className="text-[11px] text-text-muted">{missionLine(m)} · {m.status}</div>
            ))}
          </div>
        )}
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#F2C063">
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Contract Board — today</div>
        {state.offers.map((o) => (
          <button
            key={o.id}
            onClick={() => { setOfferId(offerId === o.id ? null : o.id); setPickedItems([]); setPickedVehicle(null); setPreview(null); setReasons([]); }}
            disabled={o.areaLocked}
            className={`flex w-full items-center justify-between gap-2 border px-2 py-2 text-left ${offerId === o.id ? 'border-amber bg-amber/10' : 'border-border/60'} disabled:opacity-50`}
          >
            <span className="text-xs font-bold text-text-primary">
              {o.family === 'courier' ? <span className="inline-flex items-center gap-1"><PxIcon name="truck" size={13} /> Courier</span> : <span className="inline-flex items-center gap-1"><PxIcon name="boot" size={13} /> Foot</span>} — {o.areaName} · {o.durationHours}h
            </span>
            <span className="text-[10px] font-bold text-text-muted">
              {o.areaLocked ? `Locked · Lv ${o.areaUnlockLevel}` : `${o.dangerRating} danger`}
            </span>
          </button>
        ))}
        {slotsFull && <div className="text-[11px] font-bold text-amber">Bay is full — a contract must return (or be recalled) before another departs.</div>}

        {offer && (
          <div className="space-y-2 border-t border-border/60 pt-2">
            {offer.family === 'foot' ? (
              <>
                <div className="text-[11px] font-bold text-text-muted">Assign a spare loadout (gear stays locked away until return):</div>
                {spareGear.length === 0 && <div className="text-xs text-text-muted">No spare gear in inventory.</div>}
                {spareGear.map((c) => {
                  const spare = c.runtimeState === 'available' && !c.equippedSlot;
                  const picked = pickedItems.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => spare && toggleItem(c)}
                      disabled={!spare}
                      className={`flex w-full items-center justify-between px-2 py-1 text-left text-xs ${picked ? 'bg-amber/15 font-black text-text-primary' : 'text-text-primary'} disabled:opacity-40`}
                    >
                      <span className="inline-flex items-center gap-1">{picked ? <PxIcon name="check" size={13} /> : null}{c.name}</span>
                      <span className="text-[10px] text-text-muted">{spare ? `Lv ${c.itemLevel}` : c.equippedSlot ? 'equipped' : c.runtimeState}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <div className="text-[11px] font-bold text-text-muted">Assign a spare vehicle (the equipped ride stays with you):</div>
                {vehicles.length === 0 && <div className="text-xs text-text-muted">No vehicles owned.</div>}
                {vehicles.map((c) => {
                  const spare = c.runtimeState === 'available' && !c.equippedSlot;
                  const picked = pickedVehicle === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => spare && setPickedVehicle(picked ? null : c.id)}
                      disabled={!spare}
                      className={`flex w-full items-center justify-between px-2 py-1 text-left text-xs ${picked ? 'bg-amber/15 font-black text-text-primary' : 'text-text-primary'} disabled:opacity-40`}
                    >
                      <span className="inline-flex items-center gap-1">{picked ? <PxIcon name="check" size={13} /> : null}{c.name}</span>
                      <span className="text-[10px] text-text-muted">
                        {spare ? `condition ${Math.round(c.conditionCurrent ?? 100)}` : c.equippedSlot ? 'equipped' : c.runtimeState}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {preview && (
              <div className="space-y-1 border-t border-border/60 pt-2 text-xs text-text-primary">
                {offer.family === 'foot' && (
                  <div>Loadout strength ×{Number(preview.strengthFactor ?? 0).toFixed(2)}</div>
                )}
                {offer.family === 'courier' && (
                  <>
                    <div>Fuel cost: {Math.ceil(Number(preview.fuelUnits ?? 0))} units ({String(preview.fuelCells ?? 0)} cells)</div>
                    <div>Projected wear: {Number(preview.wearProjected ?? 0).toFixed(1)} condition</div>
                    {preview.breaksDown ? (
                      <div className="font-black text-red-400">
                        <span className="inline-flex items-center gap-1"><PxIcon name="warn" size={13} /> BREAKDOWN</span> at {Math.round(Number(preview.breakdownFraction ?? 0) * 100)}% of the route — returns at 0 condition, payout pro-rata, unflown fuel refunded.
                      </div>
                    ) : (
                      <div>Projected return condition: {Number(preview.returnCondition ?? 0).toFixed(0)}</div>
                    )}
                    <div>Cargo bonus: +{String(preview.cargoBonusUnits ?? 0)} materials (premium ×{String(preview.premiumMultiplier ?? '')})</div>
                  </>
                )}
                {payout && (
                  <div className="font-bold">
                    Pays: {payout.credits ?? 0} cr · {payout.scrap ?? 0} scrap{payout.materialId ? ` · ${payout.materialUnits ?? 0} ${payout.materialId}` : ''}
                  </div>
                )}
              </div>
            )}
            {reasons.map((r) => (
              <div key={r} className="text-[11px] font-bold text-red-400">{r}</div>
            ))}
            <button
              onClick={depart}
              disabled={busy || reasons.length > 0 || slotsFull}
              className="bl-primary w-full px-3 py-2 text-xs font-black disabled:opacity-50"
            >
              {busy ? 'Departing…' : 'Depart'}
            </button>
          </div>
        )}
        {error && <div className="text-[11px] font-bold text-red-400">{error}</div>}
      </MobileCard>
    </div>
  );
};
