import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BottomNav } from './components/layout/BottomNav';
import { ScreenWrapper } from './components/layout/ScreenWrapper';
import { FightScreen } from './screens/FightScreen';
import { LoadoutScreen } from './screens/LoadoutScreen';
import { LootScreen } from './screens/LootScreen';
import { MarketScreen } from './screens/MarketScreen';
import { MoreScreen } from './screens/MoreScreen';
import { SkillTreeScreen } from './screens/SkillTreeScreen';
import { ChestScreen } from './screens/ChestScreen';
import { FusionScreen } from './screens/FusionScreen';
import { VendorScreen } from './screens/VendorScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { WorkshopScreen } from './screens/WorkshopScreen';
import { BossSelectModal } from './components/fight/BossSelectModal';

type TabId = 'fight' | 'loadout' | 'loot' | 'market' | 'more';
type SubScreen = 'chest' | 'skills' | 'fusion' | 'vendor' | 'profile' | 'settings' | 'help' | 'workshop' | null;

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('fight');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [bossSelectOpen, setBossSelectOpen] = useState(false);

  const handleNavigate = (screen: string) => {
    setSubScreen(screen as SubScreen);
  };

  const handleBack = () => {
    setSubScreen(null);
  };

  // Sub-screen content renderer (header + back button preserved)
  const renderSubScreen = () => {
    const screens: Record<string, React.ReactNode> = {
      chest: <ChestScreen />,
      skills: <SkillTreeScreen />,
      fusion: <FusionScreen />,
      vendor: <VendorScreen />,
      profile: <ProfileScreen />,
      settings: <SettingsScreen />,
      help: <HelpScreen />,
      workshop: <WorkshopScreen />,
    };
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
          <button onClick={handleBack} className="text-sm text-amber font-bold">← Back</button>
          <div className="text-sm font-bold text-text-primary capitalize">{subScreen}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {screens[subScreen!] || <div className="p-4 text-text-primary">Unknown screen</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-text-primary" style={{ maxWidth: 480, margin: '0 auto' }}>
      {/* Modal overlays — full screen, hide nav */}
      <AnimatePresence>
        {bossSelectOpen && (
          <BossSelectModal onClose={() => setBossSelectOpen(false)} />
        )}
      </AnimatePresence>

      {/* Main content area — keeps bottom nav visible */}
      {subScreen ? (
        renderSubScreen()
      ) : (
        <ScreenWrapper activeTab={activeTab}>
          {activeTab === 'fight' && <FightScreen onOpenBossSelect={() => setBossSelectOpen(true)} />}
          {activeTab === 'loadout' && <LoadoutScreen />}
          {activeTab === 'loot' && <LootScreen />}
          {activeTab === 'market' && <MarketScreen />}
          {activeTab === 'more' && <MoreScreen onNavigate={handleNavigate} />}
        </ScreenWrapper>
      )}

      {/* Bottom nav always visible except during full-screen modals */}
      <BottomNav activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setSubScreen(null); }} />
    </div>
  );
}

export default App;
