import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import { BottomNav } from './components/layout/BottomNav';
import { ScreenWrapper } from './components/layout/ScreenWrapper';
import { TabErrorBoundary } from './components/layout/TabErrorBoundary';
import { DeathOverlay } from './components/action/DeathOverlay';
import { AuthScreen } from './screens/AuthScreen';

// Code-split screens (tab-switch latency, 2026-11-12): the four tab
// screens and every sub-screen are React.lazy chunks, not static
// imports — the pre-fix shell parsed/evaluated all of them in the
// single 3.7MB main chunk on every cold launch. AuthScreen stays
// static: it is the signed-out gate and must paint immediately.
const HomeScreen = React.lazy(() => import('./screens/HomeScreen').then((m) => ({ default: m.HomeScreen })));
const InventoryScreen = React.lazy(() => import('./screens/InventoryScreen').then((m) => ({ default: m.InventoryScreen })));
const MarketScreen = React.lazy(() => import('./screens/MarketScreen').then((m) => ({ default: m.MarketScreen })));
const ProfileScreen = React.lazy(() => import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })));
const ChestScreen = React.lazy(() => import('./screens/ChestScreen').then((m) => ({ default: m.ChestScreen })));
const LeaderboardsScreen = React.lazy(() => import('./screens/LeaderboardsScreen').then((m) => ({ default: m.LeaderboardsScreen })));
const SettingsScreen = React.lazy(() => import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const HelpScreen = React.lazy(() => import('./screens/HelpScreen').then((m) => ({ default: m.HelpScreen })));
const CollectionsScreen = React.lazy(() => import('./screens/CollectionsScreen').then((m) => ({ default: m.CollectionsScreen })));
const DispatchScreen = React.lazy(() => import('./screens/DispatchScreen').then((m) => ({ default: m.DispatchScreen })));
const ActivityLogScreen = React.lazy(() => import('./screens/ActivityLogScreen').then((m) => ({ default: m.ActivityLogScreen })));

/** Suspense fallback in the shell's own register (the auth-loading
 * card): a branded surface, fixed min-height, no layout explosion. */
function TabPaneFallback({ label }: { label: string }) {
  return (
    <div className="bl-page flex min-h-[60vh] items-center justify-center p-4 text-text-primary">
      <div className="bl-card w-full max-w-xs p-5 text-center">
        <div className="bl-title text-4xl text-amber">CyberCache</div>
        <div className="text-xs font-bold uppercase tracking-widest text-text-muted">Loading {label}…</div>
      </div>
    </div>
  );
}
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
type SubScreen = 'chest' | 'settings' | 'help' | 'collections' | 'dispatch' | 'standings' | 'activity-log' | null;
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
  collections: 'Collections',
  dispatch: 'Dispatch',
  standings: 'Standings',
  'activity-log': 'Activity Log',
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
  const { user, account, loading, authError, bootstrapError, retryBootstrap, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('home');
  // Keep-alive (tab-switch latency, 2026-11-12): a tab's screen
  // mounts on FIRST visit and then stays mounted, hidden with
  // display:none — switching tabs never unmounts/remounts a screen
  // again (the Pixi stage init, the market fetches, and each pane's
  // scroll position all survive a switch).
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabId>>(() => new Set<TabId>(['home']));
  // Every tab activation goes through here so the visited set (the
  // keep-alive mount list) grows in the same event as the switch —
  // no effect-driven setState.
  const activateTab = (tab: TabId) => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    setActiveTab(tab);
  };
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [bossSelectOpen, setBossSelectOpen] = useState(false);
  // Deep-link focus inside the Profile tab: 'skills' lands the player
  // ON the Profile-embedded SkillTreeScreen (scrolled into view), not
  // at the top of the Profile page (device feedback r2).
  const [profileFocus, setProfileFocus] = useState<'skills' | 'research' | 'wardrobe' | null>(null);
  // Field Manual deep-link intent: 'help' opens the manual at its
  // index; 'help:<Page>' opens it straight on that wiki page. `seq`
  // makes a repeat intent re-apply even while the manual is mounted.
  const [helpIntent, setHelpIntent] = useState<{ page: string | null; seq: number }>({ page: null, seq: 0 });
  // Tab intent for the gear home (flow audit F2): every "loadout"
  // door must open Inventory ON its Loadout stop — the one equip
  // surface — not on the item grid. `seq` makes a repeat intent
  // re-apply even while Inventory is already mounted. The 'garage'
  // door lands on the Loadout stop too, with its vehicle section
  // expanded: the owner overruled DESIGN.md §11 F1 on 2026-11-02
  // and the Garage folded into Loadout.
  const [inventoryTabIntent, setInventoryTabIntent] = useState<{ tab: 'loadout'; seq: number; expandVehicle?: boolean } | null>(null);
  // Craft-bench intent (crafting consolidation, owner ruling
  // 2026-11-04): the bench's canonical home is Home's Craft
  // workspace, so every 'workshop' door lands on the Home tab with
  // this seq-stamped intent and the stage opens the bench on
  // arrival — the inventoryTabIntent pattern, one tab over.
  const [homeCraftIntent, setHomeCraftIntent] = useState<{ seq: number } | null>(null);

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

  // The bench reports its own analytics name when a 'workshop'
  // door lands the player on it (it is a workspace on Home now,
  // not a sub-screen — the name survives the move).
  useEffect(() => {
    if (homeCraftIntent) trackScreen('Workshop');
  }, [homeCraftIntent]);

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

  // Terminal bootstrap failure (audit X-08): the session restored
  // but the profile/bootstrap never completed — the main UI would
  // render skeleton bars forever with no recovery. Offer the retry
  // (and a way out) instead of entering half-loaded.
  if (bootstrapError) {
    return (
      <div className="bl-page flex h-full items-center justify-center p-4 text-text-primary">
        <div className="bl-card w-full max-w-xs space-y-3 p-5 text-center">
          <div className="bl-title text-2xl text-amber">CyberCache</div>
          <div className="text-xs font-bold uppercase tracking-widest text-text-muted">Could not finish loading your hunter</div>
          <div className="text-xs text-red">{bootstrapError}</div>
          <button
            type="button"
            onClick={retryBootstrap}
            className="bl-primary w-full py-2 text-xs font-black uppercase tracking-wide"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => { void signOut(); }}
            className="bl-secondary w-full py-2 text-xs font-black uppercase tracking-wide text-text-secondary"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const handleNavigate = (screen: string) => {
    if (screen === 'skills') {
      activateTab('hunter');
      setSubScreen(null);
      setProfileFocus('skills');
      return;
    }
    if (screen === 'research') {
      // Research door (Workshop Direction A): the batch recipes'
      // gate names the Production Systems course — the door lands
      // ON the Research stop, not the Hunter tab's front door.
      activateTab('hunter');
      setSubScreen(null);
      setProfileFocus('research');
      return;
    }
    if (screen === 'wardrobe') {
      // The Wardrobe door on the Gear page's figure stage (Exec C,
      // 2026-11-03): the Wardrobe's canonical home stays Hunter →
      // Profile — this is the DESIGN §9 secondary door, landing on
      // the Profile stop scrolled to the Wardrobe panel.
      activateTab('hunter');
      setSubScreen(null);
      setProfileFocus('wardrobe');
      return;
    }
    setProfileFocus(null);
    setInventoryTabIntent(null);
    if (screen === 'workshop') {
      // Route alias (crafting consolidation, 2026-11-04): the
      // Workshop is Home's Craft workspace — the Gear status
      // strip, the Garage remedy doors, and every other
      // onNavigate('workshop') caller lands on Home with the
      // bench open. No dead doors.
      activateTab('home');
      setSubScreen(null);
      setHomeCraftIntent({ seq: Date.now() });
      return;
    }
    if (screen === 'loadout' || screen === 'loot') {
      activateTab('gear');
      setSubScreen(null);
      setInventoryTabIntent({ tab: 'loadout', seq: Date.now() });
      return;
    }
    if (screen === 'garage') {
      // Garage door (audit UX-06): the Garage lives inside the
      // Loadout stop (owner ruling 2026-11-02, §11 F1 amended) —
      // land on Loadout with the vehicle section already expanded.
      activateTab('gear');
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
      activateTab('market');
      setSubScreen(null);
      return;
    }
    if (screen === 'vendor') {
      activateTab('market');
      setSubScreen(null);
      return;
    }
    if (screen === 'market') {
      activateTab('market');
      setSubScreen(null);
      return;
    }
    if (topLevelTabs.includes(screen as TabId)) {
      activateTab(screen as TabId);
      setSubScreen(null);
      return;
    }
    if (screen === 'help' || screen.startsWith('help:')) {
      // Field Manual (wiki-native, 2026-11-05): 'help' lands on the
      // index; 'help:<Page>' deep-links one wiki page. The manual
      // owns its internal reading stack from there.
      setHelpIntent({
        page: screen.startsWith('help:') ? screen.slice('help:'.length) : null,
        seq: Date.now(),
      });
      setSubScreen('help');
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
          initialPageId={helpIntent.page}
          intentSeq={helpIntent.seq}
          onExit={handleBack}
        />
      ),
      collections: <CollectionsScreen />,
      dispatch: <DispatchScreen />,
      standings: <LeaderboardsScreen onNavigate={handleNavigate} />,
      'activity-log': <ActivityLogScreen />,
    };
    const title = subScreen === 'chest'
      ? 'Crack Cache'
      : subScreen === 'dispatch'
          ? 'Dispatch'
        : subScreen === 'collections'
          ? 'Collections'
        : subScreen === 'standings'
          ? 'Standings'
        : subScreen === 'activity-log'
          ? 'Activity Log'
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
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Sub-screen / field station</div>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <React.Suspense fallback={<TabPaneFallback label={title ?? 'Loading'} />}>
            {screens[subScreen!] || <div className="p-4 text-text-primary">Unknown screen</div>}
          </React.Suspense>
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

      {/* Keep-alive tab panes (2026-11-12): every visited tab stays
          mounted in its own ScreenWrapper scroller; the inactive
          panes (and all panes while a sub-screen takes over) are
          display:none. Intent props (profileFocus,
          inventoryTabIntent, homeCraftIntent) are App state passed
          as props, and each screen applies them via seq-guarded
          render-phase adjustments — they reach already-mounted
          screens exactly as they reached freshly-mounted ones.
          TabErrorBoundary still wraps each screen individually. */}
      {visitedTabs.has('home') && (
        <ScreenWrapper hidden={!!subScreen || activeTab !== 'home'}>
          <TabErrorBoundary surface="Home">
            <React.Suspense fallback={<TabPaneFallback label="Home" />}>
              <HomeScreen onNavigate={handleNavigate} onOpenBossSelect={() => setBossSelectOpen(true)} craftBenchIntent={homeCraftIntent} />
            </React.Suspense>
          </TabErrorBoundary>
        </ScreenWrapper>
      )}
      {visitedTabs.has('gear') && (
        <ScreenWrapper hidden={!!subScreen || activeTab !== 'gear'}>
          <TabErrorBoundary surface="Inventory">
            <React.Suspense fallback={<TabPaneFallback label="Gear" />}>
              <InventoryScreen onNavigate={handleNavigate} tabIntent={inventoryTabIntent} />
            </React.Suspense>
          </TabErrorBoundary>
        </ScreenWrapper>
      )}
      {visitedTabs.has('market') && (
        <ScreenWrapper hidden={!!subScreen || activeTab !== 'market'}>
          <TabErrorBoundary surface="Market">
            {/* No whole-tab gate: the NPC vendor is open to guests.
                MarketScreen gates its player-market tabs internally.
                `active` is its refresh-on-return signal (keep-alive
                means its mount fetches no longer re-run per visit). */}
            <React.Suspense fallback={<TabPaneFallback label="Market" />}>
              <MarketScreen onNavigate={handleNavigate} active={!subScreen && activeTab === 'market'} />
            </React.Suspense>
          </TabErrorBoundary>
        </ScreenWrapper>
      )}
      {visitedTabs.has('hunter') && (
        <ScreenWrapper hidden={!!subScreen || activeTab !== 'hunter'}>
          <TabErrorBoundary surface="Profile">
            <React.Suspense fallback={<TabPaneFallback label="Hunter" />}>
              <ProfileScreen onNavigate={handleNavigate} focusSection={profileFocus} />
            </React.Suspense>
          </TabErrorBoundary>
        </ScreenWrapper>
      )}

      {subScreen ? renderSubScreen() : null}

      <BottomNav activeTab={activeTab} onChange={(tab) => { activateTab(tab); setSubScreen(null); setProfileFocus(null); setInventoryTabIntent(null); setHomeCraftIntent(null); }} />
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
