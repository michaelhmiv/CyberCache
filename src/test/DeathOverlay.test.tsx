/**
 * DeathOverlay — contract test (Phase 0 Slice 4 rewrite).
 *
 * Exercises the real <DeathOverlay /> against the real survival /
 * player / activity / kill-cycle slices, with the Chef client mocked
 * (the bossEncounterFlow pattern). The contract:
 *
 *   1. When `isDead=false`, the overlay renders nothing.
 *   2. When `isDead=true`, the overlay appears with the monster name
 *      and area label, and offers exactly TWO options: free and pay.
 *      There is NO revive-token option — the item never existed.
 *   3. Clicking "Pay credits" calls the Chef resurrect op with
 *      method 'paid' and a nonce; the credit balance afterwards is
 *      whatever the SERVER's returned profile says (the component
 *      deducts nothing locally).
 *   4. Clicking "Free recovery" (timer elapsed) calls the op with
 *      method 'free' and clears `isDead` on success.
 *   5. A rejected op leaves the hunter dead and shows the error.
 *   6. The free option is disabled until the (server-anchored)
 *      timer elapses; pay is disabled when the balance can't cover
 *      the displayed cost.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';

vi.mock('@/lib/chef/chefClient', () => ({
  resurrectViaChef: vi.fn(),
  newResurrectNonce: () => 'resurrect:test-nonce-1234',
  submitClaim: vi.fn(() => new Promise(() => {})),
  verifyBossFight: vi.fn(),
  salvageItem: vi.fn(),
}));

import { DeathOverlay } from '@/components/action/DeathOverlay';
import {
  useSurvivalStore,
  usePlayerStore,
  useActivityStore,
  useKillCycleStore,
} from '@/store';
import { RESURRECTION_FREE_TIMER_MS, resurrectionCostForArea } from '@/lib/combat/resurrectionCost';
import { resurrectViaChef, type ChefResurrectResult } from '@/lib/chef/chefClient';

const mockResurrect = vi.mocked(resurrectViaChef);
const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const DEATH = {
  monsterId: 'dustwaste_elite',
  monsterName: 'Silt Marshal',
  areaId: 'dustwaste_frontier',
  at: Date.now(),
};

function chefResult(method: 'free' | 'paid', creditsAfter: number): ChefResurrectResult {
  return {
    resurrected: true,
    verified: true,
    method,
    creditsCharged: method === 'paid' ? 1000 - creditsAfter : 0,
    death: { monsterId: DEATH.monsterId, monsterName: DEATH.monsterName, areaId: DEATH.areaId, at: DEATH.at },
    deathLog: [{ monsterId: DEATH.monsterId, monsterName: DEATH.monsterName, areaId: DEATH.areaId, at: DEATH.at }],
    profile: { id: PLAYER_ID, credits: creditsAfter },
  };
}

// Reset every relevant store to a known baseline before each test.
function resetStores() {
  useSurvivalStore.setState({
    isDead: false,
    currentHp: 500,
    maxHp: 500,
    shieldHp: 0,
    autoEatThreshold: 0.4,
    deathLog: [],
    lastKilledBy: null,
    resurrectionStartedAt: 0,
    resurrectionReadyAt: 0,
  });
  usePlayerStore.setState({
    id: PLAYER_ID,
    credits: 1000,
    consumables: { MedKit: 5, ShieldCell: 2 },
  });
  useActivityStore.setState({
    current: { targetId: 'dustwaste_frontier', targetLabel: 'Dustwaste Frontier' },
  });
  useKillCycleStore.setState({});
  mockResurrect.mockReset();
}

describe('DeathOverlay — contract', () => {
  beforeEach(() => {
    resetStores();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isDead=false', () => {
    const { container } = render(<DeathOverlay />);
    expect(container.querySelector('[data-testid="death-overlay"]')).toBeNull();
  });

  it('renders the overlay with monster name and area when isDead=true — and NO token option', () => {
    useSurvivalStore.getState().die({ ...DEATH });

    render(<DeathOverlay />);

    const overlay = screen.getByTestId('death-overlay');
    expect(overlay.getAttribute('data-monster-id')).toBe('dustwaste_elite');
    expect(overlay.getAttribute('data-area-id')).toBe('dustwaste_frontier');
    expect(overlay.textContent).toContain('Silt Marshal');
    expect(overlay.textContent).toContain('Dustwaste Frontier');
    // Exactly two options — the revive-token fiction is gone.
    expect(screen.getByTestId('death-option-free')).toBeTruthy();
    expect(screen.getByTestId('death-option-pay')).toBeTruthy();
    expect(screen.queryByTestId('death-option-token')).toBeNull();
    expect(overlay.textContent).not.toContain('Revive Token');
  });

  it('free-timer option is disabled while the timer has not elapsed', () => {
    const at = Date.now();
    useSurvivalStore.getState().die({ ...DEATH, at });
    // resurrectionReadyAt is anchored by die() to at + 5 min.
    expect(useSurvivalStore.getState().resurrectionReadyAt).toBe(at + RESURRECTION_FREE_TIMER_MS);
    render(<DeathOverlay />);
    const freeBtn = screen.getByTestId('death-option-free');
    expect(freeBtn.getAttribute('data-enabled')).toBe('false');
    expect((freeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('free-timer option becomes enabled once the timer has elapsed', () => {
    useSurvivalStore.getState().die({ ...DEATH, at: Date.now() - RESURRECTION_FREE_TIMER_MS - 1000 });
    render(<DeathOverlay />);
    const freeBtn = screen.getByTestId('death-option-free');
    expect(freeBtn.getAttribute('data-enabled')).toBe('true');
    expect((freeBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking "Pay credits" calls the Chef op and syncs the SERVER-charged balance', async () => {
    useSurvivalStore.getState().die({ ...DEATH });
    const maxHp = useSurvivalStore.getState().maxHp;
    const cost = resurrectionCostForArea('dustwaste_frontier');
    // The server reports 850 — NOT the local 1000 - cost (900). If the
    // component still deducted locally, the balance would read 900.
    mockResurrect.mockResolvedValue(chefResult('paid', 850));

    render(<DeathOverlay />);
    const payBtn = screen.getByTestId('death-option-pay');
    expect(Number(payBtn.getAttribute('data-credit-cost'))).toBe(cost);
    fireEvent.click(payBtn);

    await waitFor(() => expect(useSurvivalStore.getState().isDead).toBe(false));
    expect(mockResurrect).toHaveBeenCalledTimes(1);
    const request = mockResurrect.mock.calls[0][0];
    expect(request.method).toBe('paid');
    expect(request.playerId).toBe(PLAYER_ID);
    expect(request.nonce).toBe('resurrect:test-nonce-1234');
    const after = useSurvivalStore.getState();
    expect(after.currentHp).toBe(maxHp);
    expect(usePlayerStore.getState().credits).toBe(850);
  });

  it('clicking "Free recovery" calls the Chef op with method free and clears isDead', async () => {
    useSurvivalStore.getState().die({ ...DEATH, at: Date.now() - RESURRECTION_FREE_TIMER_MS - 1000 });
    mockResurrect.mockResolvedValue(chefResult('free', 1000));

    render(<DeathOverlay />);
    fireEvent.click(screen.getByTestId('death-option-free'));

    await waitFor(() => expect(useSurvivalStore.getState().isDead).toBe(false));
    expect(mockResurrect).toHaveBeenCalledTimes(1);
    expect(mockResurrect.mock.calls[0][0].method).toBe('free');
    expect(usePlayerStore.getState().credits).toBe(1000);
  });

  it('a rejected op leaves the hunter dead and surfaces the error', async () => {
    useSurvivalStore.getState().die({ ...DEATH });
    mockResurrect.mockRejectedValue(new Error('Chef resurrection failed (400): Free recovery is not ready yet'));

    render(<DeathOverlay />);
    fireEvent.click(screen.getByTestId('death-option-pay'));

    await waitFor(() => expect(screen.getByTestId('death-error')).toBeTruthy());
    expect(screen.getByTestId('death-error').textContent).toContain('not ready yet');
    expect(useSurvivalStore.getState().isDead).toBe(true);
    expect(usePlayerStore.getState().credits).toBe(1000);
  });

  it('records the death in the deathLog so ProfileScreen can show it', () => {
    useSurvivalStore.getState().die({ ...DEATH, monsterId: 'dustwaste_drone', monsterName: 'Silt Drone' });
    const log = useSurvivalStore.getState().deathLog;
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].monsterId).toBe('dustwaste_drone');
    expect(log[0].monsterName).toBe('Silt Drone');
  });

  it('pay-credits button is disabled when credits < cost', () => {
    useSurvivalStore.getState().die({ ...DEATH });
    usePlayerStore.setState({ credits: 0 });
    render(<DeathOverlay />);
    const payBtn = screen.getByTestId('death-option-pay');
    expect(payBtn.getAttribute('data-enabled')).toBe('false');
    expect((payBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
