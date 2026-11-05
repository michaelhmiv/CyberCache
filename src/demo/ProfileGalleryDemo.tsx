/**
 * Demo harness for the Profile variant C prototype ("The
 * Retrospective"). Mounted by main.tsx at /profile-demo so the
 * variant can be captured at phone width without the auth
 * bootstrap, the Chef, or the router. PROTOTYPE ONLY.
 *
 * The frame matches variant A's capture conditions: the real
 * DashboardTopBar above, the real BottomNav below (Hunter active),
 * the page scrolling between them. Stores are seeded with the
 * shared fixture (identical facts to variant A) so every
 * store-driven piece — portrait, totals sheet, top strip — renders
 * its genuine output. Fonts are served locally (see fonts.css):
 * this sandbox's Chromium cannot reach Google Fonts.
 */
import { useMemo } from 'react';
import './fonts.css';
import { BottomNav } from '@/components/layout/BottomNav';
import { DashboardTopBar } from '@/components/dashboard/DashboardTopBar';
import { ProfileGalleryPage } from './subpages/ProfileGalleryPage';
import {
  STATS_FIXTURE,
  buildDeathLogFixture,
  buildLifetimeFixture,
  buildSnapshotsFixture,
  generateFixtureWeapons,
  seedFixtureStores,
} from './profileFixtures';

export default function ProfileGalleryDemo() {
  const weapons = useMemo(() => generateFixtureWeapons(), []);
  seedFixtureStores(weapons);
  const lifetime = useMemo(() => buildLifetimeFixture(weapons), [weapons]);
  const snapshots = useMemo(() => buildSnapshotsFixture(), []);
  const deathLog = useMemo(() => buildDeathLogFixture(), []);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-bg text-text-primary">
      <DashboardTopBar onNavigate={() => {}} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <ProfileGalleryPage
          stats={STATS_FIXTURE}
          lifetime={lifetime}
          snapshots={snapshots}
          deathLog={deathLog}
          weapons={weapons}
        />
      </main>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
}
