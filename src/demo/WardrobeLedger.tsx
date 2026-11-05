/**
 * WardrobeLedger — PROTOTYPE (design/hunter-subpages-wardrobe-d,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Wardrobe kept the way a frontier registry clerk keeps it:
 * FORM W-10, the hunter's ISSUE LEDGER. Variant A stands the hunter
 * on a machined fitting stand; here he is FILED. His portrait is a
 * photograph pasted into the front of the file (the real rig render
 * — resolveOwnLook + HunterPortrait over a fixture
 * CosmeticsStateView, so the real-item invariant holds), his ten
 * mounts are ruled ledger lines, and every state a plate would
 * engrave is instead a verdict struck in stamp ink: WORN (amber),
 * n ON FILE (grey), EMPTY SLOT (faded rust), PREVIEW — NOT ISSUED
 * (crimson, struck across the photograph itself).
 *
 * Below the register, the SLOT FILE opens one mount's records:
 * each owned part is a filed entry with its finish, quality, set
 * and tint in the clerk's mono, and the actions are a clerk's —
 * TRY ON (the part goes on the photograph, unissued), ISSUE (the
 * amber commit), RETURN TO FILE. The catalog closes the book as a
 * REQUISITION SCHEDULE: parts are made by the Workshop, never
 * bought from the registry, and a filled part is tradeable once it
 * is off the subject — the form says so, because the form is where
 * the rules live in this register.
 *
 * Function coverage vs the shipped WardrobePanel: showcase portrait
 * with the equipped weapon, head-variant picks (+ the worn-helm
 * override), owned parts by slot with wear/remove, the escrowed
 * (market-locked) part state, the full craftable catalog with real
 * recipe cost lines, and the guest lock presented at the action
 * (harness toggle). Skins stay pure cosmetic — the form's first
 * note says it in print: no part in this ledger carries a statistic.
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
import { DoubleRule, FormField, HairRule, InkBox, LedgerHead, Stamp } from './paperKit';
import {
  BONE,
  CLERK,
  INK_AMBER,
  INK_CRIMSON,
  INK_GREY,
  INK_RUST,
  MONO,
  PENCIL,
  STOCK,
} from './paperTokens';

const SLOT_LABELS: Record<CosmeticSlot, string> = {
  head: 'Head',
  torso: 'Torso',
  armUpperN: 'Arm — Near',
  armForeN: 'Forearm',
  armFar: 'Arm — Far',
  thighF: 'Thigh — Front',
  thighB: 'Thigh — Back',
  lowerLegF: 'Lower Leg — Front',
  lowerLegB: 'Lower Leg — Back',
  back: 'Back',
};

/* ── Fixture — shaped like the Chef's CosmeticsStateView payload.
 * The SAME fixture as Variant A (Rook Sandoval, level 24; 9 parts
 * owned across 6 mounts, 3 worn; one tint, one escrowed) so the
 * five looks compare on identical facts. ──────────────────────── */
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

/** The file's weapon: a real generated instance (the same generator
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

const SCHEDULE_LETTERS = ['A', 'B', 'C', 'D'];

export interface WardrobeLedgerProps {
  initialSlot?: CosmeticSlot;
  /** Part DEFINITION id (e.g. 'dread-head') to open previewed. */
  initialPreviewPartId?: string;
  initialGuest?: boolean;
}

