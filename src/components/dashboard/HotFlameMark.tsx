import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';

/**
 * The hot-area mark (owner steer 2026-11-13): a small animated flame
 * riding beside the Active Area name in the roaming workspace panel,
 * shown only while the hunter roams the day's hot area — the pennant
 * treatments were rejected as unreadable, and the Stop-button seat
 * was superseded the same day by the area name below the stage, the
 * label the player's eye already reads for "where am I". Two frames
 * of the one icon sheet: the shipped 'flame' glyph and its
 * 'flameFlick' twin (identical outer teardrop, the inner highlight
 * core seated higher), alternating at a 350 ms cadence. Tinted the
 * hot-area red the AreaPicker's flame marker already wears
 * (#E2483D). Reduced motion renders the shipped glyph static — no
 * interval is ever armed.
 */
export const HotFlameMark: React.FC<{ reduced: boolean }> = ({ reduced }) => {
  const [flick, setFlick] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setFlick((f) => !f), 350);
    return () => window.clearInterval(id);
  }, [reduced]);
  return (
    <span data-testid="hot-flame-mark" data-frame={flick ? 'b' : 'a'} aria-hidden="true" className="flex items-center text-[#E2483D]">
      <PxIcon name={flick ? 'flameFlick' : 'flame'} size={20} />
    </span>
  );
};
