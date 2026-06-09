import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BottomNav } from './components/layout/BottomNav';
import { ScreenWrapper } from './components/layout/ScreenWrapper';
import { DashboardScreen } from './screens/DashboardScreen';
import { ActionScreen } from './screens/ActionScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { MarketScreen } from './screens/MarketScreen';
import { MasteryScreen } from './screens/MasteryScreen';
import { ChestScreen } from './screens/ChestScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { WorkshopScreen } from './screens/WorkshopScreen';
import { AuthScreen } from './screens/AuthScreen';
import { BossSelectModal } from './components/fight/BossSelectModal';
import { isVerificationGraceExpired, shouldShowVerificationReminder } from './auth/accountState';
import { FeatureGate } from './auth/FeatureGate';
import { useAuth } from './auth/AuthProvider';

type TabId = 'dashboard' | 'fight' | 'inventory' | 'mastery' | 'profile';
type SubScreen = 'chest' | 'market' | 'settings' | 'help' | 'workshop' | null;
const topLevelTabs: TabId[] = ['dashboard', 'fight', 'inventory', 'mastery', 'profile'];

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
  const { user, loading, authError } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [bossSelectOpen, setBossSelectOpen] = useState(false);

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
    if (screen === 'loadout' || screen === 'loot' || screen === 'vendor' || screen === 'fusion') {
      setActiveTab('inventory');
      setSubScreen(null);
      return;
    }
    if (screen === 'skills') {
      setActiveTab('mastery');
      setSubScreen(null);
      return;
    }
    if (screen === 'more') {
      setActiveTab('profile');
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
      chest: <ChestScreen />,
      market: (
        <FeatureGate feature="market">
          <MarketScreen />
        </FeatureGate>
      ),
      settings: <SettingsScreen />,
      help: <HelpScreen />,
      workshop: <WorkshopScreen onNavigate={handleNavigate} />,
    };
    const title = subScreen === 'chest'
      ? 'Crack Cache'
      : subScreen === 'market'
        ? 'Vendor Yard'
        : subScreen === 'workshop'
          ? 'Workbench'
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
              ← Back
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

      {subScreen ? (
        renderSubScreen()
      ) : (
        <ScreenWrapper activeTab={activeTab}>
          {activeTab === 'dashboard' && <DashboardScreen onNavigate={handleNavigate} />}
          {activeTab === 'fight' && <ActionScreen onOpenBossSelect={() => setBossSelectOpen(true)} onNavigate={handleNavigate} />}
          {activeTab === 'inventory' && <InventoryScreen onNavigate={handleNavigate} />}
          {activeTab === 'mastery' && <MasteryScreen />}
          {activeTab === 'profile' && <ProfileScreen onNavigate={handleNavigate} />}
        </ScreenWrapper>
      )}

      <BottomNav activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setSubScreen(null); }} />
    </div>
  );
}

export default App;