export const WardrobeLedger: React.FC<WardrobeLedgerProps> = ({
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
  const heldCount = FIXTURE_PARTS.length - wornCount;
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
  const slotParts = ownedBySlot.get(selectedSlot) ?? [];

  return (
    <div className="px-4 pb-5 pt-4" style={STOCK} data-testid="wardrobe-ledger">
      {/* ── FORM HEAD ─────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: PENCIL, fontFamily: MONO }}>
          Form W-10
        </span>
        <span className="text-right text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: PENCIL }}>
          Frontier Registry · Equipment Desk
        </span>
      </div>
      <h1
        className="mt-2 text-[27px] leading-none tracking-wide"
        style={{ color: BONE, fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif" }}
      >
        Wardrobe — Issue Ledger
      </h1>
      <DoubleRule className="mt-2.5" />
      <div className="mt-3 space-y-1.5">
        <FormField label="Name" value="Rook Sandoval" />
        <FormField label="File" value="№ 024 · Level 24" />
        <FormField label="Holdings" value={`${FIXTURE_PARTS.length} parts on file · ${wornCount} issued`} />
      </div>
      <p className="mt-3 text-[11px] font-bold uppercase leading-relaxed tracking-[0.08em]" style={{ color: CLERK }}>
        Issue is cosmetic only. No part in this ledger carries a statistic.
      </p>

      {/* ── THE PHOTOGRAPH — FIG. 1 ───────────────────────────── */}
      <figure className="mt-4" style={{ backgroundColor: '#0C0A07', border: '1px solid rgba(239,231,211,0.3)', padding: 10 }}>
        <div className="relative">
          {/* Photo corners — the paste mounts of a filed photograph. */}
          {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(
            (pos) => (
              <span key={pos} aria-hidden="true" className={`absolute z-10 h-[14px] w-[14px] ${pos}`} style={{ borderColor: 'rgba(239,231,211,0.55)' }} />
            ),
          )}
          <HunterPortrait look={look} weaponInput={FIXTURE_WEAPON_INPUT} className="h-[300px]" testId="wardrobe-ledger-portrait" />
          <div className="absolute right-3 top-3">
            {previewPart ? (
              <Stamp key={`pv-${previewPart.id}`} text="Preview — Not Issued" ink={INK_CRIMSON} tilt={-7} size={13} strike />
            ) : (
              <Stamp key="current" text="Issue Current" ink={INK_AMBER} tilt={-7} size={13} strike />
            )}
          </div>
        </div>
        <figcaption className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: PENCIL, fontFamily: MONO }}>
          Fig. 1 — {previewPart ? 'Subject in trial fitting · unissued part shown' : 'The subject in current issue'}
        </figcaption>
      </figure>

      {/* Issue abstract — the state of the file, typed. */}
      <div className="mt-4 space-y-1.5">
        <FormField label="Set on subject" value={wornSetLine} />
        <FormField label="Issued" value={`${wornCount} of ${COSMETIC_SLOTS.length} mounts`} />
        <FormField label="Held on file" value={`${heldCount} parts`} />
      </div>

      {/* ── REGISTER OF MOUNTS ────────────────────────────────── */}
      <LedgerHead title="Register of Mounts" note="Tap a line" className="mt-6" />
      <div className="mt-1 flex items-baseline gap-2 px-1 pb-1 pt-2">
        <span className="w-7 shrink-0 text-[11px] font-bold uppercase" style={{ color: PENCIL, fontFamily: MONO }}>№</span>
        <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PENCIL }}>
          Mount · Part of record
        </span>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PENCIL }}>Verdict</span>
      </div>
      <HairRule />
      <div data-testid="wardrobe-register">
        {COSMETIC_SLOTS.map((slot, i) => {
          const wornId = selection.equipped[slot];
          const worn = wornId ? partsById.get(wornId) : undefined;
          const owned = ownedBySlot.get(slot) ?? [];
          const selected = selectedSlot === slot;
          const previewingHere = previewPart?.slot === slot;
          const shown = previewingHere ? previewPart : worn;
          return (
            <React.Fragment key={slot}>
              <button
                type="button"
                onClick={() => pickSlot(slot)}
                className="flex w-full items-center gap-2 px-1 py-2 text-left"
                style={{ backgroundColor: selected ? 'rgba(239,231,211,0.05)' : 'transparent', minHeight: 56 }}
                data-testid={`ledger-line-${slot}`}
              >
                <span
                  className="w-7 shrink-0 text-[13px] font-semibold"
                  style={{ color: selected ? INK_AMBER : PENCIL, fontFamily: MONO }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: selected ? BONE : CLERK }}>
                    {SLOT_LABELS[slot]}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-bold leading-snug" style={{ color: shown ? BONE : PENCIL }}>
                    {shown ? shown.name : 'Standard Issue'}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-snug" style={{ color: PENCIL, fontFamily: MONO }}>
                    {shown
                      ? `${FINISH_LABELS[finishTierForQuality(shown.quality)]} · Q${shown.quality}${shown.tintPaletteId ? ` · ${tintPaletteById(shown.tintPaletteId)?.name ?? ''} tint` : ''}${shown.runtimeState === 'locked' ? ' · in escrow' : ''}`
                      : owned.length > 0
                        ? 'Filed in the slot file below'
                        : 'No part on file for this mount'}
                  </span>
                </span>
                {previewingHere ? (
                  <Stamp key={`line-pv-${previewPart!.id}`} text="Preview" ink={INK_CRIMSON} tilt={-5} strike />
                ) : worn ? (
                  <Stamp text="Worn" ink={INK_AMBER} tilt={-4} />
                ) : owned.length > 0 ? (
                  <Stamp text={`${owned.length} On File`} ink={INK_GREY} tilt={-6} />
                ) : (
                  <Stamp text="Empty Slot" ink={INK_RUST} tilt={-5} />
                )}
              </button>
              <HairRule />
            </React.Fragment>
          );
        })}
      </div>

      {/* ── SLOT FILE — the selected mount, opened ────────────── */}
      <LedgerHead
        title={`Slot File — ${SLOT_LABELS[selectedSlot]}`}
        note={slotParts.length > 0 ? `${slotParts.length} on file` : 'Nothing filed'}
        className="mt-6"
      />
      <div data-testid="wardrobe-slot-file">
        {selectedSlot === 'head' && (
          <div className="pt-3">
            <div className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: CLERK }}>
              Base head — entered when no helm is worn
              {headWorn && <span style={{ color: INK_AMBER }}> · a worn helm overrides the entry</span>}
            </div>
            <div className="mt-2" data-testid="wardrobe-variants">
              {HUNTER_HEAD_VARIANTS.filter((v) => WEARABLE_VARIANTS.includes(v.id)).map((v) => {
                const active = !headWorn && selection.headVariant === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={guest || headWorn}
                    onClick={() => setSelection((s) => ({ ...s, headVariant: v.id }))}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-1 py-1 text-left disabled:opacity-50"
                  >
                    <InkBox checked={active} disabled={headWorn} />
                    <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: active ? BONE : CLERK }}>
                      {v.label}
                    </span>
                    {v.standingManufacturer && (
                      <span className="text-[11px] font-semibold uppercase" style={{ color: PENCIL, fontFamily: MONO }}>
                        · Standing entry
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <HairRule className="mt-2" />
          </div>
        )}

        {slotParts.length === 0 ? (
          <p className="pt-3 text-[12px] leading-relaxed" style={{ color: CLERK }}>
            No part on file for this mount. Parts are made in the Workshop — Parts lane — and are filed here when they
            reach you.
          </p>
        ) : (
          slotParts.map((p) => {
            const worn = selection.equipped[p.slot] === p.id;
            const previewing = previewId === p.id;
            const escrowed = p.runtimeState === 'locked';
            const tint = p.tintPaletteId ? tintPaletteById(p.tintPaletteId) : undefined;
            return (
              <div key={p.id}>
                <div className="flex items-center gap-2 py-2.5" data-testid={`record-${p.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-[13px] font-bold leading-snug" style={{ color: BONE }}>
                        {p.name}
                      </span>
                      {escrowed ? (
                        <Stamp text="In Escrow" ink={INK_GREY} tilt={-4} />
                      ) : previewing ? (
                        <Stamp key={`rec-pv-${p.id}`} text="On the Subject — Trial" ink={INK_CRIMSON} tilt={-4} size={11} strike />
                      ) : worn ? (
                        <Stamp text="Issued" ink={INK_AMBER} tilt={-5} />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] leading-snug" style={{ color: PENCIL, fontFamily: MONO }}>
                      {FINISH_LABELS[finishTierForQuality(p.quality)]} · Q{p.quality}
                      {tint ? ` · ${tint.name} tint` : ''} · {skinSetById(p.setId)?.name ?? p.setId}
                      {escrowed ? ' · held by the market — not issuable' : ''}
                    </div>
                  </div>
                  {!escrowed &&
                    (worn ? (
                      <button
                        type="button"
                        disabled={guest}
                        onClick={() => remove(p.slot)}
                        className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
                        style={{ border: `2px solid ${CLERK}`, color: BONE, backgroundColor: 'transparent' }}
                      >
                        Return to File
                      </button>
                    ) : previewing ? (
                      <button
                        type="button"
                        disabled={guest}
                        onClick={() => wear(p)}
                        className="min-h-[44px] shrink-0 px-4 text-[12px] font-black uppercase tracking-[0.1em] text-black disabled:opacity-40"
                        style={{ backgroundColor: INK_AMBER, boxShadow: '3px 3px 0 rgba(0,0,0,0.6)' }}
                        data-testid={`issue-${p.id}`}
                      >
                        Issue
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={guest}
                        onClick={() => setPreviewId(p.id)}
                        className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-[0.1em] disabled:opacity-40"
                        style={{ border: `2px solid ${CLERK}`, color: CLERK, backgroundColor: 'transparent' }}
                      >
                        Try On
                      </button>
                    ))}
                </div>
                <HairRule />
              </div>
            );
          })
        )}
        {guest && (
          <div className="mt-3 flex items-center gap-2">
            <PxIcon name="lock" size={13} className="shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: INK_AMBER }}>
              Sign in to issue parts — inspection of the file is free.
            </span>
          </div>
        )}
      </div>

      {/* ── REQUISITION SCHEDULE — the unfilled catalog ───────── */}
      <LedgerHead title="Requisition Schedule" note="Workshop — Parts lane" className="mt-6" />
      <p className="mt-2.5 text-[11px] font-bold uppercase leading-relaxed tracking-[0.08em]" style={{ color: CLERK }}>
        The registry issues nothing it does not hold. A filled part is tradeable once it is off the subject.
      </p>
      {SKIN_SETS.map((set, si) => {
        const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !ownedPartIds.has(p.id));
        if (rows.length === 0) return null;
        return (
          <div key={set.id} className="mt-4">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <span className="text-[12px] font-black uppercase tracking-[0.12em]" style={{ color: BONE }}>
                Schedule {SCHEDULE_LETTERS[si]} — {set.name}
              </span>
              <span className="shrink-0 text-[11px] font-bold uppercase" style={{ color: PENCIL }}>
                {rows.length} open
              </span>
            </div>
            <HairRule className="mt-1.5" />
            {rows.map((p) => (
              <div key={p.id}>
                <div className="px-1 py-[7px]">
                  <div className="truncate text-[12px] font-semibold leading-snug" style={{ color: CLERK }}>
                    {p.name}
                    <span style={{ color: PENCIL }}> · {SLOT_LABELS[p.slot]}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] leading-snug" style={{ color: PENCIL, fontFamily: MONO }}>
                    {recipeCostLine(p.recipeId)}
                  </div>
                </div>
                <HairRule />
              </div>
            ))}
          </div>
        );
      })}
      <div className="mt-5 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: PENCIL, fontFamily: MONO }}>
          End of file W-10
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: PENCIL }}>
          Clerk's copy
        </span>
      </div>
    </div>
  );
};
