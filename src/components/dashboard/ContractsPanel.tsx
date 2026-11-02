import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  claimContract,
  newContractNonce,
  rerollContract,
  type ChefContractsResult,
} from '@/lib/chef/chefClient';
import type { ContractInstanceView, ContractSetView } from '@/content/contracts';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { useContractsStore } from '@/store/slices/contractsSlice';

const CONTRACTS_ACCENT = '#E8B33D';

/**
 * Contracts board panel — the rotating work orders (0042;
 * pop-up body since the 2026-11-01 Dashboard top redesign).
 *
 * The board lives in the shared contracts store now: the
 * Dashboard's contracts ICON performs the mount read
 * (GET /api/contracts/me) that issues both sets server-side on
 * first read (seeded — daily global per band, weekly per
 * player), and this panel renders the store's board — mounting
 * here still triggers the load when nothing has loaded yet.
 * Claim and reroll send intent only (nonce + instance id); the
 * Chef re-evaluates, pays, and redraws — this panel renders the
 * returned board (written back through the store, so the
 * icon's claimable badge updates with the panel) and syncs the
 * returned profile snapshot. It computes no progress, no
 * target, and no reward. Renders nothing until the Chef
 * answers, so an unreachable Chef simply omits the panel;
 * failed ops surface their refusal in the flash strip.
 */
