/**
 * WardrobeLedgerPage — PROTOTYPE (design/hunter-subpages-wardrobe-e,
 * 2026-11-05). NOT shipped UI.
 *
 * Variant E — "Quiet plates". The Wardrobe as a ledger of record:
 * variant A's fitting stand (plinth, machined plate, gauge wells,
 * mount plates, stamps) is deleted entire. The figure stands large
 * on empty ground — no frame, no plinth — and the ten mounts rest
 * below as numbered ledger rows between hairlines, in the order the
 * body wears them. Type and space do the work; amber appears exactly
 * once in the design, on the word that says a preview is live.
 *
 * Content and state are variant A's, fact for fact: the same fixture
 * CosmeticsStateView shape (Rook Sandoval, level 24; 9 parts owned
 * across 6 mounts, 3 worn — the Bulwark set; one tint of each kind,
 * one market-locked part), the same real rig resolution
 * (resolveOwnLook + HunterPortrait), the same generated weapon, the
 * same head-variant pick with its worn-helm override, the same
 * craftable order book with real recipe cost lines, and the guest
 * lock presented at the action. Preview is a real state: tapping a
 * part re-renders the figure wearing it before anything is worn.
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

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
/** Secondary ink at body sizes (clears 4.5:1 on the page ground). */
const BONE_SOFT = '#B3A488';
/** Faint ink — short labels and state words only. */
const BONE_FAINT = '#9A8B72';
const HAIRLINE = 'rgba(245,239,230,0.09)';
const HAIRLINE_STRONG = 'rgba(245,239,230,0.22)';
/** The page's only accent: a preview is live. */
const AMBER = '#FF9000';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
  fontWeight: 400,
};

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

/* ── Fixture — variant A's, fact for fact. Shaped like the Chef's
 * CosmeticsStateView payload: Rook Sandoval, level 24; 9 parts owned
 * across 6 mounts, 3 worn; one part carries a tint of each kind shown,
 * one is market-locked. ─────────────────────────────────────────── */
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

/** The figure's weapon: a real generated instance (the same generator
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

const partLine = (p: CosmeticPartItemView): string => {
  const tint = p.tintPaletteId ? tintPaletteById(p.tintPaletteId) : undefined;
  return [
    `${FINISH_LABELS[finishTierForQuality(p.quality)]} finish · Q${p.quality}`,
    tint ? `${tint.name} tint` : null,
    skinSetById(p.setId)?.name ?? p.setId,
    p.runtimeState === 'locked' ? 'Locked' : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

/* ─── The page ─────────────────────────────────────────────────────── */

export interface WardrobeLedgerPageProps {
  /** Part DEFINITION id (e.g. 'dread-head') to open previewed. */
  initialPreviewPartId?: string;
  initialGuest?: boolean;
}

