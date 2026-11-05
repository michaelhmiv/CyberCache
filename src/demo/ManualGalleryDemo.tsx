/**
 * Demo harness for the Field Manual variant C prototype ("The
 * Exhibition"). Mounted by main.tsx at /manual-gallery so the
 * variant can be captured at phone width without the auth
 * bootstrap, the Chef, or the router. PROTOTYPE ONLY.
 *
 *   ?view=index (default) · ?view=tour&step=2 · ?view=section&section=bosses
 *
 * The frame keeps the real BottomNav below (Hunter active) and
 * lets the exhibition run edge to edge above it — no top bar, no
 * switcher: the wall label is the page head. Fonts are served
 * locally (see fonts.css): this sandbox's Chromium cannot reach
 * Google Fonts.
 */
import './fonts.css';
import { BottomNav } from '@/components/layout/BottomNav';
import { ManualGalleryPage } from './ManualGalleryPage';

export default function ManualGalleryDemo() {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const initialView =
    viewParam === 'tour' || viewParam === 'section' ? viewParam : ('index' as const);
  const stepParam = Number(params.get('step') ?? 2);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-bg text-text-primary">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <ManualGalleryPage
          initialView={initialView}
          initialSection={params.get('section') ?? 'loot'}
          initialTourStep={Number.isFinite(stepParam) ? stepParam : 2}
        />
      </main>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
}
