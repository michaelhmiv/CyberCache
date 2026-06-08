import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BottomNav } from './components/layout/BottomNav';
import { ScreenWrapper } from './components/layout/ScreenWrapper';
import { DashboardScreen } from './screens/DashboardScreen';
import { FightScreen } from './screens/FightScreen';
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
    ? 'Email verification is required to use marketplace, shops, services, and social features.'
    : 'Verify your email to unlock trading, shops, and player services.';

  return (
    <div className="shrink-0 mx-3 mt-3 rounded-xl border border-amber/60 bg-amber/10 px-3 py-2 text-xs text-amber flex items-center justify-between gap-3">
      <span>{copy}</span>
      <button
        onClick={() => markVerificationReminderSeen()}
        disabled={actionLoading}
        className="shrink-0 rounded-lg border border-amber/70 px-2 py-1 text-[10px] font-black hover:bg-amber hover:text-bg disabled:opacity-50"
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
      <div className="h-full flex items-center justify-center bg-bg text-text-primary p-4">
        <div className="text-center space-y-2">
          <div className="bl-title text-3xl text-amber">CyberCache</div>
          <div className="text-xs text-text-muted">Loading session…</div>
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
      ? 'Data Cache'
      : subScreen === 'market'
        ? 'Market'
        : subScreen === 'workshop'
          ? 'Workshop'
          : subScreen;

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 p-4 border-b-2 border-border bg-surface flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleBack}
            className="text-sm text-amber font-bold hover:text-amber/80 active:text-amber/60 transition-colors"
          >
            ← Back
          </motion.button>
          <div className="bl-title text-xl leading-none text-text-primary capitalize">{title}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {screens[subScreen!] || <div className="p-4 text-text-primary">Unknown screen</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-bg text-text-primary">
      <AnimatePresence>
        {bossSelectOpen && (
          <BossSelectModal onClose={() => setBossSelectOpen(false)} />
        )}
      </AnimatePresence>

      {authError && (
        <div className="shrink-0 mx-3 mt-3 rounded-xl border border-red-500/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          {authError}
        </div>
      )}
      <VerificationReminderBanner />

      {subScreen ? (
        renderSubScreen()
      ) : (
        <ScreenWrapper activeTab={activeTab}>
          {activeTab === 'dashboard' && <DashboardScreen onNavigate={handleNavigate} />}
          {activeTab === 'fight' && <FightScreen onOpenBossSelect={() => setBossSelectOpen(true)} onNavigate={handleNavigate} />}
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
