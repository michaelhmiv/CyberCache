/**
 * QC fix B1 — Standings → other-hunter profile crash.
 *
 * The Chef's public-profile projection (PublicProfileData in
 * src/server/reads/store.ts) carries `kill_death_ratio: number | null`:
 * null whenever the hunter has zero recorded deaths (the in-memory
 * projection computes `deaths === 0 ? null : kills / deaths`, and the
 * Postgres path maps the column through numOrNull). The client type
 * in publicProfileService misdeclared the field as a plain `number`,
 * and PublicProfilePanel called `.toFixed(2)` on it unguarded — so
 * tapping ANY zero-death hunter's row in Standings (every fresh
 * guest, most new players) crashed the app to the error boundary.
 *
 * The fixture below is the literal wire payload the Chef returns
 * for such a hunter — snake_case fields, null K/D and all.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';
import type { PlayerPublicProfile } from '@/lib/api/publicProfileService';

afterEach(() => {
  cleanup();
});

/** The Chef's public-profile projection for a brand-new hunter:
 *  kills but no deaths yet, so the K/D is null on the wire. */
const zeroDeathHunterWirePayload = {
  player_id: '00000000-0000-4000-8000-000000000001',
  username: null,
  display_name: null,
  level: 1,
  xp: 120,
  net_worth: 5_000,
  total_kills: 12,
  total_deaths: 0,
  kill_death_ratio: null,
  highest_boss_tier: 0,
  total_mastery_xp: 0,
  highest_mastery_level: 0,
  legendary_items: 0,
  total_items: 3,
  weapons_owned: 1,
  highest_item_level: 2,
  joined_at: '2026-11-01T00:00:00.000Z',
  last_active_at: '2026-11-02T00:00:00.000Z',
};

describe('PublicProfilePanel — null K/D (QC B1)', () => {
  it('renders a zero-death hunter profile instead of crashing on the null K/D', () => {
    const profile = zeroDeathHunterWirePayload as unknown as PlayerPublicProfile;
    render(<PublicProfilePanel open onClose={() => {}} profile={profile} />);

    // The panel renders the hunter's real stats…
    expect(screen.getByText('Combat')).toBeTruthy();
    expect(screen.getByText('Kills')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Deaths')).toBeTruthy();
    // …and the K/D row shows the codebase's absent-value mark,
    // not a crash and not a fabricated 0.00 (the ratio does not
    // exist yet — the hunter has never died).
    const kdLabel = screen.getByText('K/D');
    const kdRow = kdLabel.parentElement;
    expect(kdRow?.textContent).toContain('—');
    expect(kdRow?.textContent).not.toContain('0.00');
  });

  it('still formats a real K/D ratio to two places', () => {
    const profile = {
      ...zeroDeathHunterWirePayload,
      total_kills: 300,
      total_deaths: 60,
      kill_death_ratio: 5,
    } as unknown as PlayerPublicProfile;
    render(<PublicProfilePanel open onClose={() => {}} profile={profile} />);

    const kdRow = screen.getByText('K/D').parentElement;
    expect(kdRow?.textContent).toContain('5.00');
  });
});
