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

type TabId = 'fight' | 'loadout' | 'loot' | 'market' | 'more';
type SubScreen = 'chest' | 'skills' | 'fusion' | 'vendor' | 'profile' | 'settings' | 'help' | null;

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('fight');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);

  const handleNavigate = (screen: string) => {
    setSubScreen(screen as SubScreen);
  };

  const handleBack = () => {
    setSubScreen(null);
  };

  // Sub-screen renderer
  if (subScreen) {
    const screens: Record<string, React.ReactNode> = {
      chest: <ChestScreen />,
      skills: <SkillTreeScreen />,
      fusion: <FusionScreen />,
      vendor: <VendorScreen />,
      profile: <div className="p-4 text-text-primary">Profile coming soon</div>,
      settings: <div className="p-4 text-text-primary">Settings coming soon</div>,
      help: <div className="p-4 text-text-primary">Guide coming soon</div>,
    };
    return (
      <div className="h-screen flex flex-col bg-bg text-text-primary">
        <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
          <button onClick={handleBack} className="text-sm text-amber font-bold">← Back</button>
          <div className="text-sm font-bold text-text-primary capitalize">{subScreen}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {screens[subScreen] || <div className="p-4 text-text-primary">Unknown screen</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-text-primary">
      <ScreenWrapper activeTab={activeTab}>
        {activeTab === 'fight' && <FightScreen />}
        {activeTab === 'loadout' && <LoadoutScreen />}
        {activeTab === 'loot' && <LootScreen />}
        {activeTab === 'market' && <MarketScreen />}
        {activeTab === 'more' && <MoreScreen onNavigate={handleNavigate} />}
      </ScreenWrapper>
      <BottomNav activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setSubScreen(null); }} />
    </div>
  );
}

export default App;
