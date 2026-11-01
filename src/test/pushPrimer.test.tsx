/**
 * Push permission timing (audit PERM-01): the OS permission ask used
 * to fire at the first authenticated session mount — unprimed,
 * before the player had seen any value. Now:
 *  - session start only SYNCS (re-register when already granted;
 *    requestPermissions is never called),
 *  - the ask lives solely behind the primer row on the offline
 *    recap, shown when the player first has something worth
 *    notifying about,
 *  - either primer answer settles it for the session (no re-nag),
 *  - web stays a no-op (native-only, as before).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const cap = vi.hoisted(() => ({
  native: true,
  plugin: true,
  check: vi.fn(),
  request: vi.fn(),
  addListener: vi.fn(async () => ({})),
  register: vi.fn(async () => {}),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => cap.native,
    isPluginAvailable: () => cap.plugin,
    getPlatform: () => 'android',
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: cap.check,
    requestPermissions: cap.request,
    addListener: cap.addListener,
    register: cap.register,
  },
}));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: { registerPushDevice: vi.fn(async () => ({})) },
}));

import {
  checkPushPermission,
  requestPushNotifications,
  syncPushRegistration,
} from '@/lib/notifications/pushNotifications';
import { PushPrimerRow } from '@/components/activity/PushPrimer';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';

beforeEach(() => {
  cap.native = true;
  cap.plugin = true;
  cap.check.mockReset();
  cap.request.mockReset();
  cap.addListener.mockClear();
  cap.register.mockClear();
  vi.mocked(verifiedOps.registerPushDevice).mockClear();
  usePushPrimerStore.getState().reset();
});

describe('session-start sync never prompts', () => {
  it('does nothing while permission is still askable', async () => {
    cap.check.mockResolvedValue({ receive: 'prompt' });
    await syncPushRegistration();
    expect(cap.request).not.toHaveBeenCalled();
    expect(cap.register).not.toHaveBeenCalled();
  });

  it('re-registers silently when permission was already granted', async () => {
    cap.check.mockResolvedValue({ receive: 'granted' });
    await syncPushRegistration();
    expect(cap.request).not.toHaveBeenCalled();
    expect(cap.register).toHaveBeenCalled();
  });

  it('stays out of the way after a denial', async () => {
    cap.check.mockResolvedValue({ receive: 'denied' });
    await syncPushRegistration();
    expect(cap.request).not.toHaveBeenCalled();
    expect(cap.register).not.toHaveBeenCalled();
  });

  it('is a no-op on web', async () => {
    cap.native = false;
    await syncPushRegistration();
    expect(await checkPushPermission()).toBe('unavailable');
    expect(cap.check).not.toHaveBeenCalled();
    expect(cap.request).not.toHaveBeenCalled();
  });
});

describe('the primer ask (requestPushNotifications)', () => {
  it('requests once and registers on grant; the token reaches the Chef op', async () => {
    // Fresh module instance: the listeners-mounted flag is module
    // state, and the sync tests above already attached theirs.
    vi.resetModules();
    const fresh = await import('@/lib/notifications/pushNotifications');
    cap.request.mockResolvedValue({ receive: 'granted' });
    await expect(fresh.requestPushNotifications()).resolves.toBe(true);
    expect(cap.request).toHaveBeenCalledTimes(1);
    expect(cap.register).toHaveBeenCalled();
    // The registration listener forwards the device token.
    const registrationCall = cap.addListener.mock.calls.find(([event]) => event === 'registration');
    expect(registrationCall).toBeDefined();
    const listener = registrationCall![1] as (token: { value: string }) => Promise<void>;
    await listener({ value: 'device-token-1' });
    expect(verifiedOps.registerPushDevice).toHaveBeenCalledWith({
      token: 'device-token-1',
      platform: 'android',
      appVersion: null,
    });
  });

  it('returns false and registers nothing on denial', async () => {
    cap.request.mockResolvedValue({ receive: 'denied' });
    await expect(requestPushNotifications()).resolves.toBe(false);
    expect(cap.register).not.toHaveBeenCalled();
  });
});

describe('PushPrimerRow', () => {
  it('renders the benefit line and both answers while permission is askable', async () => {
    cap.check.mockResolvedValue({ receive: 'prompt' });
    render(<PushPrimerRow />);
    expect(await screen.findByText(/Get a ping when your offline earnings land/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(cap.request).not.toHaveBeenCalled();
  });

  it('"Notify me" runs the one ask and settles the primer for the session', async () => {
    cap.check.mockResolvedValue({ receive: 'prompt' });
    cap.request.mockResolvedValue({ receive: 'granted' });
    render(<PushPrimerRow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }));
    await waitFor(() => expect(cap.request).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Get a ping/)).toBeNull());
    expect(usePushPrimerStore.getState().settled).toBe(true);
  });

  it('"Not now" settles without ever asking', async () => {
    cap.check.mockResolvedValue({ receive: 'prompt' });
    render(<PushPrimerRow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(cap.request).not.toHaveBeenCalled();
    expect(screen.queryByText(/Get a ping/)).toBeNull();
    expect(usePushPrimerStore.getState().settled).toBe(true);
  });

  it('never renders when permission is granted, denied, or unavailable', async () => {
    for (const receive of ['granted', 'denied'] as const) {
      cap.check.mockResolvedValue({ receive });
      const { unmount } = render(<PushPrimerRow />);
      await waitFor(() => expect(cap.check).toHaveBeenCalled());
      expect(screen.queryByText(/Get a ping/)).toBeNull();
      unmount();
    }
    cap.native = false;
    render(<PushPrimerRow />);
    await waitFor(() => expect(screen.queryByText(/Get a ping/)).toBeNull());
  });

  it('the recap carries the primer in all three settlement variants', () => {
    const recap = readFileSync(resolve(process.cwd(), 'src/components/activity/OfflineRecap.tsx'), 'utf8');
    expect(recap.match(/<PushPrimerRow \/>/g)).toHaveLength(3);
  });

  it('App session mount syncs registration and never calls the old prompt-at-mount path', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('void syncPushRegistration();');
    expect(app).not.toContain('registerPushNotifications');
  });
});
