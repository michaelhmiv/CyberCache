/**
 * DeathOverlay — contract test.
 *
 * This test exercises the real <DeathOverlay /> component against
 * the real `useSurvivalStore`, `usePlayerStore`, `useActivityStore`,
 * and `useKillCycleStore` slices. It does NOT use a browser — the
 * component is mounted in JSDOM and the slice actions are invoked
 * through `act()`.
 *
 * The PR 5 contract:
 *   1. When `isDead=false`, the overlay renders nothing.
 *   2. When `isDead=true`, the overlay appears with the monster
 *      name and area label, and offers three options: free, pay,
 *      token.
 *   3. Clicking "Pay credits" deducts credits, clears `isDead`,
 *      and refills HP via the slice's `resurrectPaid()` action.
 *   4. Clicking "Use token" decrements the player's ReviveToken
 *      count and clears `isDead` via `resurrectToken()`.
 *   5. The free-timer option is disabled when the timer is not
 *      ready (data-enabled=false) and enabled when the timer has
 *      elapsed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { DeathOverlay } from '@/components/action/DeathOverlay';
import {
  useSurvivalStore,
  usePlayerStore,
  useActivityStore,
  useKillCycleStore,
} from '@/store';
import { RESURRECTION_FREE_TIMER_MS } from '@/lib/combat/resurrectionCost';

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
    damageLog: [],
  });
  usePlayerStore.setState({
    credits: 1000,
    consumables: { MedKit: 5, ShieldCell: 2, ReviveToken: 1 },
  });
  useActivityStore.setState({
    current: { targetId: 'dustwaste_frontier', targetLabel: 'Dustwaste Frontier' },
  });
  useKillCycleStore.setState({});
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

  it('renders the overlay with monster name and area when isDead=true', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_elite',
      monsterName: 'Silt Marshal',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });

    render(<DeathOverlay />);

    const overlay = screen.getByTestId('death-overlay');
    expect(overlay.getAttribute('data-monster-id')).toBe('dustwaste_elite');
    expect(overlay.getAttribute('data-area-id')).toBe('dustwaste_frontier');
    expect(overlay.textContent).toContain('Silt Marshal');
    expect(overlay.textContent).toContain('Dustwaste Frontier');
    // Three options visible
    expect(screen.getByTestId('death-option-free')).toBeTruthy();
    expect(screen.getByTestId('death-option-pay')).toBeTruthy();
    expect(screen.getByTestId('death-option-token')).toBeTruthy();
  });

  it('free-timer option is disabled while the timer has not elapsed', () => {
    useSurvivalStore.getState().die({
      monsterId: 'm1',
      monsterName: 'Goblin',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    // resurrectionReadyAt is set to now+5min by die()
    expect(useSurvivalStore.getState().resurrectionReadyAt).toBeGreaterThan(Date.now());
    render(<DeathOverlay />);
    const freeBtn = screen.getByTestId('death-option-free');
    expect(freeBtn.getAttribute('data-enabled')).toBe('false');
    expect((freeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('free-timer option becomes enabled once the timer has elapsed', () => {
    useSurvivalStore.getState().die({
      monsterId: 'm1',
      monsterName: 'Goblin',
      areaId: 'dustwaste_frontier',
      at: Date.now() - RESURRECTION_FREE_TIMER_MS - 1000,
    });
    // Force the ready-at into the past to simulate elapsed timer
    useSurvivalStore.setState({ resurrectionReadyAt: Date.now() - 1000 });
    render(<DeathOverlay />);
    const freeBtn = screen.getByTestId('death-option-free');
    expect(freeBtn.getAttribute('data-enabled')).toBe('true');
    expect((freeBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking "Pay credits" deducts cost, refills HP, and clears isDead', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_elite',
      monsterName: 'Silt Marshal',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    const maxHp = useSurvivalStore.getState().maxHp;
    const creditsBefore = usePlayerStore.getState().credits;

    render(<DeathOverlay />);
    const payBtn = screen.getByTestId('death-option-pay');
    const cost = Number(payBtn.getAttribute('data-credit-cost'));
    expect(cost).toBeGreaterThan(0);
    fireEvent.click(payBtn);

    const after = useSurvivalStore.getState();
    expect(after.isDead).toBe(false);
    expect(after.currentHp).toBe(maxHp);
    expect(usePlayerStore.getState().credits).toBe(creditsBefore - cost);
  });

  it('clicking "Use token" decrements ReviveToken and clears isDead', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_elite',
      monsterName: 'Silt Marshal',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    const tokensBefore = usePlayerStore.getState().getConsumableCount('ReviveToken');
    expect(tokensBefore).toBeGreaterThan(0);

    render(<DeathOverlay />);
    const tokenBtn = screen.getByTestId('death-option-token');
    fireEvent.click(tokenBtn);

    expect(useSurvivalStore.getState().isDead).toBe(false);
    expect(usePlayerStore.getState().getConsumableCount('ReviveToken')).toBe(tokensBefore - 1);
  });

  it('records the death in the deathLog so ProfileScreen can show it', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_drone',
      monsterName: 'Silt Drone',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    const log = useSurvivalStore.getState().deathLog;
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].monsterId).toBe('dustwaste_drone');
    expect(log[0].monsterName).toBe('Silt Drone');
  });

  it('pay-credits button is disabled when credits < cost', () => {
    useSurvivalStore.getState().die({
      monsterId: 'm1',
      monsterName: 'Goblin',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    usePlayerStore.setState({ credits: 0 });
    render(<DeathOverlay />);
    const payBtn = screen.getByTestId('death-option-pay');
    expect(payBtn.getAttribute('data-enabled')).toBe('false');
    expect((payBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('token button is disabled when player has 0 tokens', () => {
    useSurvivalStore.getState().die({
      monsterId: 'm1',
      monsterName: 'Goblin',
      areaId: 'dustwaste_frontier',
      at: Date.now(),
    });
    usePlayerStore.setState({ consumables: { MedKit: 5, ShieldCell: 2, ReviveToken: 0 } });
    render(<DeathOverlay />);
    const tokenBtn = screen.getByTestId('death-option-token');
    expect(tokenBtn.getAttribute('data-enabled')).toBe('false');
    expect((tokenBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
