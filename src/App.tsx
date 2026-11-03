import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import { BottomNav } from './components/layout/BottomNav';
import { ScreenWrapper } from './components/layout/ScreenWrapper';
import { HomeScreen } from './screens/HomeScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { MarketScreen } from './screens/MarketScreen';
import { ChestScreen } from './screens/ChestScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { LeaderboardsScreen } from './screens/LeaderboardsScreen';
import { TabErrorBoundary } from './components/layout/TabErrorBoundary';
import { DeathOverlay } from './components/action/DeathOverlay';
import { SharedDefsMount } from './components/gearArt/SharedDefs';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { WorkshopScreen } from './screens/WorkshopScreen';
import { CollectionsScreen } from './screens/CollectionsScreen';
import { DispatchScreen } from './screens/DispatchScreen';
import { AuthScreen } from './screens/AuthScreen';
import { BossSelectModal } from './components/fight/BossSelectModal';
import { UsernameSetupModal } from './components/profile/UsernameSetupModal';
import { isGuestAccount, isVerificationGraceExpired, shouldShowVerificationReminder } from './auth/accountState';

import { useAuth } from './auth/AuthProvider';
import { useEffect } from 'react';
import { mountIdleTicker, unmountIdleTicker, usePlayerStore } from './store';
import {
  initAnalytics,
  observePlayerLevel,
  setAccountTypeProperty,
  trackScreen,
  type ScreenName,
} from './lib/analytics/analytics';
import { isMarketStopId, useMarketStore } from './store/slices/marketSlice';
import { SalvageToastContainer } from './components/action/SalvageToast';
import { StarterBundleReveal } from './components/activity/StarterBundleReveal';
import { useOfflineRecapListener } from './components/activity/useOfflineRecapListener';
import { useOfflineResumeSettlement } from './components/activity/useOfflineResumeSettlement';
import { useLeaveSignals } from './components/activity/useLeaveSignals';
import { SettlementDebugOverlay } from './components/activity/SettlementDebugOverlay';
import { syncPushRegistration } from './lib/notifications/pushNotifications';

// Four tabs (DESIGN.md §2, owner-decided 2026-11-01): Home · Gear ·
// Market · Hunter. Board + Action merged into Home; Rank folded
// into Hunter as the Standings door.
type TabId = 'home' | 'gear' | 'market' | 'hunter';
// 'standings' is the leaderboards' route now that the Rank tab is
// retired: the Hunter slice mounts its badged Standings door
// against this sub-screen (handleNavigate('standings')). The
// LeaderboardsScreen itself is unchanged.
type SubScreen = 'chest' | 'settings' | 'help' | 'workshop' | 'collections' | 'dispatch' | 'standings' | null;
const topLevelTabs: TabId[] = ['home', 'gear', 'market', 'hunter'];

// Analytics screen names (the analytics module's documented table):
// the four tabs by their DESIGN.md names, sub-screens by theirs.
const TAB_SCREEN_NAMES: Record<TabId, ScreenName> = {
  home: 'Home',
  gear: 'Gear',
  market: 'Market',
  hunter: 'Hunter',
};
const SUB_SCREEN_NAMES: Record<NonNullable<SubScreen>, ScreenName> = {
  chest: 'Cache',
  settings: 'Settings',
  help: 'Help',
  workshop: 'Workshop',
  collections: 'Collections',
  dispatch: 'Dispatch',
  standings: 'Standings',
};

