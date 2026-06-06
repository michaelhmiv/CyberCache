import { Element } from '../types/game';

export interface ElementDef {
  id: Element;
  name: string;
  color: string;
  strongAgainst: string[];
  weakAgainst: string[];
  description: string;
}

export const ELEMENTS: Record<Element, ElementDef> = {
  [Element.Kinetic]: {
    id: Element.Kinetic,
    name: 'Kinetic',
    color: '#9CA3AF',
    strongAgainst: [],
    weakAgainst: [],
    description: 'Neutral. No major strength or weakness. Reliable baseline.',
  },
  [Element.Fire]: {
    id: Element.Fire,
    name: 'Fire',
    color: '#EF4444',
    strongAgainst: ['flesh', 'organic'],
    weakAgainst: ['shield', 'fire-resistant'],
    description: 'Strong against flesh/organic. Applies burn DoT. Weak against shield-heavy.',
  },
  [Element.Shock]: {
    id: Element.Shock,
    name: 'Shock',
    color: '#3B82F6',
    strongAgainst: ['shield'],
    weakAgainst: ['armor', 'shock-resistant'],
    description: 'Strong against shields. Helps shield break checks. Weak against heavy armor.',
  },
  [Element.Corrosive]: {
    id: Element.Corrosive,
    name: 'Corrosive',
    color: '#22C55E',
    strongAgainst: ['armor', 'mechanical'],
    weakAgainst: ['flesh', 'shield'],
    description: 'Strong against armor/mechanical. Helps armor break and anti-repair.',
  },
  [Element.Cryo]: {
    id: Element.Cryo,
    name: 'Cryo',
    color: '#06B6D4',
    strongAgainst: ['fast', 'enrage'],
    weakAgainst: ['armor', 'cryo-resistant'],
    description: 'Slows or staggers. Helps against fast bosses and enrage mechanics.',
  },
  [Element.Void]: {
    id: Element.Void,
    name: 'Void',
    color: '#8B5CF6',
    strongAgainst: ['elite', 'boss'],
    weakAgainst: ['consistent'],
    description: 'High variance, curse, delayed burst. Powerful but less consistent.',
  },
};

export function getElementMatchup(element: Element, targetType: string): number {
  const def = ELEMENTS[element];
  if (def.strongAgainst.includes(targetType)) return 1.3;
  if (def.weakAgainst.includes(targetType)) return 0.7;
  return 1.0;
}
