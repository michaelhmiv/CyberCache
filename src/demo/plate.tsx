/**
 * plate.tsx — PROTOTYPE primitives (design/hunter-subpages-wardrobe-manual,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Arena Plates grammar the owner approved for the Hunter tab
 * (pass-2 anchor: hunter-menu-captures-2/look-plates), factored out so
 * the Wardrobe and Field Manual prototypes are machined from the same
 * stock as the menu: clipped corners, 2px black frame + steel inset
 * hairline, corner bolts, bone-white ink on a near-black scrim, numbers
 * in inset gauge wells, and a 4px FOOT strip — never a colored side
 * bar. Amber means "an action is waiting" and nothing else.
 */
import React from 'react';

export const BONE = '#F5EFE6';
export const BONE_MUTED = '#C9BBA6';
export const BONE_FAINT = '#968A78';
export const STEEL = '#6B6257';
export const STEEL_DARK = '#3A352C';
export const AMBER = '#FF9000';
export const IRON = '#0C0A08';

export const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

export const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};

/** A lighter page plate (the Manual's pages): same machining, less mass. */
export const pageShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(165deg, #191410 0%, #100D0A 60%, #0B0908 100%)',
  boxShadow: '3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 1px rgba(163,152,134,0.22)',
};

/** Machined corner bolts — 5px squares, black with a steel top edge. */
export const Bolts: React.FC = () => (
  <>
    {['left-[7px] top-[7px]', 'right-[7px] top-[7px]', 'bottom-[7px] left-[7px]', 'bottom-[7px] right-[7px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.5)' }}
        />
      ),
    )}
  </>
);

/** The plate's base rail — the boss plate's element strip, worn on the foot. */
export const FootStrip: React.FC<{ color?: string; height?: number }> = ({ color = STEEL_DARK, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

/** An inset well that carries a number like a gauge. */
export const Gauge: React.FC<{
  value: React.ReactNode;
  label?: string;
  tone?: string;
  className?: string;
}> = ({ value, label, tone = BONE, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center px-2 py-1 ${className}`}
    style={{ border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.82)' }}
  >
    <span className="text-[17px] font-black leading-none" style={{ color: tone }}>
      {value}
    </span>
    {label && (
      <span className="mt-0.5 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
        {label}
      </span>
    )}
  </div>
);

/** A rubber-stamp tag — the Manual's section marks. Bone by default;
 *  amber only where the stamp is an action waiting (the tour). */
export const Stamp: React.FC<{ children: React.ReactNode; amber?: boolean; tilt?: boolean }> = ({
  children,
  amber = false,
  tilt = true,
}) => (
  <span
    className="inline-block px-2 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
    style={{
      border: `2.5px solid ${amber ? AMBER : BONE_MUTED}`,
      color: amber ? AMBER : BONE,
      transform: tilt ? 'rotate(-2deg)' : undefined,
      backgroundColor: 'rgba(6,5,4,0.55)',
    }}
  >
    {children}
  </span>
);
