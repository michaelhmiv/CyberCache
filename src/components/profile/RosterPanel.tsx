/**
 * RosterPanel — the Hunter tab's Roster stop (Cache Hunters
 * reshape, slice (b); brief check B2).
 *
 * Four plates, one per Cache Hunter: painting, name, tree, base
 * perk, and that hunter's own skill pool read as spent/unspent.
 * Tapping a plate fields that hunter through slice (a)'s server
 * switch (cc_set_active_hunter): the outgoing hunter's equipped
 * set is saved as their loadout assignment, the incoming hunter's
 * is equipped, and the action-skill selection collapses to the new
 * hunter's tree. The switch is optimistic locally, then the
 * returned profile snapshot is applied and the item set re-read —
 * the loadout changed server-side, so Gear must see the new truth.
 *
 * Guests see the same roster with the same real data (Guest
 * Visibility Law): the switch is not an economy transaction and
 * the server op carries no guest gate, so no lock lives here.
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { usePlayerStore, useSkillStore } from '@/store';
import { HUNTERS, hunterById, spendsForHunter, type HunterDef } from '@/lib/hunters/hunters';
import { skillSpendCost } from '@/lib/skills/skillBonuses';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { getPixelSprite, pixelHunterSpriteForHunter } from '@/lib/pixel/manifest';
import { newActionSkillNonce, setActiveHunter } from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { syncRuntimeItemsForUser } from '@/lib/api/runtimeStateService';
import { Bolts, PlateFootStrip } from './HunterPlates';
import { AMBER, BONE, BONE_FAINT, BONE_MUTED, STEEL, plateShell } from './hunterPlateTheme';

export const RosterPanel: React.FC<{ onOpenTrees: () => void }> = ({ onOpenTrees }) => {
  const player = usePlayerStore();
  const skillStore = useSkillStore();
  const [busyHunterId, setBusyHunterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pointsEarned = Math.max(0, player.level - 1);
  const activeHunter = hunterById(skillStore.activeHunterId);

  const switchHunter = async (hunter: HunterDef) => {
    if (busyHunterId || hunter.id === skillStore.activeHunterId) return;
    const previous = skillStore.activeHunterId;
    setError(null);
    setBusyHunterId(hunter.id);
    // Optimistic: the tab re-heads itself at once; the server
    // snapshot below is the authority and a failure rolls back.
    skillStore.setActiveHunter(hunter.id);
    try {
      const result = await setActiveHunter({
        nonce: newActionSkillNonce('hunter'),
        hunterId: hunter.id,
      });
      syncVerifiedResult({ profile: result.profile });
      await syncRuntimeItemsForUser('');
    } catch (err) {
      skillStore.setActiveHunter(previous);
      setError(err instanceof Error ? err.message : 'Hunter switch failed');
    } finally {
      setBusyHunterId(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="roster-panel">
      <div className="px-1 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
        Shared arsenal · shared level · own tree, own loadout, own points
      </div>
      {HUNTERS.map((hunter) => {
        const visual = getSkillTreeVisual(hunter.tree);
        const pool = spendsForHunter(skillStore.spent, hunter.id);
        const spentBudget = skillSpendCost(pool);
        const unspent = Math.max(0, pointsEarned - spentBudget);
        const isActive = hunter.id === skillStore.activeHunterId;
        const isBusy = busyHunterId === hunter.id;
        const spriteId = pixelHunterSpriteForHunter(hunter.id);
        const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
        return (
          <button
            key={hunter.id}
            type="button"
            data-testid={`roster-hunter-${hunter.id}`}
            onClick={() => void switchHunter(hunter)}
            disabled={isActive || busyHunterId !== null}
            className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.99] disabled:opacity-100"
            style={{
              ...plateShell,
              boxShadow: isActive
                ? `5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 2px ${AMBER}`
                : plateShell.boxShadow,
            }}
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>
                    {hunter.name}
                  </span>
                  {isActive && (
                    <span
                      data-testid="roster-fielded-chip"
                      className="px-1.5 py-0.5 text-[11px] font-black uppercase leading-none text-black"
                      style={{ backgroundColor: AMBER, border: '1.5px solid #000' }}
                    >
                      {isBusy ? 'Fielding…' : 'Fielded'}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] font-black uppercase tracking-wide" style={{ color: visual.color }}>
                  {String(hunter.tree)} · {hunter.basePerkName}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold" style={{ color: BONE_MUTED }}>
                  {spentBudget} spent · {unspent} unspent in pool
                </div>
              </div>
              {!isActive && (
                <span
                  className="flex min-h-[44px] shrink-0 items-center gap-1 px-2 text-[11px] font-black uppercase tracking-wide"
                  style={{ color: busyHunterId ? BONE_FAINT : AMBER }}
                >
                  <PxIcon name="chevs" size={13} />
                  {isBusy ? 'Fielding…' : 'Field'}
                </span>
              )}
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
        data-testid="roster-open-trees"
        onClick={onOpenTrees}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 px-3 text-[12px] font-black uppercase tracking-wide"
        style={{ color: AMBER, border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.7)' }}
      >
        <PxIcon name="nodes" size={14} />
        {activeHunter.name}&apos;s Skill Trees
      </button>
    </div>
  );
};
