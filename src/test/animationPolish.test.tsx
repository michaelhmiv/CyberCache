/**
 * Animation polish pass (DESIGN.md §10 — the mandate under
 * Sample B). Pins for this slice:
 *
 *  1. The Sample-B constitution itself: MOVEMENT's pacing values
 *     are the approved ones. If a future change retimes a loot
 *     beat or a fight phase, this test fails before the diff does
 *     any quiet damage — §10 makes those values the owner's
 *     tuning call, never a cleanup.
 *  2. The shared UI-motion helpers collapse under reduced motion
 *     (entrances render at rest; the stop transition is instant).
 *  3. ClaimPulse: pulses by default, holds a STATIC ring under
 *     reduced motion (MotionConfig reducedMotion="always" is
 *     framer's own switch for the same preference).
 *  4. The claimable surfaces this slice wired: the Standings
 *     door pill, the Weekly claim row button, and the contract
 *     Claim button carry the pulse exactly while a claim is live
 *     — and not for guests / not when nothing is claimable.
 *  5. The Market stop transition is wired (source pin, the
 *     codebase's pattern for shell chrome).
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MOVEMENT } from '@/lib/pixel/movement';
import { listEntranceProps, panelEntranceProps, stopTransitionProps } from '@/lib/animation/uiMotion';
import { ClaimPulse } from '@/components/common/ClaimPulse';
import { StandingsDoor } from '@/components/profile/StandingsDoor';
import { EMPTY_STANDINGS_BADGE, type StandingsBadge } from '@/components/profile/standingsBadge';
import { WeeklyClaimablesList } from '@/components/dashboard/WeeklyClaimables';
import { ContractsPanel } from '@/components/dashboard/ContractsPanel';
import { useStandingStore } from '@/store/slices/standingSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { buildStandingStateView, type StandingFacts } from '@/content/manufacturerStanding';
import type { ContractBoardView } from '@/content/contracts';
import type { ChefContractsResult } from '@/lib/chef/chefClient';
import { Manufacturer } from '@/types/game';

describe('Sample-B constitution — MOVEMENT values are the approved ones', () => {
  it('fight pacing: phase 1150, hit reaction 420, ghost drain 480', () => {
    expect(MOVEMENT.PHASE_INTERVAL_MS).toBe(1150);
    expect(MOVEMENT.HIT_REACTION_MS).toBe(420);
    expect(MOVEMENT.GHOST_HP_DRAIN_MS).toBe(480);
  });

  it('loot ladder: 900 / 1000 / 1100 / 1400 / 2600 with the legendary treatment intact', () => {
    expect(MOVEMENT.LOOT_COMMON_MS).toBe(900);
    expect(MOVEMENT.LOOT_UNCOMMON_MS).toBe(1000);
    expect(MOVEMENT.LOOT_RARE_MS).toBe(1100);
    expect(MOVEMENT.LOOT_EPIC_MS).toBe(1400);
    expect(MOVEMENT.LOOT_LEGENDARY_MS).toBe(2600);
    expect(MOVEMENT.LOOT_BEAM_IN_MS).toBe(420);
    expect(MOVEMENT.LOOT_CARD_IN_MS).toBe(380);
    expect(MOVEMENT.LOOT_RISE_MS).toBe(950);
    expect(MOVEMENT.LOOT_SHOCKWAVE_MS).toBe(900);
  });
});

describe('uiMotion helpers — reduced motion collapses UI motion', () => {
  it('stop transition: fade+rise normally, instant at rest under reduced motion', () => {
    const live = stopTransitionProps(false);
    expect(live.initial).toEqual({ opacity: 0, y: 6 });
    expect(live.transition.duration).toBe(0.18);
    const reduced = stopTransitionProps(true);
    expect(reduced.initial).toBe(false);
    expect(reduced.transition.duration).toBe(0);
    expect(reduced.exit).toBeUndefined();
  });

  it('list entrance: staggered with a capped delay; empty props under reduced motion', () => {
    expect(listEntranceProps(0, false).transition?.delay).toBe(0);
    expect(listEntranceProps(100, false).transition?.delay).toBe(0.24);
    expect(listEntranceProps(3, true)).toEqual({});
  });

  it('panel entrance: spring normally, initial=false under reduced motion', () => {
    expect(panelEntranceProps(false).transition?.type).toBe('spring');
    expect(panelEntranceProps(true)).toEqual({ initial: false });
  });
});

describe('ClaimPulse — pulses live, static ring under reduced motion', () => {
  it('renders the animated pulse by default', () => {
    render(<ClaimPulse color="#FF9000" testId="pulse-probe" />);
    const el = screen.getByTestId('pulse-probe');
    expect(el.getAttribute('data-static')).toBeNull();
  });

  it('renders the static ring when reduced motion is in force', () => {
    render(
      <MotionConfig reducedMotion="always">
        <ClaimPulse color="#FF9000" testId="pulse-probe-static" />
      </MotionConfig>,
    );
    const el = screen.getByTestId('pulse-probe-static');
    expect(el.getAttribute('data-static')).toBe('true');
  });
});

describe('StandingsDoor — the claimable pill pulses (§10)', () => {
  const badge: StandingsBadge = { claimableCount: 2, endsAt: null, endsSoon: false, buff: null };

  it('carries the pulse while rewards wait', () => {
    render(<StandingsDoor badge={badge} onOpen={() => {}} />);
    expect(screen.getByTestId('standings-claimable-pill')).toBeTruthy();
    expect(screen.getByTestId('standings-claim-pulse')).toBeTruthy();
  });

  it('no pill and no pulse when nothing is claimable', () => {
    render(<StandingsDoor badge={EMPTY_STANDINGS_BADGE} onOpen={() => {}} />);
    expect(screen.queryByTestId('standings-claimable-pill')).toBeNull();
    expect(screen.queryByTestId('standings-claim-pulse')).toBeNull();
  });
});

/** Redline at rank 5, verified: both weekly offers claimable. */
function standingFacts(overrides: Partial<StandingFacts> = {}): StandingFacts {
  return {
    accountType: 'verified',
    canUsePlayerEconomy: true,
    credits: 500_000,
    playerLevel: 25,
    rows: [{ manufacturer: Manufacturer.Redline, standing: 20_000, rank: 5 }],
    weeklyPurchases: [],
    ...overrides,
  };
}

