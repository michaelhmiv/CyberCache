/**
 * WardrobePanel (skins slice, 0053) — the Hunter tab's wardrobe,
 * presented as a FITTING CONSOLE (Instrument Panel register —
 * owner pick B for this page, 2026-11-05, ported from the
 * design/hunter-subpages-wardrobe-b prototype): the player's own
 * hunter seated in a scanlined measurement viewport, the ten
 * cosmetic mounts read as telemetry channels CH-01…CH-10, and
 * every fitting decision taken in a channel's service bay.
 *
 * Data and behavior are the shipped panel's, unchanged: the
 * selection record is the server's (equip / unequip / head-variant
 * go through the cosmetics store to the Chef; the panel never
 * decides ownership), the full craftable catalog is visible to
 * everyone (guest-visibility law), and wearing is a server op, so
 * guests get the sign-in line at the action instead of a hidden
 * panel. Preview is a LOCAL state only: the viewport re-resolves
 * the look through resolveOwnLook with the previewed part seated
 * in a copy of the selection — nothing is committed until WEAR IT
 * sends the real equip op. Skins are pure cosmetic, zero stats —
 * the console head carries that law next to a lit lamp, in full.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { useAuth } from '@/auth/AuthProvider';
import { useCosmeticsStore, useOwnLook } from '@/store/slices/cosmeticsSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { HUNTER_HEAD_VARIANTS, headVariantPreference } from '@/lib/pixel/headParts';
import { resolveOwnLook } from '@/lib/pixel/lookResolution';
import {
  COSMETIC_SLOTS,
  FINISH_LABELS,
  SKIN_PARTS,
  SKIN_SETS,
  finishTierForQuality,
  skinSetById,
  tintPaletteById,
  type CosmeticSlot,
} from '@/content/skins';

import { useWorkshopStore } from '@/store/slices/workshopSlice';
import { recipeCostLine } from '@/lib/workshop/recipeCosts';
import {
  BayButton,
  LcdWell,
  Led,
  LedMeter,
  Panel,
  PanelLabel,
  PushButton,
  Readout,
} from './wardrobeConsoleKit';
import {
  AMBER,
  FAINT,
  GOLD,
  GREEN,
  headStyle,
  INK,
  monoStyle,
  MUT,
  STEEL_DARK,
} from './wardrobeConsoleTokens';

const SLOT_LABELS: Record<CosmeticSlot, string> = {
  head: 'Head',
  torso: 'Torso',
  armUpperN: 'Arm (near)',
  armForeN: 'Forearm',
  armFar: 'Arm (far)',
  thighF: 'Thigh (front)',
  thighB: 'Thigh (back)',
  lowerLegF: 'Lower leg (front)',
  lowerLegB: 'Lower leg (back)',
  back: 'Back',
};

// The craftable rows' cost line (inputs · real craft duration)
// lives with the other recipe-cost display helpers in
// @/lib/workshop/recipeCosts (recipeCostLine).

export const WardrobePanel: React.FC = () => {
  const { account } = useAuth();
  const view = useCosmeticsStore((s) => s.view);
  const loadState = useCosmeticsStore((s) => s.loadState);
  const load = useCosmeticsStore((s) => s.load);
  const equip = useCosmeticsStore((s) => s.equip);
  const unequip = useCosmeticsStore((s) => s.unequip);
  const setHeadVariant = useCosmeticsStore((s) => s.setHeadVariant);
  const look = useOwnLook();
  const hunterName = usePlayerStore((s) => s.name);
  const hunterLevel = usePlayerStore((s) => s.level);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<CosmeticSlot>('head');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const primaryWeapon = useLoadoutStore((s) => s.getWeapon('primary'));
  const weaponInput = primaryWeapon ? pixelWeaponInputFromWeapon(primaryWeapon) : undefined;

  // Econ 7: the cost lines below quote Scrap at its resolved lever
  // value, which rides the Workshop snapshot — fetch it on mount so
  // the quote matches the charge even before the player's first
  // Workshop visit this session.
  const recipeScrapCosts = useWorkshopStore((s) => s.server?.recipeScrapCosts);
  const refreshWorkshop = useWorkshopStore((s) => s.refresh);
  useEffect(() => {
    void load();
    void refreshWorkshop();
  }, [load, refreshWorkshop]);

  const isGuest = !account || account.isAnonymous;
  const equipped = view?.selection.equipped ?? {};
  const headPartEquipped = !!equipped.head;
  const ownedBySlot = useMemo(() => {
    const map = new Map<CosmeticSlot, NonNullable<typeof view>['parts']>();
    for (const p of view?.parts ?? []) {
      const list = map.get(p.slot) ?? [];
      list.push(p);
      map.set(p.slot, list);
    }
    return map;
  }, [view]);
  const ownedPartIds = useMemo(
    () => new Set((view?.parts ?? []).map((p) => p.partId)),
    [view],
  );

  /* Preview — a local fitting state. The viewport resolves the
   * look with the previewed part seated in a COPY of the server
   * selection; the store (and the server record) never sees it.
   * WEAR IT runs the real equip op; Cancel just drops the copy. */
  const partsById = useMemo(
    () => new Map((view?.parts ?? []).map((p) => [p.id, p])),
    [view],
  );
  const previewPart = previewId ? partsById.get(previewId) : undefined;
  const effectiveSelection = useMemo(() => {
    if (!previewPart || !view) return view?.selection ?? null;
    return {
      ...view.selection,
      equipped: { ...view.selection.equipped, [previewPart.slot]: previewPart.id },
    };
  }, [view, previewPart]);
  const previewLook = useMemo(() => {
    if (!previewPart) return null;
    return resolveOwnLook({
      selection: effectiveSelection,
      partsById,
      fallbackHeadVariant: headVariantPreference(),
    });
  }, [previewPart, effectiveSelection, partsById]);
  const displayLook = previewLook ?? look;

  const wornCount = Object.values(equipped).filter(Boolean).length;
  const setsOwned = useMemo(
    () => new Set((view?.parts ?? []).map((p) => p.setId)).size,
    [view],
  );
  const wornSetLine =
    [...new Set(
      Object.values(effectiveSelection?.equipped ?? {})
        .filter(Boolean)
        .map((id) => skinSetById(partsById.get(id as string)?.setId ?? '')?.name ?? ''),
    )]
      .filter(Boolean)
      .join(' · ') || 'Standard Issue';
  const previewChannel = previewPart ? COSMETIC_SLOTS.indexOf(previewPart.slot) + 1 : 0;

  const run = async (key: string, op: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  const pickSlot = (slot: CosmeticSlot) => {
    setSelectedSlot(slot);
    setPreviewId(null);
  };

  return (
    <div className="space-y-3" data-testid="wardrobe-console">
      {/* ── CONSOLE HEAD ─────────────────────────────────────────── */}
      <Panel testId="wardrobe-console-head">
        <PanelLabel label="Fitting console" right="SYS NOMINAL" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[26px] uppercase leading-none" style={{ ...headStyle, color: INK }}>
            Wardrobe
          </h2>
          <span className="flex items-center gap-2">
            <Led lit color={GREEN} />
            <span className="text-[11px] font-black uppercase" style={{ ...monoStyle, color: GREEN, letterSpacing: '0.1em' }}>
              Cosmetic only
            </span>
          </span>
        </div>
        <div className="mt-2 text-[12px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
          Unit {hunterName} · LV {hunterLevel} · Rig under measurement
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <LcdWell value={String(wornCount)} label="Worn" valueSize={20} />
          <LcdWell value={String(view?.parts.length ?? 0)} label="Owned" valueSize={20} />
          <LcdWell value={String(COSMETIC_SLOTS.length)} label="Mounts" valueSize={20} />
          <LcdWell value={String(setsOwned)} label="Sets" valueSize={20} />
        </div>
        <div className="mt-3 text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
          Pure cosmetic — zero stats. No mechanics path reads this rig.
        </div>
        {isGuest && (
          <div
            className="mt-2 flex items-center gap-2 text-[11px] font-black uppercase"
            style={{ ...monoStyle, color: AMBER }}
            data-testid="wardrobe-guest-note"
          >
            <PxIcon name="lock" size={13} />
            Sign in to craft and wear parts — browsing is free.
          </div>
        )}
        {!isGuest && loadState === 'error' && (
          <div className="mt-2 text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT }}>
            Wardrobe unreachable right now — your saved look still applies.
          </div>
        )}
      </Panel>

      {error && (
        <div className="border border-red/50 bg-red/10 px-2 py-1 text-[11px] font-bold text-text-primary" role="alert">
          {error}
        </div>
      )}

      {/* ── RIG READOUT — the measured figure ────────────────────── */}
      <Panel testId="wardrobe-rig">
        <PanelLabel
          label="Rig — live render"
          right={previewPart ? 'PREVIEW' : 'NOMINAL'}
          rightColor={previewPart ? AMBER : FAINT}
        />
        <div
          className="relative overflow-hidden"
          style={{
            border: `1px solid ${STEEL_DARK}`,
            background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
            boxShadow: 'inset 0 2px 9px rgba(0,0,0,0.9)',
          }}
          data-testid="wardrobe-showcase"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(245,239,230,0.03) 0px, rgba(245,239,230,0.03) 1px, transparent 1px, transparent 3px)',
            }}
          />
          {/* Measurement ticks seated on the viewport's top edge. */}
          <div aria-hidden="true" className="absolute inset-x-3 top-0 z-10 flex justify-between">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} style={{ width: 1, height: i % 5 === 0 ? 9 : 5, backgroundColor: 'rgba(201,187,166,0.4)' }} />
            ))}
          </div>
          {/* The portrait box is widened and shifted left inside the
              viewport so the measured composition — figure plus the
              weapon's full barrel — fits the glass. */}
          <div style={{ width: 'calc(100% + 48px)', marginLeft: -48 }}>
            <HunterPortrait
              look={displayLook}
              weaponInput={weaponInput}
              className="h-[264px]"
              testId="wardrobe-showcase-portrait"
            />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Readout label="Worn set" value={wornSetLine} />
          <Readout label="Mounts filled" value={`${wornCount} / ${COSMETIC_SLOTS.length}`} />
          {previewPart ? (
            <Readout
              label={`Preview CH-${String(previewChannel).padStart(2, '0')}`}
              value={previewPart.name}
              valueColor={AMBER}
            />
          ) : (
            <Readout label="Preview" value="None seated" valueColor={FAINT} />
          )}
        </div>
        <div className="mt-2.5">
          <LedMeter filled={wornCount} total={COSMETIC_SLOTS.length} color={MUT} height={10} />
        </div>
      </Panel>

      {/* ── MOUNT CHANNELS ───────────────────────────────────────── */}
      <Panel testId="wardrobe-channels">
        <PanelLabel label="Mount channels" right="Tap a channel to open its bay" />
        <div data-testid="wardrobe-owned">
          {COSMETIC_SLOTS.map((slot, idx) => {
            const ch = `CH-${String(idx + 1).padStart(2, '0')}`;
            const wornId = equipped[slot];
            const worn = wornId ? partsById.get(wornId) : undefined;
            const owned = ownedBySlot.get(slot) ?? [];
            const open = selectedSlot === slot;
            const previewingHere = previewPart?.slot === slot;
            const status = previewingHere
              ? 'Preview'
              : worn
                ? 'Worn'
                : owned.length > 0
                  ? `${owned.length} owned`
                  : 'Empty';
            const statusColor = previewingHere ? AMBER : worn ? INK : FAINT;
            return (
              <div key={slot} style={idx > 0 ? { borderTop: '1px solid rgba(58,52,43,0.55)' } : undefined}>
                <button
                  type="button"
                  onClick={() => pickSlot(slot)}
                  className="flex min-h-[44px] w-full items-center gap-2.5 py-1 text-left"
                  data-testid={`channel-${slot}`}
                  aria-expanded={open}
                >
                  <Led lit={previewingHere || !!worn} color={previewingHere ? AMBER : MUT} />
                  <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
                    {ch}
                  </span>
                  <span className="text-[14px] uppercase" style={{ ...headStyle, color: open ? INK : MUT }}>
                    {SLOT_LABELS[slot]}
                  </span>
                  <span
                    className="ml-auto text-[11px] font-black uppercase"
                    style={{ ...monoStyle, color: statusColor, letterSpacing: '0.1em' }}
                  >
                    {status}
                  </span>
                </button>
                <div className="flex items-center gap-2.5 pb-2 pl-[52px] pr-1">
                  <span className="min-w-0 flex-1 text-[11px] font-bold uppercase leading-snug" style={{ ...monoStyle, color: FAINT }}>
                    {worn
                      ? `${worn.name} · ${FINISH_LABELS[finishTierForQuality(worn.quality)]} · Q${worn.quality}${
                          worn.tintPaletteId ? ` · ${tintPaletteById(worn.tintPaletteId)?.name ?? ''} tint` : ''
                        }`
                      : owned.length > 0
                        ? `Standard Issue fitted · ${owned.length} on file`
                        : 'Standard Issue fitted · no part on file'}
                  </span>
                  {worn && (
                    <span className="w-[86px] shrink-0">
                      <LedMeter filled={Math.round(worn.quality / 10)} total={10} color={GOLD} height={7} />
                    </span>
                  )}
                </div>

                {/* ── FITTING BAY — the open channel's service panel ── */}
                {open && (
                  <div className="pb-3 pl-[52px] pr-1" data-testid={`bay-${slot}`}>
                    {slot === 'head' && (
                      <div className="mb-2.5">
                        <div className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT, letterSpacing: '0.1em' }}>
                          Base head — read when no helm is seated
                          {headPartEquipped && <span style={{ color: AMBER }}> · helm worn — pick overridden</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="wardrobe-head-variants">
                          {HUNTER_HEAD_VARIANTS.filter((v) => (view?.wearableVariantIds ?? ['visor', 'optic', 'hood', 'fin']).includes(v.id)).map((v) => {
                            const active = !headPartEquipped && view?.selection.headVariant === v.id;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                disabled={isGuest || busy !== null}
                                onClick={() => void run(`variant:${v.id}`, () => setHeadVariant(v.id))}
                                className="flex min-h-[44px] items-center gap-2 px-3 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
                                style={{
                                  border: `2px solid ${active ? INK : STEEL_DARK}`,
                                  backgroundColor: active ? 'rgba(245,239,230,0.08)' : 'rgba(6,5,4,0.6)',
                                  color: active ? INK : MUT,
                                }}
                                data-testid={`wardrobe-variant-${v.id}`}
                              >
                                <Led lit={active} color={INK} size={7} />
                                {v.label}
                                {v.standingManufacturer ? ' · Standing' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {owned.length === 0 ? (
                      <div className="text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
                        No part on file for this mount. Craft parts in the Workshop — Parts lane — and they read here.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {owned.map((p) => {
                          const isWorn = wornId === p.id;
                          const isPreviewing = previewId === p.id;
                          const locked = p.runtimeState === 'locked';
                          const finish = FINISH_LABELS[finishTierForQuality(p.quality)];
                          const tint = tintPaletteById(p.tintPaletteId);
                          return (
                            <div
                              key={p.id}
                              className="px-2.5 py-2"
                              style={{
                                border: `1px solid ${isPreviewing ? AMBER : 'rgba(58,52,43,0.8)'}`,
                                backgroundColor: 'rgba(6,5,4,0.55)',
                              }}
                              data-testid={`wardrobe-part-${p.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] uppercase leading-snug" style={{ ...headStyle, color: INK }}>
                                    {p.name}
                                  </div>
                                  <div className="text-[11px] font-bold uppercase leading-snug" style={{ ...monoStyle, color: FAINT }}>
                                    {skinSetById(p.setId)?.name ?? p.setId} · {finish} · {`Q${p.quality}`}
                                    {tint ? ` · ${tint.name} tint` : ''}
                                    {locked ? ' · Locked' : ''}
                                  </div>
                                </div>
                                {isWorn ? (
                                  <BayButton
                                    disabled={isGuest || busy !== null}
                                    onClick={() => void run(`part:${p.id}`, () => unequip(slot))}
                                    testId={`remove-${p.id}`}
                                  >
                                    {busy === `part:${p.id}` ? '…' : 'Remove'}
                                  </BayButton>
                                ) : locked ? null : isPreviewing ? null : (
                                  <BayButton
                                    disabled={isGuest || busy !== null}
                                    onClick={() => setPreviewId(p.id)}
                                    testId={`preview-${p.id}`}
                                  >
                                    Preview
                                  </BayButton>
                                )}
                              </div>
                              {locked && (
                                <div className="mt-1.5 text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT }}>
                                  Locked — listed on the market. Delist it to fit it here.
                                </div>
                              )}
                              {isPreviewing && (
                                <div className="mt-2 space-y-1.5">
                                  <PushButton
                                    armed
                                    disabled={isGuest || busy !== null}
                                    onClick={() =>
                                      void run(`part:${p.id}`, async () => {
                                        await equip(p.id);
                                        setPreviewId(null);
                                      })
                                    }
                                    testId={`wear-${p.id}`}
                                  >
                                    {busy === `part:${p.id}` ? 'Fitting…' : 'Wear it'}
                                  </PushButton>
                                  <PushButton armed={false} onClick={() => setPreviewId(null)}>
                                    Cancel preview
                                  </PushButton>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ── CRAFT QUEUE — the unowned catalog as a readout list ──── */}
      <Panel testId="wardrobe-craft-queue">
        <PanelLabel label="Craft queue — unowned" right="Workshop · Parts lane" />
        <div data-testid="wardrobe-catalog">
          {SKIN_SETS.map((set) => {
            // Delisted parts (Hero Pass H1) leave the craft queue:
            // they can't be crafted anymore. Owned copies still
            // show in the bays above — grandfathering is absolute.
            const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !p.delisted && !ownedPartIds.has(p.id));
            if (rows.length === 0) return null;
            return (
              <div key={set.id} className="mb-3 last:mb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] uppercase" style={{ ...headStyle, color: MUT }}>
                    {set.name}
                  </span>
                  <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT }}>
                    {rows.length} to craft
                  </span>
                </div>
                <div className="mt-1">
                  {rows.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-baseline justify-between gap-3 py-1"
                      style={i > 0 ? { borderTop: '1px solid rgba(58,52,43,0.4)' } : undefined}
                    >
                      <span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug" style={{ color: MUT }}>
                        {p.name}
                        <span style={{ ...monoStyle, color: FAINT }}> · {SLOT_LABELS[p.slot]}</span>
                      </span>
                      {/* Real cost lines run long (three inputs +
                          duration): the readout wraps inside its
                          own column — data wraps, never truncates,
                          and never paints over the part name. */}
                      <span className="max-w-[58%] text-right text-[11px] leading-snug" style={{ ...monoStyle, color: FAINT }}>
                        {recipeCostLine(p.recipeId, recipeScrapCosts)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {SKIN_PARTS.filter((p) => !p.delisted).every((p) => ownedPartIds.has(p.id)) && (
            <div className="text-[11px]" style={{ ...monoStyle, color: FAINT }}>Full catalog owned. Flex responsibly.</div>
          )}
        </div>
        <div className="mt-2 text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
          Crafted with Scrap in the Workshop. Parts trade on the player market once unequipped. All mounts open — no gates.
        </div>
      </Panel>
    </div>
  );
};
