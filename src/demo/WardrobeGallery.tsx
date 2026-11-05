/**
 * WardrobeGallery — PROTOTYPE (design/hunter-subpages-wardrobe-c,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Wardrobe reimagined as an EXHIBITION — the Showcase register.
 * Variant A (design/hunter-subpages-wardrobe-manual) built a fitting
 * stand out of machined Arena Plates: bolts, plinths, gauge wells,
 * mount plates, a fitting drawer. This variant hangs the same facts
 * as a gallery: no plates, no bolts, no gauges, no drawer. The
 * dressed hunter is the centerpiece — one full figure on a spotlit
 * dark wall above a hairline floor — and the museum caption plaque
 * beneath him is the page's only control surface: tap a piece in the
 * collection and it goes ON the centerpiece (a real preview state,
 * resolved through the same look pipeline the game renders with);
 * the plaque then offers the one amber decision, WEAR IT.
 *
 * Each owned piece hangs as a framed exhibit showing the piece
 * itself — the part rendered on the stock frame through
 * resolveLookView, the exact render the market's CosmeticMiniCard
 * uses, at gallery scale. Slots with nothing owned hang an empty
 * hook: the dimmed stock figure and an honest caption. The stock
 * head variants hang as a row of small pieces; the craftable
 * catalog closes the wall as the Reserve — pieces not yet owned,
 * hung dimmed with their real recipe cost lines.
 *
 * Content truth: fixtures are IDENTICAL to variant A's (Rook
 * Sandoval, Level 24; 9 owned parts across 6 mounts, 3 worn, one
 * tinted ×3, one locked) so the two looks compare on the same
 * facts. Function coverage vs the shipped WardrobePanel: showcase
 * portrait with the equipped weapon, head-variant pick (+ the
 * worn-helm override law), owned parts by slot with Wear/Remove,
 * locked-part state, the full craftable catalog with real recipe
 * cost lines, and the guest lock presented at the action.
 */
import React, { useMemo, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView, resolveOwnLook } from '@/lib/pixel/lookResolution';
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

/* ── Gallery tokens — the C register: a warm near-black wall, bone
 * captions, hairline frames, soft depth. Amber appears only where a
 * decision waits. ─────────────────────────────────────────────── */
