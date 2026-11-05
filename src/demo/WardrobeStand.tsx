/**
 * WardrobeStand — PROTOTYPE (design/hunter-subpages-wardrobe-manual,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Wardrobe reimagined as a FITTING STAND inside the Arena Plates
 * family the owner approved for the Hunter tab. The shipped panel is
 * one MobileCard with a purple side bar and three stacked lists; here
 * the hunter himself is the page: he stands on a plinth inside a
 * machined plate wearing the REAL rig (resolveOwnLook + HunterPortrait
 * over a fixture CosmeticsStateView — the real-item invariant holds:
 * the figure is resolved from the same payload shape the Chef ships).
 * Below the stand, the ten cosmetic slots are MOUNT PLATES mapped in
 * anatomical order; tapping a mount opens its fitting drawer, where a
 * part is first PREVIEWED on the figure (the stand re-renders, the
 * state gauge flips to amber PREVIEW) and then committed with WEAR —
 * amber appears exactly once, on the commit that is waiting.
 *
 * Function coverage vs the shipped WardrobePanel: showcase portrait
 * with the equipped weapon, head-variant pick (+ the worn-helm
 * override note and disabled state), owned parts by slot with
 * Wear/Remove, locked-part state, the full craftable catalog with
 * real recipe cost lines, and the guest lock presented at the action
 * (harness toggle). Fixture state is local to the prototype; wear /
 * remove / variant ops mutate the local selection exactly as the
 * server record would be re-read.
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
import { AMBER, BONE, BONE_FAINT, BONE_MUTED, Bolts, FootStrip, STEEL, plateShell } from './plate';

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

/* ── Fixture — shaped like the Chef's CosmeticsStateView payload.
 * Same hunter as the menu pass (Rook Sandoval, level 24) so the two
 * passes read as one world. 9 parts owned across 6 mounts, 3 worn;
 * one part carries a tint, one is market-locked. ─────────────────── */
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

/** The stand's weapon: a real generated instance (the same generator
 *  the Chef uses), not a drawn prop. */
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

export interface WardrobeStandProps {
  initialSlot?: CosmeticSlot;
  /** Part DEFINITION id (e.g. 'dread-head') to open previewed. */
  initialPreviewPartId?: string;
  initialGuest?: boolean;
}

