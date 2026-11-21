/**
 * PR #646 before/after harness page (dash/pr646-before +
 * dash/pr646-after, dev only) — mounts the REAL screens the PR's
 * UI diff touches, inside the real ScreenWrapper scroller with
 * the real BottomNav, exactly the shell App composes. The screen
 * comes from ?screen= (market tab from ?tab=, Profile focus from
 * ?focus=, guest Account from ?auth=guest via pr646Main). Seeds
 * are the pr646Seed module's one deterministic state — identical
 * on both branches. Auth resolves through the harness stub
 * (vite.pr646.config.ts); Chef reads are answered by the pr646
 * fetch backstop. Nothing here is imported by the app bundle.
 */
import React from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowLeftRight, Lock, Trash2 } from 'lucide-react';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { BottomNav } from '@/components/layout/BottomNav';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { MarketScreen } from '@/screens/MarketScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { ActivityLogScreen } from '@/screens/ActivityLogScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { HelpScreen } from '@/screens/HelpScreen';
import { DispatchScreen } from '@/screens/DispatchScreen';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { SlotGearPicker } from '@/components/action/SlotGearPicker';
import { useMarketStore } from '@/store';
import App from '@/App';
import { EQUIPPED, LEGENDARY, seedFor } from './pr646Seed';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') ?? 'profile';
const noop = () => {};

type TabId = 'home' | 'gear' | 'market' | 'hunter';

const Chrome: React.FC<{ tab: TabId; children: React.ReactNode }> = ({ tab, children }) => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="pr646-harness-root"
  >
    <ScreenWrapper hidden={false}>{children}</ScreenWrapper>
    <BottomNav activeTab={tab} onChange={() => {}} />
  </div>
);

/** The shipped GearHub action grid (handlers inert), as the
 *  store-shots inspect harness mounted it. */
const gearActions = (
  <div className="grid grid-cols-4 gap-2">
    <button type="button" className="flex flex-col items-center gap-1 border border-amber/40 bg-amber/10 py-2 text-[11px] font-black text-amber">
      <PxIcon name="crosshair" size={13} />Equip
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-green/40 bg-green/10 py-2 text-[11px] font-black text-green">
      <ArrowLeftRight size={15} />Market
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[11px] font-black text-text-secondary">
      <Lock size={15} />Lock
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-red/40 bg-red/10 py-2 text-[11px] font-black text-red">
      <Trash2 size={15} />Salvage
    </button>
  </div>
);

export const Pr646HarnessPage: React.FC = () => {
  seedFor(screen);

  if (screen === 'auth') {
    // The iOS presentation of the sign-in screen: the real
    // component reads Capacitor's platform at render — present
    // the harness as iOS so the Apple button branch renders.
    // ?native=0 skips the patch and captures the web presentation
    // (where the guest-visibility copy lives).
    if (params.get('native') !== '0') {
      const cap = Capacitor as unknown as Record<string, unknown>;
      cap.getPlatform = () => 'ios';
      cap.isNativePlatform = () => true;
    }
    return (
      <div style={{ height: '100vh', background: '#0B0B10' }} data-testid="pr646-harness-root">
        <AuthScreen />
      </div>
    );
  }

  if (screen === 'app') {
    return (
      <div style={{ height: '100vh', background: '#0B0B10' }} data-testid="pr646-harness-root">
        <App />
      </div>
    );
  }

  if (screen === 'home-roam' || screen === 'home-bench' || screen === 'home-endless') {
    return (
      <Chrome tab="home">
        <HomeScreen
          onNavigate={noop}
          craftBenchIntent={screen === 'home-bench' ? { seq: 1 } : null}
        />
      </Chrome>
    );
  }

  if (screen === 'market') {
    const tab = params.get('tab') ?? 'buy';
    useMarketStore.setState({ activeTab: tab } as never);
    return (
      <Chrome tab="market">
        <MarketScreen onNavigate={noop} active />
      </Chrome>
    );
  }

  if (screen === 'profile') {
    const focus = params.get('focus');
    return (
      <Chrome tab="hunter">
        <ProfileScreen
          onNavigate={noop}
          focusSection={focus === 'research' || focus === 'wardrobe' ? focus : null}
        />
      </Chrome>
    );
  }

  if (screen === 'activity') {
    return (
      <Chrome tab="home">
        <ActivityLogScreen />
      </Chrome>
    );
  }

  if (screen === 'settings') {
    return (
      <Chrome tab="home">
        <SettingsScreen />
      </Chrome>
    );
  }

  if (screen === 'help') {
    return (
      <Chrome tab="home">
        <HelpScreen initialPageId={null} intentSeq={0} onExit={noop} />
      </Chrome>
    );
  }

  if (screen === 'dispatch') {
    return (
      <Chrome tab="home">
        <DispatchScreen />
      </Chrome>
    );
  }

  if (screen === 'gear' || screen === 'gear-inspect' || screen === 'gear-picker') {
    return (
      <Chrome tab="gear">
        <InventoryScreen
          onNavigate={noop}
          tabIntent={params.get('garage') === '1' ? { tab: 'loadout', expandVehicle: true, seq: 1 } : null}
        />
        {screen === 'gear-inspect' && (
          <GearInspectSheet
            item={LEGENDARY}
            open
            onClose={noop}
            contextLabel="Inventory Inspect"
            allowReforge
            actions={gearActions}
          />
        )}
        {screen === 'gear-picker' && (
          <SlotGearPicker
            slot="primary"
            currentItemId={EQUIPPED.id}
            onClose={noop}
            onEquip={async () => {}}
            onUnequip={noop}
          />
        )}
      </Chrome>
    );
  }

  return (
    <Chrome tab="hunter">
      <ProfileScreen onNavigate={noop} />
    </Chrome>
  );
};