describe('WeeklyClaimables — the claim button pulses only for a live claim', () => {
  it('verified hunter with a waiting crate: pulse present', () => {
    useStandingStore.setState({
      view: buildStandingStateView(standingFacts()),
      busyKey: null,
      flash: null,
    });
    const { container } = render(<WeeklyClaimablesList />);
    expect(screen.getByTestId('weekly-claimable-crate:Redline')).toBeTruthy();
    expect(container.querySelectorAll('.claim-pulse').length).toBeGreaterThan(0);
  });

  it('guest: offers visible, lock shown, no pulse', () => {
    useStandingStore.setState({
      view: buildStandingStateView(standingFacts({ accountType: 'guest', canUsePlayerEconomy: false })),
      busyKey: null,
      flash: null,
    });
    const { container } = render(<WeeklyClaimablesList />);
    expect(screen.getByTestId('weekly-claimable-crate:Redline')).toBeTruthy();
    expect(container.querySelectorAll('.claim-pulse').length).toBe(0);
  });
});

describe('ContractsPanel — a completed contract’s Claim button pulses', () => {
  const board: ContractBoardView = {
    canClaim: true,
    daily: {
      periodKind: 'daily',
      periodKey: '2026-11-02',
      band: 'B1',
      claimedCount: 0,
      setSize: 1,
      setBonus: { credits: 0, fragments: 0, cacheKeys: 0, earned: false },
      setBonusLine: '',
      freeRerollAvailable: false,
      rerollCostScrap: 25,
      contracts: [
        {
          id: 'c-1',
          slot: 0,
          templateId: 't-1',
          title: 'Breakdown: salvage 1 item',
          family: 'meta',
          target: 1,
          progress: 1,
          complete: true,
          status: 'active',
          reward: { credits: 100, fragments: 0 },
          progressLine: 'Salvages 1 / 1 — pays 100 cr',
          claimByLabel: 'claim by 00:00 UTC',
        },
      ],
    },
    weekly: {
      periodKind: 'weekly',
      periodKey: '2026-W45',
      band: 'B1',
      claimedCount: 0,
      setSize: 0,
      setBonus: { credits: 0, fragments: 0, cacheKeys: 0, earned: false },
      setBonusLine: '',
      freeRerollAvailable: false,
      rerollCostScrap: 25,
      contracts: [],
    },
  };

  it('renders the claim pulse on the live Claim button', () => {
    useContractsStore.setState({
      result: { verified: true, contracts: board, profile: null } as ChefContractsResult,
      loadState: 'ready',
    });
    render(<ContractsPanel />);
    expect(screen.getByTestId('contract-claim-pulse')).toBeTruthy();
  });
});

describe('Market stop transition — wired to the shared stop pattern', () => {
  it('MarketScreen wraps its stops in the AnimatePresence stop transition', () => {
    const source = readFileSync(join(__dirname, '..', 'screens', 'MarketScreen.tsx'), 'utf8');
    expect(source).toContain('stopTransitionProps(reduceMotion)');
    expect(source).toContain('key={market.activeTab}');
    expect(source).toContain('listEntranceProps(index, reduceMotion)');
  });
});