const WALL = '#0B0908';
const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
const BONE_FAINT = '#A2957F';
const AMBER = '#FF9000';
const HAIRLINE = 'rgba(245,239,230,0.16)';
const FRAME_SHADOW = '0 18px 40px rgba(0,0,0,0.45), 0 3px 10px rgba(0,0,0,0.5)';
const DISPLAY: React.CSSProperties = { fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif" };
const SPOTLIGHT =
  'radial-gradient(ellipse 78% 52% at 50% 42%, rgba(255,160,50,0.10), transparent 70%), radial-gradient(ellipse 60% 40% at 50% 88%, rgba(255,144,0,0.05), transparent 70%)';

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

/* ── Fixture — shaped like the Chef's CosmeticsStateView payload,
 * identical to variant A's so the options compare on the same
 * facts. ──────────────────────────────────────────────────────── */
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

/** The centerpiece's weapon: a real generated instance (the same
 *  generator and seed the Chef-side fixture in variant A used), not
 *  a drawn prop. */
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

/** A piece's own portrait: the part alone on the stock frame — the
 *  market card's render path (resolveLookView), at gallery scale. */
function usePartLook(part: CosmeticPartItemView) {
  return useMemo(
    () =>
      resolveLookView({
        playerId: '',
        username: null,
        headVariant: 'visor',
        parts: {
          [part.slot]: { partId: part.partId, tintPaletteId: part.tintPaletteId, quality: part.quality },
        },
      }),
    [part],
  );
}

function partFacts(part: CosmeticPartItemView): string {
  const tint = part.tintPaletteId ? tintPaletteById(part.tintPaletteId) : undefined;
  return [
    `${FINISH_LABELS[finishTierForQuality(part.quality)]} · Q${part.quality}`,
    tint ? `${tint.name} tint` : null,
    skinSetById(part.setId)?.name ?? part.setId,
    part.runtimeState === 'locked' ? 'Locked' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface WardrobeGalleryProps {
  /** Part DEFINITION id (e.g. 'dread-head') to open previewed. */
  initialPreviewPartId?: string;
  initialGuest?: boolean;
}

export const WardrobeGallery: React.FC<WardrobeGalleryProps> = ({
  initialPreviewPartId,
  initialGuest = false,
}) => {
  const [selection, setSelection] = useState<CosmeticSelection>(FIXTURE_SELECTION);
  const [previewId, setPreviewId] = useState<string | null>(() => {
    if (!initialPreviewPartId) return null;
    return FIXTURE_PARTS.find((p) => p.partId === initialPreviewPartId)?.id ?? null;
  });
  /** The worn piece the caption plaque is currently about. */
  const [plaqueId, setPlaqueId] = useState<string | null>(null);
  const guest = initialGuest;
  const centerpieceRef = useRef<HTMLDivElement>(null);

  const partsById = useMemo(() => new Map(FIXTURE_PARTS.map((p) => [p.id, p])), []);
  const previewPart = previewId ? partsById.get(previewId) : undefined;
  const plaquePart = !previewPart && plaqueId ? partsById.get(plaqueId) : undefined;

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
  const headWorn = !!selection.equipped.head;
  const wornSetNames = [
    ...new Set(
      Object.values(effectiveSelection.equipped)
        .filter(Boolean)
        .map((id) => skinSetById(partsById.get(id!)!.setId)?.name ?? ''),
    ),
  ].filter(Boolean);

  const showCenterpiece = () => {
    centerpieceRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const tapPiece = (part: CosmeticPartItemView) => {
    if (selection.equipped[part.slot] === part.id) {
      setPreviewId(null);
      setPlaqueId(part.id);
    } else if (previewId === part.id) {
      setPreviewId(null);
    } else {
      setPreviewId(part.id);
      setPlaqueId(null);
    }
    showCenterpiece();
  };
  const wear = (part: CosmeticPartItemView) => {
    setSelection((s) => ({ ...s, equipped: { ...s.equipped, [part.slot]: part.id } }));
    setPreviewId(null);
    setPlaqueId(part.id);
  };
  const remove = (part: CosmeticPartItemView) => {
    setSelection((s) => {
      const equipped = { ...s.equipped };
      delete equipped[part.slot];
      return { ...s, equipped };
    });
    setPreviewId(null);
    setPlaqueId(null);
  };

  return (
    <div style={{ backgroundColor: WALL }} data-testid="wardrobe-gallery">
      {/* ── Title — a wall label, nothing more ──────────────────── */}
      <div className="px-1 pb-1 pt-2 text-center">
        <h1 className="text-[38px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
          Wardrobe
        </h1>
        <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
          The dressed hunter, exhibited. Every piece here is pure cosmetic — zero stats.
        </p>
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
          {wornCount} worn · {FIXTURE_PARTS.length} owned · {COSMETIC_SLOTS.length} mounts
        </p>
      </div>

      {/* ── THE CENTERPIECE ─────────────────────────────────────── */}
      <div ref={centerpieceRef} className="relative" data-testid="wardrobe-centerpiece">
        <div aria-hidden="true" className="absolute inset-0" style={{ background: SPOTLIGHT }} />
        <HunterPortrait
          look={look}
          weaponInput={FIXTURE_WEAPON_INPUT}
          className="relative h-[396px]"
          testId="wardrobe-centerpiece-portrait"
        />
        {/* The gallery floor: one hairline the figure stands on. */}
        <div aria-hidden="true" className="mx-10" style={{ borderTop: `1px solid ${HAIRLINE}` }} />
      </div>

      {/* ── THE CAPTION PLAQUE — the page's one control surface ── */}
      <div className="px-6 pb-2 pt-4 text-center" data-testid="wardrobe-plaque">
        {previewPart ? (
          <>
            <div
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: AMBER }}
              data-testid="wardrobe-preview-label"
            >
              Previewing
            </div>
            <div className="mt-1.5 text-[30px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
              {previewPart.name}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
              {partFacts(previewPart)} — on the figure above, not yet worn.
            </p>
            {guest ? (
              <p className="mt-3 flex items-center justify-center gap-2 text-[11px] font-bold" style={{ color: AMBER }}>
                <PxIcon name="lock" size={13} />
                Sign in to craft and wear parts — browsing is free.
              </p>
            ) : (
              <div className="mt-3.5 flex items-stretch justify-center gap-2">
                <button
                  type="button"
                  onClick={() => wear(previewPart)}
                  className="min-h-[48px] px-6 text-[13px] font-black uppercase tracking-wide text-black"
                  style={{ backgroundColor: AMBER, boxShadow: FRAME_SHADOW }}
                  data-testid={`wear-${previewPart.id}`}
                >
                  Wear it
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewId(null)}
                  className="min-h-[48px] px-5 text-[12px] font-black uppercase tracking-wide"
                  style={{ border: `1px solid ${HAIRLINE}`, color: BONE_MUTED }}
                >
                  Back to my look
                </button>
              </div>
            )}
          </>
        ) : plaquePart ? (
          <>
            <div className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: BONE_FAINT }}>
              On the figure
            </div>
            <div className="mt-1.5 text-[30px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
              {plaquePart.name}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
              {partFacts(plaquePart)} — worn on the {SLOT_LABELS[plaquePart.slot].toLowerCase()} mount.
            </p>
            {!guest && (
              <div className="mt-3.5 flex justify-center">
                <button
                  type="button"
                  onClick={() => remove(plaquePart)}
                  className="min-h-[48px] px-5 text-[12px] font-black uppercase tracking-wide"
                  style={{ border: `1px solid ${HAIRLINE}`, color: BONE_MUTED }}
                  data-testid={`remove-${plaquePart.id}`}
                >
                  Take it off
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[30px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
              Rook Sandoval
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
              Level 24 — wearing {wornSetNames.join(' · ') || 'Standard Issue'} over Standard Issue,{' '}
              {wornCount} of {COSMETIC_SLOTS.length} mounts filled.
            </p>
            <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
              Tap a piece below to try it on the figure
            </p>
          </>
        )}
      </div>

      {/* ── THE COLLECTION — owned pieces, hung by mount ────────── */}
      <div className="px-1 pb-1 pt-8 text-center">
        <h2 className="text-[24px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
          The Collection
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
          Nine pieces owned. Each hangs on the stock frame, so what you see is the piece itself.
        </p>
      </div>
      <div data-testid="wardrobe-collection">
        {COSMETIC_SLOTS.map((slot) => {
          const owned = ownedBySlot.get(slot) ?? [];
          return (
            <section key={slot} className="pt-6" aria-label={SLOT_LABELS[slot]}>
              <div
                className="text-center text-[11px] font-black uppercase tracking-[0.24em]"
                style={{ color: BONE_FAINT }}
              >
                {SLOT_LABELS[slot]}
              </div>
              {owned.length === 0 ? (
                <div className="mx-auto mt-3 max-w-[300px] text-center" data-testid={`empty-${slot}`}>
                  <div style={{ opacity: 0.38 }}>
                    <EmptyHookFigure />
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
                    Nothing owned for this mount.
                  </p>
                  <p className="text-[11px] leading-relaxed" style={{ color: BONE_FAINT }}>
                    Pieces are crafted in the Workshop — Parts lane.
                  </p>
                </div>
              ) : (
                owned.map((part) => (
                  <Exhibit
                    key={part.id}
                    part={part}
                    worn={selection.equipped[slot] === part.id}
                    previewing={previewId === part.id}
                    onTap={() => tapPiece(part)}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>

      {/* ── THE STOCK HEADS — the pick under the helm ───────────── */}
      <div className="px-1 pb-1 pt-10 text-center">
        <h2 className="text-[24px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
          The Stock Heads
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
          The head worn when no helm is on.
          {headWorn ? ' A worn helm overrides the pick.' : ' Tap one to make it the pick.'}
        </p>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 pt-3" data-testid="wardrobe-variants">
        {HUNTER_HEAD_VARIANTS.filter((v) => WEARABLE_VARIANTS.includes(v.id)).map((v) => {
          const active = !headWorn && selection.headVariant === v.id;
          return (
            <button
              key={v.id}
              type="button"
              disabled={guest || headWorn}
              onClick={() => setSelection((s) => ({ ...s, headVariant: v.id }))}
              className="w-[104px] shrink-0 disabled:opacity-45"
              data-testid={`wardrobe-variant-${v.id}`}
            >
              <span
                className="block"
                style={{
                  border: `1px solid ${active ? 'rgba(245,239,230,0.6)' : HAIRLINE}`,
                  boxShadow: FRAME_SHADOW,
                  background: SPOTLIGHT,
                }}
              >
                <VariantFigure variantId={v.id} />
              </span>
              <span className="mt-1.5 block text-[11px] font-bold leading-tight" style={{ color: active ? BONE : BONE_MUTED }}>
                {v.label}
                {v.standingManufacturer ? ' · Standing' : ''}
              </span>
              <span
                className="block text-[11px] font-black uppercase tracking-[0.14em]"
                style={{ color: active ? AMBER : BONE_FAINT }}
              >
                {active ? 'The pick' : headWorn ? 'Under the helm' : ' '}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── THE RESERVE — the craftable catalog, not yet owned ──── */}
      <div className="px-1 pb-1 pt-10 text-center">
        <h2 className="text-[24px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
          The Reserve
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
          Not yet owned. Every piece is crafted with Scrap in the Workshop — Parts lane — and hangs in the
          collection once it is yours.
        </p>
      </div>
      <div data-testid="wardrobe-catalog">
        {SKIN_SETS.map((set) => {
          const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !ownedPartIds.has(p.partId));
          if (rows.length === 0) return null;
          return (
            <section key={set.id} className="pt-6" aria-label={set.name}>
              <div className="text-center">
                <span className="text-[19px] tracking-wide" style={{ ...DISPLAY, color: BONE }}>
                  {set.name}
                </span>
                <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
                  {rows.length} to craft
                </span>
              </div>
              <p className="mx-auto mt-1.5 max-w-[320px] text-center text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
                {set.blurb}
              </p>
              {rows.map((def) => (
                <ReservePiece key={def.id} partId={def.id} />
              ))}
            </section>
          );
        })}
      </div>

      {/* ── Colophon ────────────────────────────────────────────── */}
      <p className="px-8 pb-8 pt-10 text-center text-[11px] leading-relaxed" style={{ color: BONE_FAINT }}>
        {guest
          ? 'Sign in to craft and wear parts — browsing is free.'
          : 'Pieces are crafted, traded, and sold like everything else in the wastes — take a piece off to list it.'}
      </p>
    </div>
  );
};

/** One framed exhibit: the piece on the stock frame, its name in
 *  display type, its facts as the caption, its state as a sentence. */
const Exhibit: React.FC<{
  part: CosmeticPartItemView;
  worn: boolean;
  previewing: boolean;
  onTap: () => void;
}> = ({ part, worn, previewing, onTap }) => {
  const look = usePartLook(part);
  const state = previewing
    ? 'On the figure — preview'
    : worn
      ? 'On the figure now'
      : 'In the collection';
  return (
    <button
      type="button"
      onClick={onTap}
      className="mx-auto mt-3 block w-full max-w-[340px] px-4 text-center"
      data-testid={`exhibit-${part.id}`}
      aria-label={`${part.name} — ${state}. Tap to ${worn ? 'see it on the figure' : 'preview it on the figure'}`}
    >
      <span
        className="block"
        style={{
          border: `1px solid ${previewing ? AMBER : HAIRLINE}`,
          boxShadow: FRAME_SHADOW,
          background: SPOTLIGHT,
        }}
      >
        <HunterPortrait look={look} className="h-[196px]" testId={`exhibit-portrait-${part.id}`} />
      </span>
      <span className="mt-2.5 block text-[21px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE }}>
        {part.name}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed" style={{ color: BONE_MUTED }}>
        {partFacts(part)}
      </span>
      <span
        className="mt-0.5 block text-[11px] font-black uppercase tracking-[0.16em]"
        style={{ color: previewing ? AMBER : worn ? BONE : BONE_FAINT }}
      >
        {state}
      </span>
    </button>
  );
};

/** The stock figure with nothing on it — an empty hook. */
const EmptyHookFigure: React.FC = () => {
  const look = useMemo(
    () => resolveLookView({ playerId: '', username: null, headVariant: 'visor', parts: {} }),
    [],
  );
  return <HunterPortrait look={look} className="mx-auto h-[150px] max-w-[220px]" />;
};

/** A stock-head variant's small portrait piece. */
const VariantFigure: React.FC<{ variantId: string }> = ({ variantId }) => {
  const look = useMemo(
    () => resolveLookView({ playerId: '', username: null, headVariant: variantId, parts: {} }),
    [variantId],
  );
  return <HunterPortrait look={look} className="h-[110px]" />;
};

/** A Reserve piece: catalog art (the part on the stock frame),
 *  hung dimmed, with its real recipe cost line as the caption. */
const ReservePiece: React.FC<{ partId: string }> = ({ partId }) => {
  const def = skinPartCatalog(partId)!;
  const look = useMemo(
    () =>
      resolveLookView({
        playerId: '',
        username: null,
        headVariant: 'visor',
        parts: { [def.slot]: { partId: def.id, tintPaletteId: null, quality: 50 } },
      }),
    [def],
  );
  return (
    <div className="mx-auto mt-4 w-full max-w-[340px] px-4 text-center" style={{ opacity: 0.62 }}>
      <span
        className="block"
        style={{ border: `1px solid ${HAIRLINE}`, background: SPOTLIGHT }}
      >
        <HunterPortrait look={look} className="h-[150px]" />
      </span>
      <span className="mt-2 block text-[18px] leading-none tracking-wide" style={{ ...DISPLAY, color: BONE_MUTED }}>
        {def.name}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed" style={{ color: BONE_FAINT }}>
        {SLOT_LABELS[def.slot]} · {recipeCostLine(def.recipeId)}
      </span>
    </div>
  );
};
