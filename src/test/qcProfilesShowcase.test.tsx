/**
 * Profiles slice (0058) — the client surfaces.
 *
 * The laws under test:
 *  - The redesigned pop-up shows the hunter's shelf with its
 *    PINNED chips, keeps every stat group the old pop-up carried,
 *    and its primary action is the door to the full profile.
 *  - The full profile sheet renders the stage, the shelf, and the
 *    complete public record — read-only.
 *  - The Trophy Shelf's pin controls drive the real write: unpin
 *    sends the list without the item, pin appends, the picker
 *    offers owned weapons, and a server refusal surfaces in place
 *    (every "no" carries its reason).
 *
 * The weapon compositor is stubbed: these tests pin the surfaces'
 * structure and wiring; the sprite itself is the compositor's own
 * test surface.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/pixelArt/PixelWeapon', () => ({
  PixelWeapon: () => <div data-testid="pixel-weapon-stub" />,
}));

const api = vi.hoisted(() => ({
  fetchProfileLifetime: vi.fn(),
  setShowcasePins: vi.fn(),
}));
vi.mock('@/lib/api/verifiedOps', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/verifiedOps')>();
  return { ...original, fetchProfileLifetime: api.fetchProfileLifetime, setShowcasePins: api.setShowcasePins };
});

import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';
import { PlayerProfileSheet } from '@/components/profile/PlayerProfileSheet';
import { TrophyShelfPanel } from '@/components/profile/TrophyShelfPanel';
import { useInventoryStore } from '@/store';
import type { PlayerPublicProfile } from '@/lib/api/publicProfileService';
import type { ProfileLifetimePayload, ShowcaseItemPayload } from '@/lib/api/verifiedOps';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useInventoryStore.setState({ items: [] });
});

const weaponItem = (over: Partial<ShowcaseItemPayload> & { id: string }): ShowcaseItemPayload => ({
  item_level: 40,
  rarity: 'Legendary',
  is_locked: false,
  runtime_state: 'available',
  equipped_slot: null,
  created_at: '2026-10-05T00:00:00.000Z',
  payload: {
    name: 'Thunder Receipt',
    weaponType: 'Sniper',
    manufacturer: 'Prismatek',
    element: 'Shock',
    rarity: 'Legendary',
    pixelSeed: 42,
    rollQuality: 91,
  },
  ...over,
});

const PINNED = weaponItem({ id: 'w-pinned' });
const RANKED = weaponItem({
  id: 'w-ranked',
  rarity: 'Epic',
  item_level: 60,
  payload: { name: 'Dustline Verse', weaponType: 'Rifle', rarity: 'Epic', pixelSeed: 7 },
});

const publicProfile = {
  player_id: '22222222-2222-4222-8222-222222222222',
  username: 'bravo',
  display_name: null,
  level: 34,
  xp: 90210,
  net_worth: 123456,
  total_kills: 500,
  total_deaths: 25,
  kill_death_ratio: 20,
  highest_boss_tier: 6,
  total_mastery_xp: 4200,
  highest_mastery_level: 5,
  legendary_items: 2,
  total_items: 57,
  weapons_owned: 21,
  highest_item_level: 60,
  joined_at: '2026-08-14T00:00:00.000Z',
  last_active_at: '2026-11-02T00:00:00.000Z',
  showcase: {
    top_weapons: [PINNED, RANKED],
    pinned_item_ids: ['w-pinned'],
    best_endless_depth: 14,
    cache_rank_tokens: 9,
    cache_rank_total_ranks: 5,
    collections_discovered: 6,
  },
} as unknown as PlayerPublicProfile;

describe('PublicProfilePanel — the door, not the dead end', () => {
  it('renders the shelf with its pinned chip, every stat group, and the full-profile door', () => {
    const onViewFull = vi.fn();
    render(<PublicProfilePanel open onClose={() => {}} profile={publicProfile} onViewFull={onViewFull} />);

    expect(screen.getByText('Thunder Receipt')).toBeTruthy();
    expect(screen.getByText('Dustline Verse')).toBeTruthy();
    expect(screen.getByText('Pinned')).toBeTruthy();
    expect(screen.getByText('Hand-pinned by the hunter')).toBeTruthy();
    for (const group of ['Progression', 'Combat', 'Economy', 'Collection']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    expect(screen.getByText('20.00')).toBeTruthy(); // K/D survives the redesign

    fireEvent.click(screen.getByTestId('public-profile-view-full'));
    expect(onViewFull).toHaveBeenCalledTimes(1);
  });

  it('closes from the labeled Close button (no icon-only control)', () => {
    const onClose = vi.fn();
    render(<PublicProfilePanel open onClose={onClose} profile={publicProfile} onViewFull={() => {}} />);
    fireEvent.click(screen.getByTestId('public-profile-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerProfileSheet — the full profile, read-only', () => {
  it('renders the stage, the shelf, the record, and the joined date', () => {
    render(<PlayerProfileSheet open profile={publicProfile} onClose={() => {}} />);
    expect(screen.getByTestId('player-profile-sheet')).toBeTruthy();
    expect(screen.getByTestId('player-profile-stage')).toBeTruthy();
    expect(screen.getByText('bravo')).toBeTruthy();
    expect(screen.getByText(/Hunting since Aug 2026/)).toBeTruthy();
    expect(screen.getByText('Thunder Receipt')).toBeTruthy();
    expect(screen.getByText('Pinned')).toBeTruthy();
    expect(screen.getByText('Progression')).toBeTruthy();
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });
});

// ─── Trophy Shelf pin controls ─────────────────────────────────────

const lifetime = (pins: string[], top: ShowcaseItemPayload[]): ProfileLifetimePayload =>
  ({
    showcase: {
      top_weapons: top,
      pinned_item_ids: pins,
      best_endless_depth: 3,
      cache_rank_tokens: 1,
      cache_rank_total_ranks: 1,
      collections_discovered: 2,
    },
  }) as unknown as ProfileLifetimePayload;

describe('TrophyShelfPanel — pin controls drive the write', () => {
  beforeEach(() => {
    api.setShowcasePins.mockResolvedValue({ ok: true, pinned_item_ids: [] });
  });

  it('unpin sends the list without the item; pin appends in order', async () => {
    api.fetchProfileLifetime
      .mockResolvedValueOnce(lifetime(['w-pinned'], [PINNED, RANKED]))
      .mockResolvedValue(lifetime([], [RANKED, PINNED]));
    render(<TrophyShelfPanel />);
    await screen.findByTestId('trophy-shelf');

    expect(screen.getByText('1 pinned · ranked after')).toBeTruthy();
    fireEvent.click(screen.getByTestId('trophy-unpin-w-pinned'));
    await waitFor(() => expect(api.setShowcasePins).toHaveBeenCalledWith([]));

    fireEvent.click(screen.getByTestId('trophy-pin-w-ranked'));
    await waitFor(() => expect(api.setShowcasePins).toHaveBeenCalledWith(['w-ranked']));
  });

  it('reorder sends the swapped list', async () => {
    const other = weaponItem({ id: 'w-second', payload: { name: 'Second Pin', weaponType: 'Pistol', rarity: 'Legendary', pixelSeed: 3 } });
    api.fetchProfileLifetime.mockResolvedValue(lifetime(['w-pinned', 'w-second'], [PINNED, other]));
    render(<TrophyShelfPanel />);
    await screen.findByTestId('trophy-shelf');
    fireEvent.click(screen.getByTestId('trophy-pin-down-w-pinned'));
    await waitFor(() => expect(api.setShowcasePins).toHaveBeenCalledWith(['w-second', 'w-pinned']));
  });

  it('the picker pins an owned weapon that is not on the shelf', async () => {
    api.fetchProfileLifetime.mockResolvedValue(lifetime([], [RANKED]));
    useInventoryStore.setState({
      items: [{
        id: 'w-owned', name: 'Owned Favorite', level: 22, rarity: 'Epic',
        weaponType: 'Shotgun', baseDamage: 88,
      } as never],
    });
    render(<TrophyShelfPanel />);
    await screen.findByTestId('trophy-shelf');
    fireEvent.click(screen.getByTestId('trophy-pin-picker-toggle'));
    await screen.findByTestId('trophy-pin-picker');
    expect(screen.getByText('Owned Favorite')).toBeTruthy();
    fireEvent.click(screen.getByTestId('trophy-pin-add-w-owned'));
    await waitFor(() => expect(api.setShowcasePins).toHaveBeenCalledWith(['w-owned']));
  });

  it('a server refusal surfaces its reason in place', async () => {
    api.fetchProfileLifetime.mockResolvedValue(lifetime(['w-pinned'], [PINNED]));
    api.setShowcasePins.mockResolvedValue({ ok: false, error: 'A pinned weapon must be one of your own items.' });
    render(<TrophyShelfPanel />);
    await screen.findByTestId('trophy-shelf');
    fireEvent.click(screen.getByTestId('trophy-unpin-w-pinned'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('A pinned weapon must be one of your own items.')).toBeTruthy();
  });
});
