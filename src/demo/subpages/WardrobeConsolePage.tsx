/**
 * WardrobeConsolePage — PROTOTYPE (design/hunter-subpages-wardrobe-b,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Wardrobe reimagined as a FITTING CONSOLE in the "Instrument
 * panel" register — variant B against variant A's fitting stand.
 * Where A stands the hunter on a plinth inside a machined plate,
 * B seats the same rig in a measurement viewport and reads the
 * wardrobe as telemetry: ten mount CHANNELS in anatomical order,
 * each with a status LED, the fitted part as a mono readout, its
 * craft quality as a ten-segment gauge, and a fitting BAY that
 * opens under the channel. Preview is a real state — the viewport
 * re-renders the resolved look with the previewed part seated,
 * the rig panel's state lamp flips to amber PREVIEW, and the bay
 * arms the amber WEAR IT push-button.
 *
 * Function coverage vs the shipped WardrobePanel: showcase render
 * with the equipped weapon, head-variant pick (+ the worn-helm
 * override note and disabled state), owned parts by slot with
 * Wear/Remove, locked-part state, the full craftable catalog with
 * real recipe cost lines, and the guest lock presented at the
 * action. The fixture is shaped exactly like the Chef's
 * CosmeticsStateView payload and is IDENTICAL to variant A's
 * (same parts, qualities, tints, selection) so the two options
 * compare on the same facts; wear / remove / variant ops mutate
 * the local selection exactly as the server record would be
 * re-read. Skins are pure cosmetic — the console prints that law
 * on its head panel and no readout anywhere implies a stat.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveOwnLook } from '@/lib/pixel/lookResolution';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { HUNTER_HEAD_VARIANTS } from '@/lib/pixel/headParts';
import {
  COSMETIC_SLOTS,
  FINISH_LABELS,
  SKIN_PARTS,
  SKIN_SETS,
  finishTierForQuality,
  skinPartCatalog,
  skinSetById,
  tintPaletteById,
  type CosmeticPartItemView,
  type CosmeticSelection,
  type CosmeticSlot,
} from '@/content/skins';
import { recipeCostLine } from '@/lib/workshop/recipeCosts';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';
import { DropSource, Rarity } from '@/types/game';
import { LcdWell, Led, LedMeter, Panel, PanelLabel, PushButton } from './instrumentKit';
import { AMBER, FAINT, GOLD, GREEN, headStyle, INK, monoStyle, MUT, STEEL_DARK } from './instrumentTokens';

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

/* ── Fixture — identical to variant A's WardrobeStand fixture ── */
function fixturePart(partId: string, id: string, quality: number, tintPaletteId: string | null, runtimeState = 'owned'): CosmeticPartItemView {
  const def = skinPartCatalog(partId)!;
  return { id, partId, slot: def.slot, setId: def.setId, tier: def.tier, name: def.name, quality, tintPaletteId, runtimeState };
}

const FIXTURE_PARTS: CosmeticPartItemView[] = [
  fixturePart('bulwark-head', 'fx-part-1', 82, null),
  fixturePart('dread-head', 'fx-part-2', 64, 'crimson'),
  fixturePart('mfr-head-redline', 'fx-part-3', 71, null),
  fixturePart('bulwark-torso', 'fx-part-4', 88, null),
  fixturePart('dread-torso', 'fx-part-5', 59, 'void'),
  fixturePart('bulwark-back', 'fx-part-6', 77, null),
  fixturePart('bulwark-arm-upper-n', 'fx-part-7', 69, null),
  fixturePart('bulwark-arm-fore-n', 'fx-part-8', 55, null, 'locked'),
  fixturePart('dread-lower-leg-f', 'fx-part-9', 91, 'arctic'),
];

const FIXTURE_SELECTION: CosmeticSelection = {
  equipped: { head: 'fx-part-1', torso: 'fx-part-4', back: 'fx-part-6' },
  headVariant: 'visor',
};

const WEARABLE_VARIANTS = ['visor', 'optic', 'hood', 'fin', 'mfr-redline'];

/** The console's weapon readout: a real generated instance (the
 *  same generator the Chef uses), not a drawn prop. */
const FIXTURE_WEAPON_INPUT = (() => {
  try {
    const weapon = generateWeapon(
      { source: DropSource.BossDrop, level: 24, forcedRarity: Rarity.Legendary },
      createTickRng('subpages-demo', 'stand-weapon', 1),
    );
    return pixelWeaponInputFromWeapon(weapon);
  } catch {
    return undefined;
  }
})();