function VerificationReminderBanner() {
  const { account, markVerificationReminderSeen, actionLoading } = useAuth();
  if (!shouldShowVerificationReminder(account)) return null;

  const expired = isVerificationGraceExpired(account);
  const copy = expired
    ? 'Email verification required before using markets, shops, services, and social features.'
    : 'Verify email to unlock trading, shops, and player services.';

  return (
    <div className="bl-card shrink-0 mx-3 mt-3 flex items-center justify-between gap-3 px-3 py-2 text-xs text-amber">
      <span className="font-bold">{copy}</span>
      <button
        onClick={() => markVerificationReminderSeen()}
        disabled={actionLoading}
        className="bl-secondary shrink-0 px-2 py-1 text-[10px] font-black disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  );
}

function App() {
  const { user, account, loading, authError } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [bossSelectOpen, setBossSelectOpen] = useState(false);
  // Deep-link focus inside the Profile tab: 'skills' lands the player
  // ON the Profile-embedded SkillTreeScreen (scrolled into view), not
  // at the top of the Profile page (device feedback r2).
  const [profileFocus, setProfileFocus] = useState<'skills' | 'research' | null>(null);
  // Tab intent for the gear home (flow audit F2): every "loadout"
  // door must open Inventory ON its Loadout stop — the one equip
  // surface — not on the item grid. `seq` makes a repeat intent
  // re-apply even while Inventory is already mounted. The 'garage'
  // door lands on the Loadout stop too, with its vehicle section
  // expanded: the owner overruled DESIGN.md §11 F1 on 2026-11-02
  // and the Garage folded into Loadout.
  const [inventoryTabIntent, setInventoryTabIntent] = useState<{ tab: 'loadout'; seq: number; expandVehicle?: boolean } | null>(null);

  // Listen for offline settlement completion events and route to recap store.
  useOfflineRecapListener();

  // Mobile resume settlement: catches app-switch returns where AuthProvider
  // doesn't fire (page stays mounted, no auth state change).
  useOfflineResumeSettlement();

  // Best-effort leave signals: saves snapshot + sends heartbeat on pagehide.
  // NOT required for correctness — server timestamps are authoritative.
  useLeaveSignals();

  // Mount the singleton idle ticker once per authenticated session. The ticker
  // submits roaming claims to the Chef (/api/claim), which simulates and
  // settles every tick server-side; the client only applies the response.
  // Push (audit PERM-01): session start NEVER prompts for notification
  // permission — it only re-registers the device when permission was
  // already granted. The ask itself lives on the offline recap's
  // primer (PushPrimerRow → requestPushNotifications).
  useEffect(() => {
    if (!user || loading) return undefined;
    mountIdleTicker();
    void syncPushRegistration();
    return () => {
      unmountIdleTicker();
    };
  }, [user, loading]);

  // Product analytics (GA4 via Firebase Analytics): init once at
  // shell mount. The wrapper is a silent no-op until the Firebase
  // web config lands in the build env, and it never gates anything.
  useEffect(() => {
    initAnalytics();
  }, []);

  // The current surface as a GA4 screen_view: a sub-screen outranks
  // the tab beneath it; the boss door and the Garage (the Loadout
  // stop with its vehicle section expanded) report their own names.
  useEffect(() => {
    trackScreen(subScreen ? SUB_SCREEN_NAMES[subScreen] : TAB_SCREEN_NAMES[activeTab]);
  }, [activeTab, subScreen]);

  useEffect(() => {
    if (bossSelectOpen) trackScreen('Boss');
  }, [bossSelectOpen]);

  useEffect(() => {
    if (inventoryTabIntent?.expandVehicle) trackScreen('Garage');
  }, [inventoryTabIntent]);

  // account_type user property follows the loaded account (guests
  // and linked accounts alike — analytics is not a gate).
  useEffect(() => {
    if (account) setAccountTypeProperty(isGuestAccount(account) ? 'guest' : 'linked');
  }, [account]);

  // Level: level_up events + the level_band property ride the
  // player store's level wherever the server syncs it from.
  useEffect(() => usePlayerStore.subscribe((s) => observePlayerLevel(s.level)), []);

  if (loading) {
    return (
      <div className="bl-page flex h-full items-center justify-center p-4 text-text-primary">
        <div className="bl-card w-full max-w-xs p-5 text-center">
          <div className="bl-title text-4xl text-amber">CyberCache</div>
          <div className="text-xs font-bold uppercase tracking-widest text-text-muted">Loading Hunter File…</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const handleNavigate = (screen: string) => {
    if (screen === 'skills') {
      setActiveTab('hunter');
      setSubScreen(null);
      setProfileFocus('skills');
      return;
    }
    if (screen === 'research') {
      // Research door (Workshop Direction A): the batch recipes'
      // gate names the Production Systems course — the door lands
      // ON the Research stop, not the Hunter tab's front door.
      setActiveTab('hunter');
      setSubScreen(null);
      setProfileFocus('research');
      return;
    }
    setProfileFocus(null);
    setInventoryTabIntent(null);
    if (screen === 'loadout' || screen === 'loot') {
      setActiveTab('gear');
      setSubScreen(null);
      setInventoryTabIntent({ tab: 'loadout', seq: Date.now() });
      return;
    }
    if (screen === 'garage') {
      // Garage door (audit UX-06): the Garage lives inside the
      // Loadout stop (owner ruling 2026-11-02, §11 F1 amended) —
      // land on Loadout with the vehicle section already expanded.
      setActiveTab('gear');
      setSubScreen(null);
      setInventoryTabIntent({ tab: 'loadout', expandVehicle: true, seq: Date.now() });
      return;
    }
    if (screen.startsWith('market:')) {
      // Tab→stop deep link (DESIGN.md §9): 'market:<stop>' lands ON
      // the named Market rail stop, not just on the tab — Home's
      // Slots launcher rides it, so the card reaches the wheel in
      // the two taps §9 counts. The intent is recorded on the
      // market store and consumed by MarketScreen on arrival; an
      // unknown stop falls back to the plain Market landing.
      const stop = screen.slice('market:'.length);
      if (isMarketStopId(stop)) {
        useMarketStore.getState().requestMarketStop(stop);
      }
      setActiveTab('market');
      setSubScreen(null);
      return;
    }
    if (screen === 'vendor') {
      setActiveTab('market');
      setSubScreen(null);
      return;
    }
    if (screen === 'market') {
      setActiveTab('market');
      setSubScreen(null);
      return;
    }
    if (topLevelTabs.includes(screen as TabId)) {
      setActiveTab(screen as TabId);
      setSubScreen(null);
      return;
    }
    setSubScreen(screen as SubScreen);
  };

  const handleBack = () => {
    setSubScreen(null);
  };

  const renderSubScreen = () => {
    const screens: Record<string, React.ReactNode> = {
      chest: <ChestScreen onNavigate={handleNavigate} />,
      settings: <SettingsScreen />,
      help: (
        <HelpScreen
          onTourJump={(tab) => {
            setActiveTab(tab);
            setSubScreen(null);
          }}
        />
      ),
      workshop: <WorkshopScreen onNavigate={handleNavigate} />,
      collections: <CollectionsScreen />,
      dispatch: <DispatchScreen />,
      standings: <LeaderboardsScreen onNavigate={handleNavigate} />,
    };
    const title = subScreen === 'chest'
      ? 'Crack Cache'
      : subScreen === 'workshop'
        ? 'Workshop'
        : subScreen === 'dispatch'
          ? 'Dispatch'
        : subScreen === 'collections'
          ? 'Collections'
        : subScreen === 'standings'
          ? 'Standings'
        : subScreen === 'help'
          ? 'Field Manual'
          : subScreen === 'settings'
            ? 'Options Board'
            : subScreen;

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="shrink-0 border-b-[3px] border-border bg-surface p-3 shadow-[0_6px_16px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleBack}
              className="bl-secondary px-3 py-2 text-xs font-black text-amber active:text-amber/70"
            >
              <span className="inline-flex items-center gap-1"><PxIcon name="chevL" size={13} /> Back</span>
            </motion.button>
            <div>
              <div className="bl-title text-2xl leading-none text-text-primary capitalize">{title}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-text-muted">Sub-screen / field station</div>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {screens[subScreen!] || <div className="p-4 text-text-primary">Unknown screen</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text-primary">
      <AnimatePresence>
        {bossSelectOpen && (
          <BossSelectModal onClose={() => setBossSelectOpen(false)} />
        )}
      </AnimatePresence>

      {authError && (
        <div className="bl-card shrink-0 mx-3 mt-3 px-3 py-2 text-xs font-bold text-red">
          {authError}
        </div>
      )}
      <VerificationReminderBanner />

      {account && !account.hasUsername && !account.isAnonymous && (
        <UsernameSetupModal force />
      )}

      {subScreen ? (
        renderSubScreen()
      ) : (
        <ScreenWrapper activeTab={activeTab}>
          {activeTab === 'home' && <TabErrorBoundary surface="Home"><HomeScreen onNavigate={handleNavigate} onOpenBossSelect={() => setBossSelectOpen(true)} /></TabErrorBoundary>}
          {activeTab === 'gear' && <TabErrorBoundary surface="Inventory"><InventoryScreen onNavigate={handleNavigate} tabIntent={inventoryTabIntent} /></TabErrorBoundary>}
          {activeTab === 'market' && (
            <TabErrorBoundary surface="Market">
              {/* No whole-tab gate: the NPC vendor is open to guests.
                  MarketScreen gates its player-market tabs internally. */}
              <MarketScreen onNavigate={handleNavigate} />
            </TabErrorBoundary>
          )}
          {activeTab === 'hunter' && <TabErrorBoundary surface="Profile"><ProfileScreen onNavigate={handleNavigate} focusSection={profileFocus} /></TabErrorBoundary>}
        </ScreenWrapper>
      )}

      <BottomNav activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setSubScreen(null); setProfileFocus(null); setInventoryTabIntent(null); }} />
      {/* One document-level copy of the shared SVG surface filters;
          every gear illustration references them by ID (gear-grid
          perf audit, 2026-11-02 — they were duplicated per item). */}
      <SharedDefsMount />
      <DeathOverlay />
      <SalvageToastContainer />
      {/* The offline recap no longer mounts here: it lives in the
          Dashboard level pop-up (DashboardTopBar → OfflineRecapCard).
          useOfflineRecapListener (above) still feeds settlements
          into the recap store at the App level. */}
      <StarterBundleReveal />
      <SettlementDebugOverlay />
    </div>
  );
}

export default App;
