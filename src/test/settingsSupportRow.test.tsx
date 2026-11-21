/**
 * Settings Support row + in-app deletion entry (Build 7 — App
 * Review hardening). Pins:
 *
 *  - The Options Board carries a Support row that opens the
 *    production support page in the browser.
 *  - The Danger Zone's deletion entry is the in-app flow's open
 *    control (DeleteAccountControl), not the old web-page button.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));

vi.mock('@/lib/chef/chefClient', () => ({
  getResearchState: vi.fn(async () => ({ research: { bonuses: { offlineCapBonus: 0 } } })),
  chefUrl: (path: string) => `/api${path}`,
  resolveChefBase: () => '',
}));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: { resetProgress: vi.fn(async () => undefined) },
}));

vi.mock('@/store/runtimeSupabaseSync', () => ({
  resetRuntimeStoresToInitialState: vi.fn(),
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api/offlineCapService', () => ({
  setOfflineCapLimiter: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/api/autoSalvageService', () => ({
  getAutoSalvageRule: vi.fn(async () => null),
  setAutoSalvageRule: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/nativeAuth', () => ({
  getAppleIdTokenNative: vi.fn(),
  getGoogleIdTokenNative: vi.fn(),
}));

vi.mock('@/lib/analytics/analytics', () => ({
  trackGuestStart: vi.fn(),
  trackSignIn: vi.fn(),
}));

import { SettingsScreen } from '@/screens/SettingsScreen';

describe('SettingsScreen — Support row and deletion entry', () => {
  it('Support row opens the support page; deletion entry is present', () => {
    const open = vi.fn();
    window.open = open;

    render(<SettingsScreen />);

    const supportRow = screen.getByTestId('settings-support-row');
    fireEvent.click(supportRow);
    expect(open).toHaveBeenCalledWith(
      'https://chef-production.up.railway.app/support.html',
      '_blank',
      'noopener,noreferrer',
    );

    // The in-app deletion flow's entry replaced the web-page button.
    expect(screen.getByTestId('delete-account-open')).toBeTruthy();
    expect(screen.getByTestId('delete-account-learn-more')).toBeTruthy();
  });
});
