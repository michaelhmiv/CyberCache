/**
 * Boss Visual Registry — sigils, colors, and visual identity for every boss.
 *
 * Each boss gets a derived visual identity from its tags, tier, and element.
 * The sigil is a short glyph/mark that instantly identifies the boss in
 * selection lists, fight modals, and the diorama. Colors derive from the
 * boss's primary tag archetype so the visual language is consistent.
 *
 * Used by BossSelectModal, BossEncounterPanel, and the LiveTurfDiorama.
 */
import type { BossTag } from '@/types/boss';
import { Element } from '@/types/game';

export interface BossVisual {
  id: string;
  sigil: string;
  color: string;
  accentColor: string;
  archetype: 'organic' | 'mechanical' | 'hybrid';
  description: string;
}

/** Map dominant tag → visual archetype + color palette */
const TAG_VISUALS: Partial<Record<BossTag, { color: string; archetype: BossVisual['archetype'] }>> = {
  organic: { color: '#7CFC00', archetype: 'organic' },
  mechanical: { color: '#3B82F6', archetype: 'mechanical' },
  shield: { color: '#06B6D4', archetype: 'mechanical' },
  armor: { color: '#A855F7', archetype: 'mechanical' },
  enrage: { color: '#FF4B1F', archetype: 'organic' },
  burn: { color: '#FF4B1F', archetype: 'organic' },
  phase: { color: '#8B5CF6', archetype: 'hybrid' },
  repair: { color: '#F59E0B', archetype: 'mechanical' },
  regen: { color: '#22C55E', archetype: 'organic' },
  swarm: { color: '#FFEA3A', archetype: 'organic' },
  siege: { color: '#FF9000', archetype: 'mechanical' },
  evasive: { color: '#06B6D4', archetype: 'hybrid' },
  burstCheck: { color: '#FF4B5C', archetype: 'organic' },
  attrition: { color: '#FF6B35', archetype: 'organic' },
  multiPhase: { color: '#A855F7', archetype: 'hybrid' },
};

/** Element → accent color for weakness hints */
const ELEMENT_ACCENT: Partial<Record<Element, string>> = {
  [Element.Kinetic]: '#F5F5F5',
  [Element.Fire]: '#FFEA3A',
  [Element.Shock]: '#A5F3FC',
  [Element.Corrosive]: '#C4FF2F',
  [Element.Cryo]: '#E0F2FE',
  [Element.Void]: '#FF9DF5',
};

function deriveArchetype(tags: BossTag[]): BossVisual['archetype'] {
  if (tags.includes('mechanical') && tags.includes('organic')) return 'hybrid';
  if (tags.includes('mechanical')) return 'mechanical';
  if (tags.includes('organic')) return 'organic';
  // Infer from combat tags
  if (tags.some(t => ['shield', 'armor', 'repair', 'siege'].includes(t))) return 'mechanical';
  return 'organic';
}

function deriveColor(tags: BossTag[], archetype: BossVisual['archetype']): string {
  // Find the first tag that has a visual mapping
  for (const tag of tags) {
    const visual = TAG_VISUALS[tag];
    if (visual) return visual.color;
  }
  // Fallback by archetype
  return archetype === 'mechanical' ? '#3B82F6' : archetype === 'hybrid' ? '#A855F7' : '#7CFC00';
}

function deriveSigil(name: string): string {
  // Build a 2-3 char sigil from the boss name
  const words = name.replace(/^(The|Gromm,\s*)/i, '').trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  // Single word — take first two chars
  return name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
}

const REGISTRY: Record<string, BossVisual> = {};

