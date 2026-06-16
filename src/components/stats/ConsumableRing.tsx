import React, { memo } from 'react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

// The fallback below catches a `ConsumableVisual.accent` value that exists
// at runtime but isn't in this map (forward-compat safety). If the
// ConsumableVisual union grows, TypeScript will require this map to
// enumerate the new value — which is the correct behavior: a missing
// entry should fail at compile time, not silently fall through to a
// hard-coded colour.
const accentClass: Record<ConsumableVisual['accent'], string> = {
  green: '#7CFC00',
  red: '#FF4B5C',
  orange: '#FF9000',
  cyan: '#00E5FF',
  amber: '#FFB300',
  purple: '#B66BFF',
  blue: '#5AA7FF',
};

export const ConsumableRing = memo(function ConsumableRing({
  consumables,
  onClick,
  size = 56,
}: {
  consumables: LoadoutConsumables;
  onClick: () => void;
  size?: number;
}) {
  const loaded = SLOT_ORDER.map((slot) => {
    const id = consumables[slot];
    if (!id) return null;
    const def = CONSUMABLES[id];
    if (!def) return null;
    return { slot, def };
  }).filter(
    (entry): entry is { slot: keyof LoadoutConsumables; def: typeof CONSUMABLES[string] } => Boolean(entry)
  );

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r - 8;

  if (loaded.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-consumable-ring
        data-consumable-empty
        aria-label="No consumables loaded. Tap to manage."
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2A2F3A" strokeWidth="2" />
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#2A2F3A" strokeWidth="1" />
        </svg>
      </button>
    );
  }

  const sliceAngle = 360 / loaded.length;
  let cursor = -90; // start at 12 o'clock

  return (
    <button
      type="button"
      onClick={onClick}
      data-consumable-ring
      aria-label={`${loaded.length} consumable${loaded.length === 1 ? '' : 's'} loaded. Tap to manage.`}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {loaded.map(({ slot, def }) => {
          const startRad = (cursor * Math.PI) / 180;
          const endRad = ((cursor + sliceAngle) * Math.PI) / 180;
          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          const x3 = cx + innerR * Math.cos(endRad);
          const y3 = cy + innerR * Math.sin(endRad);
          const x4 = cx + innerR * Math.cos(startRad);
          const y4 = cy + innerR * Math.sin(startRad);
          const largeArc = sliceAngle > 180 ? 1 : 0;
          const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
          cursor += sliceAngle;
          const color = accentClass[def.visual.accent];
          return (
            <path
              key={slot}
              d={d}
              fill={color}
              fillOpacity="0.78"
              stroke="#000"
              strokeWidth="1.5"
              data-consumable-slice={slot}
              data-consumable-id={def.id}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={innerR - 2} fill="#050608" />
        <text x={cx} y={cy + 3} textAnchor="middle" fill="#FF9000" fontSize={size * 0.22} fontWeight="900">
          {loaded.length}
        </text>
      </svg>
    </button>
  );
});
