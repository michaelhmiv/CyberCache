/**
 * ChipRail — horizontally scrollable filter chip row with an overflow
 * affordance (faded edge + › glyph) when chips extend past the viewport.
 */
import React, { useEffect, useRef, useState } from 'react';

interface ChipRailProps {
  children: React.ReactNode;
  className?: string;
}

export const ChipRail: React.FC<ChipRailProps> = ({ children, className = '' }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    const sentinel = sentinelRef.current;
    if (!track || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsOverflowing(!entry.isIntersecting),
      { root: track, threshold: 1 },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [children]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={trackRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide"
      >
        {children}
        <div ref={sentinelRef} className="shrink-0 w-px h-px" aria-hidden="true" />
      </div>
      {isOverflowing && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end bg-gradient-to-l from-bg to-transparent pr-1">
          <span className="text-xs font-black text-text-muted">›</span>
        </div>
      )}
    </div>
  );
};