export const ContractsPanel: React.FC = () => {
  const result = useContractsStore((s) => s.result);
  const loadBoard = useContractsStore((s) => s.load);
  const applyBoard = useContractsStore((s) => s.applyResult);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const applyResult = useCallback((next: ChefContractsResult) => {
    applyBoard(next);
    if (next.profile) {
      syncVerifiedResult(next as unknown as Record<string, unknown>);
    }
  }, [applyBoard]);

  const onClaim = useCallback(async (contract: ContractInstanceView) => {
    setBusyId(contract.id);
    setFlash(null);
    try {
      const next = await claimContract({ nonce: newContractNonce('claim'), instanceId: contract.id });
      const parts: string[] = [];
      if (next.claimed.creditsAwarded > 0) parts.push(`+${next.claimed.creditsAwarded} cr`);
      if (next.claimed.fragmentsAwarded > 0) {
        parts.push(`+${next.claimed.fragmentsAwarded} fragment${next.claimed.fragmentsAwarded === 1 ? '' : 's'}`);
      }
      let text = parts.length > 0 ? `Claimed: ${parts.join(' + ')}` : 'Claimed';
      if (next.claimed.setBonus) {
        const bonus: string[] = [];
        if (next.claimed.setBonus.credits > 0) bonus.push(`+${next.claimed.setBonus.credits} cr`);
        if (next.claimed.setBonus.fragments > 0) bonus.push(`+${next.claimed.setBonus.fragments} fragments`);
        if (next.claimed.setBonus.cache_keys > 0) bonus.push('+1 cache key');
        text += ` · Full set bonus: ${bonus.join(' + ')}`;
      }
      setFlash({ text, error: false });
      applyResult(next);
    } catch (err) {
      setFlash({ text: err instanceof Error ? err.message : 'Claim failed', error: true });
    } finally {
      setBusyId(null);
    }
  }, [applyResult]);

  const onReroll = useCallback(async (contract: ContractInstanceView) => {
    setBusyId(contract.id);
    setFlash(null);
    try {
      const next = await rerollContract({ nonce: newContractNonce('reroll'), instanceId: contract.id });
      setFlash({
        text: next.rerolled.freeReroll
          ? 'Rerolled — free. New contract posted.'
          : `Rerolled — ${next.rerolled.scrapCharged} scrap spent. New contract posted.`,
        error: false,
      });
      applyResult(next);
    } catch (err) {
      setFlash({ text: err instanceof Error ? err.message : 'Reroll failed', error: true });
    } finally {
      setBusyId(null);
    }
  }, [applyResult]);

  if (!result) return null;
  const board = result.contracts;

  const renderContract = (contract: ContractInstanceView, set: ContractSetView) => {
    const pct = contract.target > 0
      ? Math.min(100, Math.round((contract.progress / contract.target) * 100))
      : 0;
    const busy = busyId === contract.id;
    return (
      <div key={contract.id} className="rounded px-2 py-2" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-black text-text-primary">{contract.title}</div>
          {contract.status === 'claimed' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase" style={{ color: CONTRACTS_ACCENT }}>Claimed <PxIcon name="check" size={13} /></span>
          )}
          {contract.status === 'expired' && (
            <span className="text-[10px] font-black uppercase text-text-muted">Expired</span>
          )}
        </div>
        <div
          className="mt-1.5 h-2 rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
          role="progressbar"
          aria-valuenow={contract.progress}
          aria-valuemax={contract.target}
          aria-label={contract.progressLine}
        >
          <div
            className="h-2 rounded-full"
            style={{
              width: `${pct}%`,
              backgroundColor: contract.complete ? CONTRACTS_ACCENT : 'rgba(232,179,61,0.55)',
            }}
          />
        </div>
        <div className="mt-1 text-[10px] font-bold text-text-muted">{contract.progressLine}</div>
        {contract.status === 'active' && (
          <div className="mt-1 flex flex-wrap gap-2">
            {contract.complete && (
              board.canClaim ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onClaim(contract)}
                  className="min-h-[44px] rounded px-3 text-xs font-black uppercase disabled:opacity-50"
                  style={{ backgroundColor: CONTRACTS_ACCENT, color: '#1A1206' }}
                >
                  {busy ? 'Claiming…' : 'Claim'}
                </button>
              ) : (
                <div className="flex min-h-[44px] items-center text-[11px] font-bold text-text-muted">
                  <span className="inline-flex items-center gap-1"><PxIcon name="lock" size={13} /> Sign in with Google to claim</span>
                </div>
              )
            )}
            {!contract.complete && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onReroll(contract)}
                className="min-h-[44px] rounded px-3 text-[11px] font-black uppercase disabled:opacity-50"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#D1D5DB' }}
              >
                {busy
                  ? 'Rerolling…'
                  : set.freeRerollAvailable
                    ? 'Reroll — free'
                    : `Reroll — ${set.rerollCostScrap} scrap`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSetBonus = (set: ContractSetView) => (
    <div className="flex items-center justify-between text-[11px] font-bold">
      <span style={{ color: set.setBonus.earned ? CONTRACTS_ACCENT : undefined }} className={set.setBonus.earned ? '' : 'text-text-muted'}>
        {set.setBonusLine}
        {set.setBonus.earned ? <span className="inline-flex items-center gap-1"> — earned <PxIcon name="check" size={13} /></span> : ` (${set.claimedCount}/${set.setSize} claimed)`}
      </span>
    </div>
  );

  return (
    <MobileCard className="space-y-3" rarityColor={CONTRACTS_ACCENT} glow={board.daily.contracts.some((c) => c.complete && c.status === 'active')}>
      <div className="flex items-center gap-2">
        <PxIcon name="orders" size={17} />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Contracts</div>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-black"
          style={{ backgroundColor: `${CONTRACTS_ACCENT}22`, color: CONTRACTS_ACCENT }}
        >
          Band {board.daily.band}
        </span>
        <div className="ml-auto text-[10px] font-bold uppercase text-text-muted">New board 00:00 UTC</div>
      </div>

      {flash && (
        <div
          className="rounded px-2 py-1.5 text-[11px] font-bold"
          style={flash.error
            ? { backgroundColor: 'rgba(220,60,60,0.15)', color: '#F87171' }
            : { backgroundColor: `${CONTRACTS_ACCENT}22`, color: CONTRACTS_ACCENT }}
          role={flash.error ? 'alert' : undefined}
        >
          {flash.text}
        </div>
      )}

      <div className="space-y-2">
        {board.daily.contracts.map((contract) => renderContract(contract, board.daily))}
      </div>
      {renderSetBonus(board.daily)}

      <button
        type="button"
        onClick={() => setWeeklyOpen((open) => !open)}
        className="flex min-h-[44px] w-full items-center justify-between rounded px-2 text-left"
        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
        aria-expanded={weeklyOpen}
      >
        <span className="text-xs font-black uppercase tracking-wide text-text-primary">
          Weekly contracts
        </span>
        <span className="text-[11px] font-bold text-text-muted">
          {board.weekly.claimedCount}/{board.weekly.setSize} claimed <PxIcon name={weeklyOpen ? 'chevU' : 'chevD'} size={13} />
        </span>
      </button>
      {weeklyOpen && (
        <>
          <div className="space-y-2">
            {board.weekly.contracts.map((contract) => renderContract(contract, board.weekly))}
          </div>
          {renderSetBonus(board.weekly)}
        </>
      )}

      {!board.canClaim && (
        <div className="text-[10px] text-text-muted">
          Guest board — progress counts now, rewards unlock when you link Google sign-in.
        </div>
      )}
    </MobileCard>
  );
};
