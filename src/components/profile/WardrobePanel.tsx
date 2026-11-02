/**
 * WardrobePanel (skins slice, 0053) — the Hunter tab's showcase +
 * wardrobe. The player's own hunter stands on the showcase stage
 * wearing the parts the server selection record says he wears
 * (with his actual equipped weapon + mounted gear, like Home).
 * Below: the head-variant pick (free variants + Standing-earned
 * manufacturer heads, grandfathered server-side), the owned parts
 * by slot with equip on tap, and the full craftable catalog —
 * visible to everyone, guests included (guest-visibility law);
 * wearing is a server op, so guests get the sign-in line at the
 * action instead of a hidden panel.
 *
 * Pure render + intent: equip/unequip/head-variant go through the
 * cosmetics store to the Chef; the panel never decides ownership.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MobileCard } from '@/components/layout/MobileCard';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { useAuth } from '@/auth/AuthProvider';
import { useCosmeticsStore, useOwnLook } from '@/store/slices/cosmeticsSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { HUNTER_HEAD_VARIANTS } from '@/lib/pixel/headParts';
import {
  COSMETIC_SLOTS,
  FINISH_LABELS,
  SKIN_PARTS,
  finishTierForQuality,
  skinSetById,
  tintPaletteById,
  type CosmeticSlot,
} from '@/content/skins';
import { getCraftRecipe } from '@/content/crafting';

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

function recipeCostLine(recipeId: string): string {
  const recipe = getCraftRecipe(recipeId);
  if (!recipe) return 'Craft in the Workshop';
  const inputs = Object.entries(recipe.inputs)
    .map(([key, qty]) => `${qty.toLocaleString('en-US')} ${key === 'Scrap' ? 'Scrap' : key}`)
    .join(' + ');
  return `${inputs} · ${recipe.durationMinutes} min · Bench ${recipe.requiredBenchLevel}`;
}

export const WardrobePanel: React.FC = () => {
  const { account } = useAuth();
  const view = useCosmeticsStore((s) => s.view);
  const loadState = useCosmeticsStore((s) => s.loadState);
  const load = useCosmeticsStore((s) => s.load);
  const equip = useCosmeticsStore((s) => s.equip);
  const unequip = useCosmeticsStore((s) => s.unequip);
  const setHeadVariant = useCosmeticsStore((s) => s.setHeadVariant);
  const look = useOwnLook();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primaryWeapon = useLoadoutStore((s) => s.getWeapon('primary'));
  const weaponInput = primaryWeapon ? pixelWeaponInputFromWeapon(primaryWeapon) : undefined;

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <MobileCard className="space-y-3" rarityColor="#B07CFF">
      <div className="flex items-center gap-2">
        <PxIcon name="person" size={17} className="text-purple" />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Wardrobe</div>
        <div className="ml-auto text-[11px] text-text-muted">Pure cosmetic — zero stats</div>
      </div>

      {/* Showcase: the player's own hunter wearing his look. */}
      <div className="border-2 border-border bg-bg" data-testid="wardrobe-showcase">
        <HunterPortrait
          look={look}
          weaponInput={weaponInput}
          className="h-72"
          testId="wardrobe-showcase-portrait"
        />
      </div>
      {error && (
        <div className="border border-red/50 bg-red/10 px-2 py-1 text-[11px] font-bold text-text-primary" role="alert">
          {error}
        </div>
      )}

      {/* Head variants — the pick applies when no head part is worn. */}
      <div className="space-y-1">
        <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">
          Head {headPartEquipped && <span className="normal-case text-amber">(a worn head part overrides the pick)</span>}
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1" data-testid="wardrobe-head-variants">
          {HUNTER_HEAD_VARIANTS.filter((v) => (view?.wearableVariantIds ?? ['visor', 'optic', 'hood', 'fin']).includes(v.id)).map((v) => {
            const active = !headPartEquipped && view?.selection.headVariant === v.id;
            return (
              <button
                key={v.id}
                type="button"
                disabled={isGuest || busy !== null}
                onClick={() => void run(`variant:${v.id}`, () => setHeadVariant(v.id))}
                className={`shrink-0 border-2 px-2 py-1 text-[11px] font-bold ${
                  active
                    ? 'border-amber bg-amber/15 text-text-primary'
                    : 'border-border bg-panel text-text-secondary'
                } disabled:opacity-50`}
                data-testid={`wardrobe-variant-${v.id}`}
              >
                {v.label}
                {v.standingManufacturer ? ' · Standing' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Owned parts by slot. */}
      <div className="space-y-2" data-testid="wardrobe-owned">
        {COSMETIC_SLOTS.map((slot) => {
          const owned = ownedBySlot.get(slot) ?? [];
          const wornId = equipped[slot];
          return (
            <div key={slot} className="flex items-start gap-2">
              <div className="w-24 shrink-0 pt-1 text-[11px] font-black uppercase tracking-wide text-text-muted">
                {SLOT_LABELS[slot]}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {owned.length === 0 ? (
                  <div className="py-0.5 text-[11px] text-text-muted">Nothing owned</div>
                ) : (
                  owned.map((p) => {
                    const worn = wornId === p.id;
                    const finish = FINISH_LABELS[finishTierForQuality(p.quality)];
                    const tint = tintPaletteById(p.tintPaletteId);
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-2 border-2 px-2 py-1 ${
                          worn ? 'border-amber bg-amber/10' : 'border-border bg-panel'
                        }`}
                        data-testid={`wardrobe-part-${p.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-bold text-text-primary">{p.name}</div>
                          <div className="text-[11px] text-text-muted">
                            {finish} · {`Q${p.quality}`}
                            {tint ? ` · ${tint.name} tint` : ''}
                            {p.runtimeState === 'locked' ? ' · Locked' : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isGuest || busy !== null}
                          onClick={() =>
                            void run(`part:${p.id}`, () => (worn ? unequip(slot) : equip(p.id)))
                          }
                          className="shrink-0 border-2 border-border bg-bg px-2 py-1 text-[11px] font-black uppercase text-text-primary disabled:opacity-50"
                        >
                          {busy === `part:${p.id}` ? '…' : worn ? 'Remove' : 'Wear'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The full craftable catalog — visible to everyone. */}
      <div className="space-y-1" data-testid="wardrobe-catalog">
        <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">
          Craftable parts — Workshop, Parts lane
        </div>
        {SKIN_PARTS.filter((p) => !ownedPartIds.has(p.id)).map((p) => (
          <div key={p.id} className="flex items-center gap-2 border border-border/60 px-2 py-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-bold text-text-secondary">
                {p.name}
                <span className="text-text-muted">
                  {' '}· {skinSetById(p.setId)?.name ?? p.setId} · {SLOT_LABELS[p.slot]}
                </span>
              </div>
              <div className="truncate text-[11px] text-text-muted">{recipeCostLine(p.recipeId)}</div>
            </div>
          </div>
        ))}
        {SKIN_PARTS.every((p) => ownedPartIds.has(p.id)) && (
          <div className="text-[11px] text-text-muted">Full catalog owned. Flex responsibly.</div>
        )}
      </div>

      {isGuest ? (
        <div className="text-[11px] font-bold text-amber" data-testid="wardrobe-guest-note">
          Sign in to craft and wear parts — browsing is free.
        </div>
      ) : loadState === 'error' ? (
        <div className="text-[11px] text-text-muted">Wardrobe unreachable right now — your saved look still applies.</div>
      ) : null}
    </MobileCard>
  );
};
