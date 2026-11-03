/**
 * TintPanel (skins slice, 0053) — the Workshop's tinting lane.
 * Pick an owned skin part, pick a palette, queue the tint job:
 * a timed craft job (flat Scrap + the palette's Chromaweave,
 * escrowed server-side) that rewrites the part's tint when it
 * completes. Starter palettes (Arctic, Void) cost no Chromaweave —
 * a new player personalizes on day one. The panel sends intent
 * only; prices and gates are the server's.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MobileCard } from '@/components/layout/MobileCard';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { usePlayerStore, useWorkshopStore } from '@/store';
import { TINT_PALETTES } from '@/content/skins';
import { TINT_RECIPE } from '@/content/crafting';
import { humanizeWorkshopError } from '@/lib/workshop/errors';

/** The tint craft's flat Scrap escrow (the recipe's own input). */
const TINT_FLAT_SCRAP = TINT_RECIPE.inputs['Scrap'] ?? 25;

export const TintPanel: React.FC = () => {
  const view = useCosmeticsStore((s) => s.view);
  const load = useCosmeticsStore((s) => s.load);
  const materials = usePlayerStore((s) => s.materials);
  const scrap = usePlayerStore((s) => s.scrap);
  const refreshWorkshop = useWorkshopStore((s) => s.refresh);
  const [partId, setPartId] = useState<string>('');
  const [paletteId, setPaletteId] = useState<string>(TINT_PALETTES[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const parts = useMemo(
    () => (view?.parts ?? []).filter((p) => p.runtimeState === 'available' || p.runtimeState === 'locked'),
    [view],
  );
  const palette = TINT_PALETTES.find((p) => p.id === paletteId) ?? TINT_PALETTES[0];
  const chromaweaveHave = materials['Chromaweave'] ?? 0;
  const canAfford = palette ? scrap >= TINT_FLAT_SCRAP && chromaweaveHave >= palette.chromaweave : false;
  const selected = parts.find((p) => p.id === partId) ?? parts[0];
  const alreadyTinted = selected && palette ? selected.tintPaletteId === palette.id : false;
  const canQueue = !!selected && !!palette && canAfford && !alreadyTinted && !busy;

  const queue = async () => {
    if (!selected || !palette) return;
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.enqueueTintJob(selected.id, palette.id);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 900);
      void refreshWorkshop();
    } catch (err) {
      setError(humanizeWorkshopError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileCard className="space-y-2" rarityColor="#FF9DF5">
      <div className="flex items-center gap-2" data-testid="tint-panel">
        <PxIcon name="swirl" size={17} className="text-pink-300" />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Tinting</div>
        <div className="ml-auto text-[11px] text-text-muted">
          {TINT_FLAT_SCRAP} Scrap + Chromaweave · 5 min
        </div>
      </div>
      {parts.length === 0 ? (
        <div className="text-[11px] text-text-muted">
          No skin parts yet — craft one in the Skin Parts lane and it can be tinted here.
          Your Chromaweave: {chromaweaveHave} (refine Myco-Steel Fiber + Void Essence).
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            Part
            <select
              value={selected?.id ?? ''}
              onChange={(e) => setPartId(e.target.value)}
              className="min-w-0 flex-1 border border-border bg-surface px-1.5 py-1 text-[11px] font-bold text-text-primary"
              data-testid="tint-part-select"
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {`(${p.quality}% quality)`}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1 overflow-x-auto pb-1" data-testid="tint-palettes">
            {TINT_PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPaletteId(p.id)}
                className={`shrink-0 border-2 px-2 py-1 text-[11px] font-bold ${
                  palette?.id === p.id
                    ? 'border-amber bg-amber/15 text-text-primary'
                    : 'border-border bg-panel text-text-secondary'
                }`}
                data-testid={`tint-palette-${p.id}`}
              >
                {p.name}
                <span className="text-text-muted"> · {p.chromaweave === 0 ? 'free' : `${p.chromaweave} Chromaweave`}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-text-muted">
            You hold {chromaweaveHave} Chromaweave · {scrap.toLocaleString('en-US')} Scrap.
            {alreadyTinted ? ' This part already wears that tint.' : ''}
            {!canAfford && !alreadyTinted ? ' Not enough for this palette yet.' : ''}
          </div>
          {error && (
            <div className="border border-red/50 bg-red/10 px-2 py-1 text-[11px] font-bold text-text-primary" role="alert">
              {error}
            </div>
          )}
          <button
            type="button"
            disabled={!canQueue}
            onClick={() => void queue()}
            className={`w-full py-1.5 text-[11px] font-bold ${
              canQueue
                ? 'bg-amber text-bg active:bg-amber/80'
                : 'cursor-not-allowed border border-border bg-surface-raised text-text-muted'
            }`}
            data-testid="tint-queue-button"
          >
            {flash ? 'Queued!' : busy ? 'Queueing…' : 'QUEUE TINT JOB'}
          </button>
        </>
      )}
    </MobileCard>
  );
};
