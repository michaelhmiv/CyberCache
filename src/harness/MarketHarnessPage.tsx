/**
 * Market harness page (store-screenshots round,
 * dash/store-shots — dev only) — the REAL Market tab
 * (MarketScreen) at phone width inside the real ScreenWrapper
 * scroller with the real BottomNav under it (Market active),
 * for the App Store screenshot set. The screen's own mount fetch
 * is answered by marketMain's backstop with the seed module's
 * real-shaped browse page (inspectSeed MARKET_PAGE: 8 player
 * listings — the legendary Ricochet Gospel target listing, four
 * comparables, and three filler listings from named sellers), so
 * the rows on screen are the game's real listing rows rendered
 * from real-shaped market data. Auth resolves through the
 * harness stub (vite.shots.config.ts). Nothing here is imported
 * by the app bundle; market-harness.html is served by the Vite
 * dev server only.
 */
import React from 'react';
import { MarketScreen } from '@/screens/MarketScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { usePlayerStore } from '@/store';

usePlayerStore.setState({
  id: 'p1',
  level: 24,
  xp: 41200,
  credits: 128400,
  scrap: 56200,
  cacheKeys: 5,
  materials: {},
  essences: {},
  consumables: {},
  profileLoaded: true,
} as never);

export const MarketHarnessPage: React.FC = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="market-harness-root"
  >
    <ScreenWrapper hidden={false}>
      <MarketScreen onNavigate={() => {}} />
    </ScreenWrapper>
    <BottomNav activeTab="market" onChange={() => {}} />
  </div>
);