export const WardrobeLedgerPage: React.FC<WardrobeLedgerPageProps> = ({
  initialPreviewPartId,
  initialGuest = false,
}) => {
  const [selection, setSelection] = useState<CosmeticSelection>(FIXTURE_SELECTION);
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
  const headWorn = !!selection.equipped.head;

  const wornSetNames =
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
  const togglePreview = (part: CosmeticPartItemView) => {
    setPreviewId((cur) => (cur === part.id ? null : part.id));
  };

  return (
    <div data-testid="wardrobe-ledger">
      {/* ── Standing ─────────────────────────────────────────────── */}
      <h1 className="leading-none" style={{ ...display, fontSize: 54, color: BONE }}>
        Wardrobe
      </h1>
      <p className="mt-3 max-w-[36ch] text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        What the hunter wears. Every part is pure cosmetic — shape and finish only; nothing in this ledger moves a
        number in a fight.
      </p>

      <div className="mt-10 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 84, color: BONE }}>
          {wornCount}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          of {COSMETIC_SLOTS.length} mounts filled
        </span>
        <span className="ml-auto text-[12px]" style={{ color: BONE_MUTED }}>
          {FIXTURE_PARTS.length} parts owned
        </span>
      </div>

      {/* ── The figure — large, on empty ground ──────────────────── */}
      <div className="mt-6" data-testid="wardrobe-figure">
        <HunterPortrait look={look} weaponInput={FIXTURE_WEAPON_INPUT} className="h-[452px]" testId="wardrobe-ledger-portrait" />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3 pt-4" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        <span className="leading-tight" style={{ ...display, fontSize: 21, color: BONE }}>
          {previewPart ? previewPart.name : wornSetNames}
        </span>
        <span className="shrink-0 text-[12px]" style={{ color: BONE_FAINT }}>
          Rook Sandoval · Level 24
        </span>
      </div>
      {previewPart ? (
        <div data-testid="wardrobe-preview-bar">
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
            <span className="font-bold uppercase tracking-[0.14em]" style={{ color: AMBER }}>
              Previewing
            </span>{' '}
            — on the figure now, in place of the worn {SLOT_LABELS[previewPart.slot].toLowerCase()} part. Not worn
            until you say so.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={guest}
              onClick={() => wear(previewPart)}
              data-testid={`wear-${previewPart.id}`}
              className="min-h-[44px] flex-1 px-4 text-[12px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
              style={{ border: `1px solid ${BONE}`, color: BONE, backgroundColor: 'transparent' }}
            >
              Wear it
            </button>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="min-h-[44px] flex-1 px-4 text-[12px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60"
              style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE_MUTED, backgroundColor: 'transparent' }}
            >
              Put it back
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
          The worn set, as it stands. Tap any owned part below to see it on the figure first.
        </p>
      )}

      {/* ── The mounts — a numbered ledger ───────────────────────── */}
      <section className="mt-16">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="leading-none" style={{ ...display, fontSize: 26, color: BONE }}>
            The mounts
          </h2>
          <span className="text-[12px]" style={{ color: BONE_FAINT }}>
            {COSMETIC_SLOTS.length} mounts
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
          In the order the body wears them, head to back.
        </p>

        <div className="mt-4">
          {COSMETIC_SLOTS.map((slot, i) => {
            const wornId = selection.equipped[slot];
            const worn = wornId ? partsById.get(wornId) : undefined;
            const owned = ownedBySlot.get(slot) ?? [];
            const previewingHere = previewPart?.slot === slot;
            return (
              <div key={slot} className="py-6" style={{ borderTop: `1px solid ${HAIRLINE}` }} data-testid={`mount-${slot}`}>
                <div className="flex items-baseline gap-3">
                  <span className="w-7 shrink-0 leading-none" style={{ ...display, fontSize: 19, color: BONE_FAINT }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight" style={{ ...display, fontSize: 24, color: BONE }}>
                    {SLOT_LABELS[slot]}
                  </span>
                  <span
                    className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: previewingHere ? AMBER : worn ? BONE : BONE_FAINT }}
                  >
                    {previewingHere ? 'Previewing' : worn ? 'Worn' : owned.length > 0 ? `${owned.length} owned` : 'Empty'}
                  </span>
                </div>

                <div className="mt-2 pl-10">
                  {worn ? (
                    <>
                      <div className="text-[14px] font-semibold leading-snug" style={{ color: BONE }}>
                        {worn.name}
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug" style={{ color: BONE_FAINT }}>
                        {partLine(worn)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[14px] font-semibold leading-snug" style={{ color: BONE_MUTED }}>
                        Standard Issue
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug" style={{ color: BONE_FAINT }}>
                        {owned.length > 0 ? 'The bare mount — nothing worn here.' : 'Nothing owned for this mount.'}
                      </div>
                    </>
                  )}
                </div>

                {slot === 'head' && (
                  <div className="mt-4 pl-10">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
                      Base head — shown when no helm is worn
                    </div>
                    {headWorn && (
                      <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
                        A worn helm overrides the pick.
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-2" data-testid="wardrobe-variants">
                      {HUNTER_HEAD_VARIANTS.filter((v) => WEARABLE_VARIANTS.includes(v.id)).map((v) => {
                        const active = !headWorn && selection.headVariant === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={guest || headWorn}
                            onClick={() => setSelection((s) => ({ ...s, headVariant: v.id }))}
                            className="min-h-[44px] px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
                            style={{
                              border: `1px solid ${active ? BONE : HAIRLINE_STRONG}`,
                              color: active ? BONE : BONE_MUTED,
                              backgroundColor: active ? 'rgba(245,239,230,0.07)' : 'transparent',
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

                {owned.length > 0 && (
                  <div className="mt-2 pl-10">
                    {owned.map((p) => {
                      const isWorn = selection.equipped[p.slot] === p.id;
                      const isPreviewing = previewId === p.id;
                      return (
                        <div
                          key={p.id}
                          className="flex min-h-[56px] items-center gap-3 py-2"
                          style={{ borderTop: `1px solid ${HAIRLINE}` }}
                          data-testid={`ledger-part-${p.id}`}
                        >
                          <button
                            type="button"
                            disabled={guest || isWorn}
                            onClick={() => togglePreview(p)}
                            aria-pressed={isPreviewing}
                            className="min-h-[44px] min-w-0 flex-1 text-left transition-opacity active:opacity-60 disabled:opacity-100"
                          >
                            <span
                              className="block truncate text-[14px] font-semibold leading-snug"
                              style={{ color: isPreviewing ? AMBER : BONE }}
                            >
                              {p.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] leading-snug" style={{ color: BONE_FAINT }}>
                              {partLine(p)}
                            </span>
                          </button>
                          {isWorn ? (
                            <button
                              type="button"
                              disabled={guest}
                              onClick={() => remove(p.slot)}
                              className="min-h-[44px] shrink-0 px-3 text-[11px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60 disabled:opacity-40"
                              style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE_MUTED, backgroundColor: 'transparent' }}
                            >
                              Remove
                            </button>
                          ) : isPreviewing ? (
                            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: AMBER }}>
                              On figure
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
                              Preview
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {guest && (
        <div className="mt-4 flex items-center gap-2 text-[12px] font-semibold" style={{ color: AMBER }}>
          <PxIcon name="lock" size={14} />
          Sign in to craft and wear parts — browsing is free.
        </div>
      )}

      {/* ── The order book — what can still be made ──────────────── */}
      <section className="mt-16">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="leading-none" style={{ ...display, fontSize: 26, color: BONE }}>
            The order book
          </h2>
          <span className="text-[12px]" style={{ color: BONE_FAINT }}>
            Workshop · Parts lane
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
          Everything not yet owned, at its real crafting cost. A part made is a part hung above; unequipped parts can
          be listed on the market.
        </p>

        {SKIN_SETS.map((set) => {
          const rows = SKIN_PARTS.filter((p) => p.setId === set.id && !ownedPartIds.has(p.partId));
          if (rows.length === 0) return null;
          return (
            <div key={set.id} className="mt-8">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="leading-none" style={{ ...display, fontSize: 19, color: BONE }}>
                  {set.name}
                </h3>
                <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
                  {rows.length} to craft
                </span>
              </div>
              <div className="mt-2">
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 py-2"
                    style={{ borderTop: `1px solid ${HAIRLINE}` }}
                  >
                    <div className="min-w-0 truncate text-[13px] font-semibold" style={{ color: BONE_MUTED }}>
                      {p.name}
                      <span style={{ color: BONE_FAINT }}> · {SLOT_LABELS[p.slot]}</span>
                    </div>
                    <div className="shrink-0 text-[12px]" style={{ color: BONE_FAINT }}>
                      {recipeCostLine(p.recipeId)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <p className="mt-16 pb-8 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
        Parts are crafted with Scrap in the Workshop. A part changes the hunter&rsquo;s shape — never their stats.
      </p>
    </div>
  );
};