export function registerBossVisual(
  id: string,
  name: string,
  tier: number,
  tags: BossTag[],
  weaknesses: Element[],
): BossVisual {
  if (REGISTRY[id]) return REGISTRY[id];

  const archetype = deriveArchetype(tags);
  const color = deriveColor(tags, archetype);
  const accentColor = weaknesses.length > 0
    ? (ELEMENT_ACCENT[weaknesses[0]] ?? color)
    : color;
  const sigil = deriveSigil(name);
  const descriptions: Record<BossVisual['archetype'], string> = {
    organic: 'Biological threat. Weak to ballistic and elemental damage.',
    mechanical: 'Armored construct. Shields and repair cycles expected.',
    hybrid: 'Anomalous entity. Phase shifts and mixed defenses.',
  };

  const visual: BossVisual = {
    id,
    sigil,
    color,
    accentColor,
    archetype,
    description: descriptions[archetype],
  };
  REGISTRY[id] = visual;
  return visual;
}

/** Static registry for all known bosses. Import this to avoid re-deriving. */
export const BOSS_VISUALS: Record<string, BossVisual> = {
  dune_tyrant: { id: 'dune_tyrant', sigil: 'DT', color: '#7CFC00', accentColor: '#F5F5F5', archetype: 'organic', description: 'Tutorial boss. Biological threat with no special defense.' },
  siltstalker: { id: 'siltstalker', sigil: 'SS', color: '#FF4B1F', accentColor: '#FFEA3A', archetype: 'organic', description: 'Enrage predator. Burns hard at 50% HP.' },
  heap_guard: { id: 'heap_guard', sigil: 'HG', color: '#06B6D4', accentColor: '#A5F3FC', archetype: 'mechanical', description: 'Shielded sentinel with rapid regen cycles.' },
  ashgut: { id: 'ashgut', sigil: 'AG', color: '#FF4B1F', accentColor: '#C4FF2F', archetype: 'organic', description: 'Burning attrition fight. Sustained damage needed.' },
  mirage_duster: { id: 'mirage_duster', sigil: 'MD', color: '#8B5CF6', accentColor: '#A5F3FC', archetype: 'hybrid', description: 'Phase-shifting evasive target with shield backup.' },
  rust_prophet: { id: 'rust_prophet', sigil: 'RP', color: '#F59E0B', accentColor: '#C4FF2F', archetype: 'mechanical', description: 'Armored repair platform. Corrosive counter essential.' },
  scrap_bishop: { id: 'scrap_bishop', sigil: 'SB', color: '#FF9000', accentColor: '#C4FF2F', archetype: 'mechanical', description: 'Three-phase siege engine. Full counter spread required.' },
  spinneret_widow: { id: 'spinneret_widow', sigil: 'W9', color: '#9BE15D', accentColor: '#FFEA3A', archetype: 'mechanical', description: 'Loom-armed salvage spider. Her overclock punishes slow kills.' },
  mnemosyne_mirror: { id: 'mnemosyne_mirror', sigil: 'MM', color: '#8B5CF6', accentColor: '#F5F5F5', archetype: 'hybrid', description: 'Adaptive mirror construct. Attunes to your primary weapon.' },
  static_choir: { id: 'static_choir', sigil: 'SC', color: '#FFEA3A', accentColor: '#E0F2FE', archetype: 'mechanical', description: 'Broadcast choir behind a harmonic shroud. Stagger breaks the chord.' },
  verdant_maw: { id: 'verdant_maw', sigil: 'VM', color: '#A855F7', accentColor: '#FFEA3A', archetype: 'organic', description: 'Living heartwood armor over a furnace heart. Armor break is the fight.' },
  sister_null: { id: 'sister_null', sigil: 'SN', color: '#8B5CF6', accentColor: '#FF9DF5', archetype: 'hybrid', description: 'Void anchor cultist. Status pressure collapses her rift.' },
  vaultkeeper_omega: { id: 'vaultkeeper_omega', sigil: 'VO', color: '#FF9000', accentColor: '#FF9DF5', archetype: 'mechanical', description: 'Warden of the First Cache. Siege layers over a final overclock.' },
};

export function getBossVisual(id: string): BossVisual {
  return BOSS_VISUALS[id] ?? {
    id,
    sigil: id.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '??',
    color: '#B8B0A8',
    accentColor: '#34303A',
    archetype: 'organic',
    description: 'Unknown boss entity.',
  };
}
