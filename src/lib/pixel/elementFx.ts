import { Element, WeaponType } from '@/types/game';

/**
 * Element FX dialects (visual overhaul brief §4.6) — one visual
 * language per element across tracer, impact, and muzzle, with the
 * cadence derived from the actual weapon instance (its type and its
 * rolled attack speed), never from the archetype alone.
 */
export interface ElementDialect {
  element: Element;
  tracerColor: string;
  /** Second color for gradients/trails. */
  tracerTrailColor: string;
  /** SVG stroke dash pattern for the tracer (undefined = solid). */
  tracerDash?: string;
  tracerWidth: number;
  impactColor: string;
  /** Status overlay sprite left on the target after a hit. */
  statusSpriteId: string;
  muzzleColor: string;
  muzzleScale: number;
}

export const ELEMENT_DIALECTS: Record<Element, ElementDialect> = {
  [Element.Kinetic]: {
    element: Element.Kinetic,
    tracerColor: '#E8E4D8',
    tracerTrailColor: '#9a958a',
    tracerWidth: 2,
    impactColor: '#FFC65C',
    statusSpriteId: 'status-kinetic',
    muzzleColor: '#FFE9A8',
    muzzleScale: 0.8,
  },
  [Element.Fire]: {
    element: Element.Fire,
    tracerColor: '#FF7A1A',
    tracerTrailColor: '#FFD166',
    tracerDash: '7 3',
    tracerWidth: 3,
    impactColor: '#FF7A1A',
    statusSpriteId: 'status-fire',
    muzzleColor: '#FFB35C',
    muzzleScale: 1.15,
  },
  [Element.Shock]: {
    element: Element.Shock,
    tracerColor: '#78DCFF',
    tracerTrailColor: '#C8F2FF',
    tracerDash: '3 3',
    tracerWidth: 2,
    impactColor: '#78DCFF',
    statusSpriteId: 'status-shock',
    muzzleColor: '#AEE9FF',
    muzzleScale: 0.9,
  },
  [Element.Corrosive]: {
    element: Element.Corrosive,
    tracerColor: '#9BE15D',
    tracerTrailColor: '#5d8f3e',
    tracerWidth: 3,
    impactColor: '#9BE15D',
    statusSpriteId: 'status-corrosive',
    muzzleColor: '#C4F28A',
    muzzleScale: 1.0,
  },
  [Element.Cryo]: {
    element: Element.Cryo,
    tracerColor: '#BEF0FF',
    tracerTrailColor: '#7fb8d8',
    tracerWidth: 2,
    impactColor: '#BEF0FF',
    statusSpriteId: 'status-cryo',
    muzzleColor: '#E2F6FF',
    muzzleScale: 0.85,
  },
  [Element.Void]: {
    element: Element.Void,
    tracerColor: '#B18CFF',
    tracerTrailColor: '#5b3ea8',
    tracerDash: '10 4',
    tracerWidth: 3,
    impactColor: '#B18CFF',
    statusSpriteId: 'status-void',
    muzzleColor: '#D3B8FF',
    muzzleScale: 1.1,
  },
};

export function elementDialect(element: Element | undefined): ElementDialect {
  return ELEMENT_DIALECTS[element ?? Element.Kinetic] ?? ELEMENT_DIALECTS[Element.Kinetic];
}

export interface ShotCadence {
  /** Tracers rendered per shot beat (shotgun pellets, SMG bursts). */
  tracerCount: number;
  /** Vertical spread between tracers, in stage % points. */
  spreadPct: number;
  /** Muzzle-flash repeats within the beat. */
  muzzlePulses: number;
}

/**
 * Cadence from the instance: weapon type sets the pattern, the rolled
 * attack speed scales the burst density. A slow sniper fires one heavy
 * tracer; a fast SMG stitches three.
 */
export function shotCadence(weaponType: WeaponType | undefined, attackSpeed: number | undefined): ShotCadence {
  const speed = attackSpeed ?? 1;
  switch (weaponType) {
    case WeaponType.Shotgun:
      return { tracerCount: 4, spreadPct: 2.4, muzzlePulses: 1 };
    case WeaponType.SMG:
      return { tracerCount: speed >= 1.3 ? 3 : 2, spreadPct: 0.8, muzzlePulses: 2 };
    case WeaponType.Beam:
      return { tracerCount: 1, spreadPct: 0, muzzlePulses: 3 };
    case WeaponType.Sniper:
      return { tracerCount: 1, spreadPct: 0, muzzlePulses: 1 };
    case WeaponType.Launcher:
      return { tracerCount: 1, spreadPct: 0, muzzlePulses: 1 };
    case WeaponType.Pistol:
    default:
      return { tracerCount: speed >= 1.5 ? 2 : 1, spreadPct: 0.5, muzzlePulses: 1 };
  }
}