/** Compact steel control for bay rows (Preview / Remove). */
const BayButton: React.FC<{
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}> = ({ children, disabled = false, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    className="flex min-h-[44px] shrink-0 items-center justify-center px-3.5 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
    style={{
      border: `2px solid ${STEEL_DARK}`,
      background: 'linear-gradient(180deg, #171310 0%, #0C0A07 100%)',
      color: MUT,
      boxShadow: 'inset 0 1px 0 rgba(245,239,230,0.07)',
    }}
  >
    {children}
  </button>
);

/** One mono readout pair in the rig panel: label left, value right. */
const Readout: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor = INK,
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}>
      {label}
    </span>
    <span className="text-right text-[12px] font-bold uppercase" style={{ ...monoStyle, color: valueColor }}>
      {value}
    </span>
  </div>
);

export interface WardrobeConsolePageProps {
  initialSlot?: CosmeticSlot;
  /** Part DEFINITION id (e.g. 'dread-head') to open previewed. */
  initialPreviewPartId?: string;
  initialGuest?: boolean;
}

export const WardrobeConsolePage: React.FC<WardrobeConsolePageProps> = ({
  initialSlot = 'head',
  initialPreviewPartId,
  initialGuest = false,
}) => {
  const [selection, setSelection] = useState<CosmeticSelection>(FIXTURE_SELECTION);
  const [selectedSlot, setSelectedSlot] = useState<CosmeticSlot>(initialSlot);
  const [previewId, setPreviewId] = useState<string | null>(() => {
    if (!initialPreviewPartId) return null;
    return FIXTURE_PARTS.find((p) => p.partId === initialPreviewPartId)?.id ?? null;
  });
  const guest = initialGuest;

  const partsById = useMemo(() => new Map(FIXTURE_PARTS.map((p) => [p.id, p])), []);
  const previewPart = previewId ? partsById.get(previewId) : undefined;

  const effectiveSelection: CosmeticSelection = useMemo(() => {
    if (!previewPart) return selection;
    return { ...selection, equipped: { ...selection.equipped, [previewPart.slot]: previewPart.id } };
  }, [selection, previewPart]);

  const look = useMemo(
    () => resolveOwnLook({ selection: effectiveSelection, partsById, fallbackHeadVariant: 'visor' }),
    [effectiveSelection, partsById],
  );

  const ownedBySlot = useMemo(() => {
    const map = new Map<CosmeticSlot, CosmeticPartItemView[]>();
    for (const p of FIXTURE_PARTS) {
      const list = map.get(p.slot) ?? [];
      list.push(p);
      map.set(p.slot, list);
    }
    return map;
  }, []);
  const ownedPartIds = useMemo(() => new Set(FIXTURE_PARTS.map((p) => p.partId)), []);
  const wornCount = Object.values(selection.equipped).filter(Boolean).length;
  const setsOwned = useMemo(() => new Set(FIXTURE_PARTS.map((p) => p.setId)).size, []);
  const wornSetLine =
    [...new Set(Object.values(effectiveSelection.equipped).filter(Boolean).map((id) => skinSetById(partsById.get(id!)!.setId)?.name ?? ''))]
      .filter(Boolean)
      .join(' · ') || 'Standard Issue';

  const wear = (part: CosmeticPartItemView) => {
    setSelection((s) => ({ ...s, equipped: { ...s.equipped, [part.slot]: part.id } }));
    setPreviewId(null);
  };
  const remove = (slot: CosmeticSlot) => {
    setSelection((s) => {
      const equipped = { ...s.equipped };
      delete equipped[slot];
      return { ...s, equipped };
    });
    setPreviewId(null);
  };
  const pickSlot = (slot: CosmeticSlot) => {
    setSelectedSlot(slot);
    setPreviewId(null);
  };

  const headWorn = !!selection.equipped.head;
  const previewChannel = previewPart ? COSMETIC_SLOTS.indexOf(previewPart.slot) + 1 : 0;

  return (
    <div className="space-y-3" data-testid="wardrobe-console">
      {/* ── CONSOLE HEAD ─────────────────────────────────────────── */}
      <Panel testId="wardrobe-console-head">
        <PanelLabel label="Fitting console" right="SYS NOMINAL" />
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[26px] uppercase leading-none" style={{ ...headStyle, color: INK }}>
            Wardrobe
          </h1>
          <span className="flex items-center gap-2">
            <Led lit color={GREEN} />
            <span className="text-[11px] font-black uppercase" style={{ ...monoStyle, color: GREEN, letterSpacing: '0.1em' }}>
              Cosmetic only
            </span>
          </span>
        </div>
        <div className="mt-2 text-[12px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
          Unit Rook Sandoval · LV 24 · Rig under measurement
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <LcdWell value={String(wornCount)} label="Worn" valueSize={20} />
          <LcdWell value={String(FIXTURE_PARTS.length)} label="Owned" valueSize={20} />
          <LcdWell value={String(COSMETIC_SLOTS.length)} label="Mounts" valueSize={20} />
          <LcdWell value={String(setsOwned)} label="Sets" valueSize={20} />
        </div>
        <div className="mt-3 text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
          Pure cosmetic — zero stats. No mechanics path reads this rig.
        </div>
        {guest && (
          <div className="mt-2 flex items-center gap-2 text-[11px] font-black uppercase" style={{ ...monoStyle, color: AMBER }}>
            <PxIcon name="lock" size={13} />
            Guest — sign in to wear · browsing open
          </div>
        )}
      </Panel>

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
              legendary's full barrel — fits the glass. */}
          <div style={{ width: 'calc(100% + 48px)', marginLeft: -48 }}>
            <HunterPortrait look={look} weaponInput={FIXTURE_WEAPON_INPUT} className="h-[264px]" testId="wardrobe-rig-portrait" />
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
        <div>
          {COSMETIC_SLOTS.map((slot, idx) => {
            const ch = `CH-${String(idx + 1).padStart(2, '0')}`;
            const wornId = selection.equipped[slot];
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
                          {headWorn && <span style={{ color: AMBER }}> · helm worn — pick overridden</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="wardrobe-variants">
                          {HUNTER_HEAD_VARIANTS.filter((v) => WEARABLE_VARIANTS.includes(v.id)).map((v) => {
                            const active = !headWorn && selection.headVariant === v.id;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                disabled={guest || headWorn}
                                onClick={() => setSelection((s) => ({ ...s, headVariant: v.id }))}
                                className="flex min-h-[44px] items-center gap-2 px-3 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
                                style={{
                                  border: `2px solid ${active ? INK : STEEL_DARK}`,
                                  backgroundColor: active ? 'rgba(245,239,230,0.08)' : 'rgba(6,5,4,0.6)',
                                  color: active ? INK : MUT,
                                }}
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
                          const isWorn = selection.equipped[p.slot] === p.id;
                          const isPreviewing = previewId === p.id;
                          const locked = p.runtimeState === 'locked';
                          const tint = p.tintPaletteId ? tintPaletteById(p.tintPaletteId) : undefined;
                          return (
                            <div
                              key={p.id}
                              className="px-2.5 py-2"
                              style={{
                                border: `1px solid ${isPreviewing ? AMBER : 'rgba(58,52,43,0.8)'}`,
                                backgroundColor: 'rgba(6,5,4,0.55)',
                              }}
                              data-testid={`bay-part-${p.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] uppercase leading-snug" style={{ ...headStyle, color: INK }}>
                                    {p.name}
                                  </div>
                                  <div className="text-[11px] font-bold uppercase leading-snug" style={{ ...monoStyle, color: FAINT }}>
                                    {skinSetById(p.setId)?.name ?? p.setId} · {FINISH_LABELS[finishTierForQuality(p.quality)]} · Q{p.quality}
                                    {tint ? ` · ${tint.name} tint` : ''}
                                    {locked ? ' · Locked' : ''}
                                  </div>
                                </div>
                                {isWorn ? (
                                  <BayButton disabled={guest} onClick={() => remove(p.slot)} testId={`remove-${p.id}`}>
                                    Remove
                                  </BayButton>
                                ) : locked ? null : isPreviewing ? null : (
                                  <BayButton disabled={guest} onClick={() => setPreviewId(p.id)} testId={`preview-${p.id}`}>
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
                                  <PushButton armed disabled={guest} onClick={() => wear(p)} testId={`wear-${p.id}`}>
                                    Wear it
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
        {SKIN_SETS.map((set) => {
          const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !ownedPartIds.has(p.partId));
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
                    <span className="min-w-0 text-[12px] font-semibold leading-snug" style={{ color: MUT }}>
                      {p.name}
                      <span style={{ ...monoStyle, color: FAINT }}> · {SLOT_LABELS[p.slot]}</span>
                    </span>
                    <span className="shrink-0 text-right text-[11px]" style={{ ...monoStyle, color: FAINT }}>
                      {recipeCostLine(p.recipeId)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className="mt-2 text-[11px] font-bold uppercase leading-relaxed" style={{ ...monoStyle, color: FAINT }}>
          Crafted with Scrap in the Workshop. Parts trade on the player market once unequipped. All mounts open — no gates.
        </div>
      </Panel>
    </div>
  );
};
