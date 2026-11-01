/**
 * SheetPortal — renders sheet/modal overlays at the document root.
 *
 * Why (flow-fix F17): every tab screen lives inside ScreenWrapper's
 * framer-motion container, which animates `transform: translateX` on
 * tab switches. A `position: fixed` element anchors to the viewport
 * ONLY when no ancestor carries a transform — during the transition
 * (and under any future transformed ancestor) fixed sheets anchor to
 * the container instead, which on long pages is far taller than the
 * viewport, so the sheet opens off-screen. At rest framer-motion
 * settles to `transform: none`, so the hazard is a window, not a
 * constant — portaling removes the whole class by construction,
 * the same pattern BossSelectModal and DeathOverlay already use by
 * living at the App root.
 */
import React from 'react';
import { createPortal } from 'react-dom';

export const SheetPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};
