/**
 * HunterPickSheet — the starting-hunter pick (Cache Hunters
 * slice (e), brief §4(e)).
 *
 * The boot invitation for a new account: four hunter plates in
 * the Roster stop's own plate grammar (same shell, same sprite
 * seat, same labels — name, tree, base perk), so the choice a
 * player makes here reads identically to the roster they will
 * manage it from later. Tapping a plate FIELDS that hunter
 * through the one shared switch sequence (fieldHunter): the
 * pick and a roster switch are the same act, and the server
 * stamp it leaves (profiles.active_hunter_id) is what marks
 * the pick complete.
 *
 * Deferrable by design (audit G-F5's play-first ruling): the
 * "Not now" door closes the sheet and the account keeps playing
 * on the default hunter immediately — no wall, no form. The
 * pick resurfaces in place at the Roster stop; this sheet never
 * re-interrupts play on its own (the boot invitation's 24h
 * cadence lives in useHunterPick).
 *
 * Impeccable pass (UI work, named per the house rule): the
 * sheet reuses the shipped Arena Plates register wholesale —
 * clipped plate shells, bone/amber ink, tree-tinted foot
 * strips, the Roster stop's plate rhythm — and changes nothing
 * about the register itself; the only new composition is the
 * four-plate stack under one title inside the boot-sheet
 * overlay the hunter-name invitation established. Action
 * targets ≥44px, type floor 11px, labels and state words only
 * (the No-Paragraphs Law holds on this surface).
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HUNTERS, type HunterDef } from '@/lib/hunters/hunters';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { getPixelSprite, pixelHunterSpriteForHunter } from '@/lib/pixel/manifest';
import { fieldHunter } from '@/lib/hunters/fieldHunter';
import { useAuth } from '@/auth/AuthProvider';
import { Bolts, PlateFootStrip } from './HunterPlates';
import { AMBER, BONE, BONE_FAINT, BONE_MUTED, plateShell } from './hunterPlateTheme';

interface HunterPickSheetProps {
  /** The pick completed (a hunter was fielded). */
  onPicked: () => void;
  /** "Not now" — defer; the account plays on the default hunter. */
  onClose: () => void;
}

export const HunterPickSheet: React.FC<HunterPickSheetProps> = ({ onPicked, onClose }) => {
  const auth = useAuth();
  const [busyHunterId, setBusyHunterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (hunter: HunterDef) => {
    if (busyHunterId) return;
    setError(null);
    setBusyHunterId(hunter.id);
    try {
      await fieldHunter(hunter.id);
      // The refreshed account state carries the stamped pick —
      // that is what closes the invitation for good.
      await auth.refreshAccount();
      onPicked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hunter switch failed');
    } finally {
      setBusyHunterId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your hunter"
      data-testid="hunter-pick-sheet"
    >
      <div className="w-full max-w-md space-y-2">
        <div className="relative px-3.5 pb-3 pt-2.5" style={plateShell}>
          <Bolts />
          <div className="text-[17px] font-black uppercase tracking-wide" style={{ color: BONE }}>
            Choose your hunter
          </div>
          <div className="mt-0.5 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
            Shared arsenal · shared level · own tree, own loadout, own points
          </div>
        </div>

        {HUNTERS.map((hunter) => {
          const visual = getSkillTreeVisual(hunter.tree);
          const isBusy = busyHunterId === hunter.id;
          const spriteId = pixelHunterSpriteForHunter(hunter.id);
          const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
          return (
            <button
              key={hunter.id}
              type="button"
              data-testid={`hunter-pick-${hunter.id}`}
              onClick={() => void choose(hunter)}
              disabled={busyHunterId !== null}
              className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.99] disabled:opacity-100"
              style={plateShell}
            >
              <Bolts />
              <div className="relative flex items-center gap-3 px-3.5 pb-3.5 pt-2.5">
                {sprite && (
                  <img
                    src={sprite.url}
                    alt=""
                    aria-hidden="true"
                    className="h-[64px] w-auto shrink-0 select-none"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>
                    {hunter.name}
                  </span>
                  <div className="mt-0.5 text-[11px] font-black uppercase tracking-wide" style={{ color: visual.color }}>
                    {String(hunter.tree)} · {hunter.basePerkName}
                  </div>
                </div>
                <span
                  className="flex min-h-[44px] shrink-0 items-center gap-1 px-2 text-[11px] font-black uppercase tracking-wide"
                  style={{ color: busyHunterId ? BONE_FAINT : AMBER }}
                >
                  <PxIcon name="chevs" size={13} />
                  {isBusy ? 'Fielding…' : 'Field'}
                </span>
              </div>
              <PlateFootStrip color={visual.color} height={3} />
            </button>
          );
        })}

        {error && (
          <div role="alert" className="px-1 text-[11px] font-black uppercase text-red">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          data-testid="hunter-pick-not-now"
          className="min-h-[44px] w-full px-2 text-[12px] font-bold uppercase tracking-wide"
          style={{ color: BONE_MUTED }}
        >
          Not now
        </button>
      </div>
    </div>
  );
};
