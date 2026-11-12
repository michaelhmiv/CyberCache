import React from 'react';

interface ScreenWrapperProps {
  /**
   * Keep-alive pane visibility (tab keep-alive, 2026-11-12): a
   * hidden pane stays MOUNTED — its screen keeps its state, its
   * scroll position, its canvases (the Pixi stage is NOT destroyed)
   * and its subscriptions — and is only removed from layout with
   * display:none. The previous contract animated a single pane's
   * keyed child in/out on every tab switch, unmounting the old
   * screen and mounting the new one from scratch.
   */
  hidden?: boolean;
  children: React.ReactNode;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ hidden = false, children }) => {
  return (
    <div
      className="relative flex-1 overflow-y-auto overflow-x-hidden bg-bg"
      style={hidden ? { display: 'none' } : undefined}
      aria-hidden={hidden || undefined}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,144,0,0.09),transparent_34%),radial-gradient(circle_at_90%_26%,rgba(255,75,92,0.06),transparent_28%)]" />
      <div className="relative min-h-full">{children}</div>
    </div>
  );
};