export const WardrobeStand: React.FC<WardrobeStandProps> = ({
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

  return (
    <div className="space-y-3" data-testid="wardrobe-stand">
      {/* Page label — the stand below is the header. */}
      <div className="flex items-baseline justify-between px-1">
        <div className="bl-title text-[22px] leading-none" style={{ color: BONE }}>
          Wardrobe
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
          Pure cosmetic — zero stats
        </div>
      </div>

      {/* ── THE STAND ─────────────────────────────────────────────── */}
      <div className="relative" style={plateShell} data-testid="wardrobe-stand-plate">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 46% at 50% 30%, rgba(255,144,0,0.08), transparent 70%), linear-gradient(180deg, rgba(0,0,0,0.25), transparent 30%)',
          }}
        />
        <Bolts />
        <div className="relative flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="px-2.5 py-1.5" style={{ border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.82)' }}>
            <div className="text-[15px] font-black uppercase leading-none tracking-wide" style={{ color: BONE }}>
              Rook Sandoval
            </div>
            <div className="mt-1 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
              Level 24
            </div>
          </div>
          {previewPart ? (
            <div
              className="px-2.5 py-1.5 text-right"
              style={{ backgroundColor: AMBER, boxShadow: '3px 3px 0 rgba(0,0,0,0.75)' }}
              data-testid="wardrobe-preview-gauge"
            >
              <div className="text-[13px] font-black uppercase leading-none text-black">Preview</div>
              <div className="mt-1 max-w-[150px] truncate text-[11px] font-bold uppercase leading-none text-black/70">
                {previewPart.name}
              </div>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 text-right" style={{ border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.82)' }}>
              <div className="text-[15px] font-black leading-none" style={{ color: BONE }}>
                {wornCount} worn
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
                {FIXTURE_PARTS.length} owned
              </div>
            </div>
          )}
        </div>

        <div className="relative mx-2">
          <HunterPortrait look={look} weaponInput={FIXTURE_WEAPON_INPUT} className="h-[318px]" testId="wardrobe-stand-portrait" />
          {/* The plinth the figure stands on. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-6 bottom-[6px] h-[9px]"
            style={{
              background: 'linear-gradient(180deg, #4A4237 0%, #241E16 55%, #0A0806 100%)',
              boxShadow: '0 2px 0 rgba(0,0,0,0.8), inset 0 1px 0 rgba(201,187,166,0.35)',
            }}
          />
        </div>

        <div className="relative flex items-center justify-between px-4 pb-4 pt-1">
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
            Worn set —{' '}
            <span style={{ color: BONE }}>
              {[...new Set(Object.values(effectiveSelection.equipped).filter(Boolean).map((id) => skinSetById(partsById.get(id!)!.setId)?.name ?? ''))]
                .filter(Boolean)
                .join(' · ') || 'Standard Issue'}
            </span>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
            {wornCount} of {COSMETIC_SLOTS.length} mounts filled
          </div>
        </div>
        <FootStrip color={previewPart ? AMBER : undefined} />
      </div>

      {/* ── MOUNT RAIL — the body, mapped as plates ───────────────── */}
      <div className="flex items-baseline justify-between px-1 pt-1">
        <div className="bl-title text-[17px] leading-none" style={{ color: BONE }}>
          Mounts
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
          Tap a mount to fit it
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2" data-testid="wardrobe-mounts">
        {COSMETIC_SLOTS.map((slot) => {
          const wornId = selection.equipped[slot];
          const worn = wornId ? partsById.get(wornId) : undefined;
          const owned = ownedBySlot.get(slot) ?? [];
          const selected = selectedSlot === slot;
          const previewingHere = previewPart?.slot === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => pickSlot(slot)}
              className={`relative px-3 pb-3 pt-2.5 text-left ${slot === 'head' ? 'col-span-2' : ''}`}
              style={{
                clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
                border: '2px solid #000',
                background: selected
                  ? 'linear-gradient(158deg, #2A2115 0%, #171208 60%, #0E0B07 100%)'
                  : 'linear-gradient(158deg, #1B1610 0%, #100E0A 60%, #0B0908 100%)',
                boxShadow: `3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 1px rgba(163,152,134,${selected ? 0.45 : 0.22})`,
              }}
              data-testid={`mount-${slot}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: selected ? BONE : BONE_FAINT }}>
                  {SLOT_LABELS[slot]}
                </span>
                <span
                  className="text-[11px] font-black uppercase"
                  style={{ color: previewingHere ? AMBER : worn ? BONE : BONE_FAINT }}
                >
                  {previewingHere ? 'Previewing' : worn ? 'Worn' : owned.length > 0 ? `${owned.length} owned` : 'Empty'}
                </span>
              </div>
              <div className="mt-1 truncate text-[13px] font-bold leading-snug" style={{ color: worn || previewingHere ? BONE : BONE_FAINT }}>
                {previewingHere ? previewPart!.name : worn ? worn.name : 'Standard Issue'}
              </div>
              <div className="truncate text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                {worn
                  ? `${FINISH_LABELS[finishTierForQuality(worn.quality)]} · Q${worn.quality}${worn.tintPaletteId ? ` · ${tintPaletteById(worn.tintPaletteId)?.name ?? ''} tint` : ''}`
                  : owned.length > 0
                    ? 'Tap to fit a part here'
                    : 'Nothing owned for this mount'}
              </div>
              <FootStrip color={selected ? AMBER : undefined} height={selected ? 4 : 3} />
            </button>
          );
        })}
      </div>

      {/* ── FITTING DRAWER — the selected mount, opened ───────────── */}
      <div className="relative px-4 pb-4 pt-3" style={plateShell} data-testid="wardrobe-drawer">
        <Bolts />
        <div className="flex items-baseline justify-between gap-2">
          <div className="bl-title text-[17px] leading-none" style={{ color: BONE }}>
            {SLOT_LABELS[selectedSlot]} — fitting
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
            {(ownedBySlot.get(selectedSlot) ?? []).length} owned
          </div>
        </div>

        {selectedSlot === 'head' && (
          <div className="mt-3">
            <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_MUTED }}>
              Base head — worn when no helm is on
              {headWorn && <span style={{ color: AMBER }}> · a worn helm overrides the pick</span>}
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
                    className="min-h-[44px] px-3 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
                    style={{
                      border: `2px solid ${active ? BONE : STEEL}`,
                      backgroundColor: active ? 'rgba(245,239,230,0.10)' : 'rgba(6,5,4,0.6)',
                      color: active ? BONE : BONE_MUTED,
                    }}
                  >
                    {v.label}
                    {v.standingManufacturer ? ' · Standing' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {(ownedBySlot.get(selectedSlot) ?? []).length === 0 ? (
            <div className="text-[12px] leading-snug" style={{ color: BONE_MUTED }}>
              Nothing owned for this mount. Craft parts in the Workshop — Parts lane — and they will hang here.
            </div>
          ) : (
            (ownedBySlot.get(selectedSlot) ?? []).map((p) => {
              const worn = selection.equipped[p.slot] === p.id;
              const previewing = previewId === p.id;
              const tint = p.tintPaletteId ? tintPaletteById(p.tintPaletteId) : undefined;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-2.5 py-2"
                  style={{
                    border: `1px solid ${previewing ? AMBER : 'rgba(163,152,134,0.3)'}`,
                    backgroundColor: 'rgba(6,5,4,0.55)',
                  }}
                  data-testid={`drawer-part-${p.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold leading-snug" style={{ color: BONE }}>
                      {p.name}
                    </div>
                    <div className="truncate text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                      {FINISH_LABELS[finishTierForQuality(p.quality)]} · Q{p.quality}
                      {tint ? ` · ${tint.name} tint` : ''} · {skinSetById(p.setId)?.name ?? p.setId}
                      {p.runtimeState === 'locked' ? ' · Locked' : ''}
                    </div>
                  </div>
                  {worn ? (
                    <button
                      type="button"
                      disabled={guest}
                      onClick={() => remove(p.slot)}
                      className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
                      style={{ border: `2px solid ${STEEL}`, color: BONE, backgroundColor: 'rgba(6,5,4,0.6)' }}
                    >
                      Remove
                    </button>
                  ) : previewing ? (
                    <button
                      type="button"
                      disabled={guest}
                      onClick={() => wear(p)}
                      className="min-h-[44px] shrink-0 px-4 text-[12px] font-black uppercase tracking-wide text-black disabled:opacity-40"
                      style={{ backgroundColor: AMBER, boxShadow: '3px 3px 0 rgba(0,0,0,0.75)' }}
                      data-testid={`wear-${p.id}`}
                    >
                      Wear it
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={guest}
                      onClick={() => setPreviewId(p.id)}
                      className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
                      style={{ border: `2px solid ${STEEL}`, color: BONE_MUTED, backgroundColor: 'rgba(6,5,4,0.6)' }}
                    >
                      Preview
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        {guest && (
          <div className="mt-3 flex items-center gap-2 text-[11px] font-bold" style={{ color: AMBER }}>
            <PxIcon name="lock" size={13} />
            Sign in to craft and wear parts — browsing is free.
          </div>
        )}
      </div>

      {/* ── ORDER BOOK — the craftable catalog ────────────────────── */}
      <div className="flex items-baseline justify-between px-1 pt-1">
        <div className="bl-title text-[17px] leading-none" style={{ color: BONE }}>
          Order book
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
          Craftable — Workshop, Parts lane
        </div>
      </div>
      {SKIN_SETS.map((set) => {
        const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !ownedPartIds.has(p.partId));
        if (rows.length === 0) return null;
        return (
          <div key={set.id} className="relative px-4 pb-3 pt-2.5" style={plateShell}>
            <div className="flex items-baseline justify-between">
              <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
                {set.name}
              </div>
              <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
                {rows.length} to craft
              </div>
            </div>
            <div className="mt-1.5 space-y-1">
              {rows.map((p) => (
                <div key={p.id} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 truncate text-[12px] font-semibold" style={{ color: BONE_MUTED }}>
                    {p.name}
                    <span style={{ color: BONE_FAINT }}> · {SLOT_LABELS[p.slot]}</span>
                  </div>
                  <div className="shrink-0 text-[11px]" style={{ color: BONE_FAINT }}>
                    {recipeCostLine(p.recipeId)}
                  </div>
                </div>
              ))}
            </div>
            <FootStrip />
          </div>
        );
      })}
    </div>
  );
};
