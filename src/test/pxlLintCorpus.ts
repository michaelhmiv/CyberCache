/**
 * Pxl Craft Sweep S2 — the lint gate's seeded corpus.
 *
 * Real generated items only (brief hard floor 3, real-item
 * invariant): every entry is produced by the production item
 * generators on pinned seeds, mapped through the production
 * item → compose-input mappings, and rendered by the production
 * compositors at the densities each system actually ships at
 * (brief hard floor 6: weapons stage + card; gear kinds plate +
 * thumb; small items object + thumb).
 *
 * Determinism: the generators seed `pixelSeed` from the wall
 * clock and assign random item ids — and the relic / class-mod
 * input mappings derive their compose seed from the item id — so
 * each generated item's pixelSeed AND id are PINNED to fixed
 * per-slot values before mapping. The same items, byte for byte,
 * on every run and on both sides of the S1 bite comparison.
 */
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { CONSUMABLES } from '@/constants/consumables';
import { ESSENCE_VISUALS, MATERIAL_VISUALS } from '@/constants/visualAssets';
import { hashString } from '@/lib/utils/rng';
import { seededRandom } from '@/lib/weaponArt/decalSpec';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { generateShield } from '@/server/lib/generators/shieldGenerator';
import { generateOrdnance } from '@/server/lib/generators/ordnanceGenerator';
import { generateClassMod } from '@/server/lib/generators/classModGenerator';
import { generateRelic } from '@/server/lib/generators/relicGenerator';
import { composePixelWeapon, pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { composeWeaponCard } from '@/lib/pixel/weaponCardCompositor';
import { composeGear, type GearGrammar } from '@/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS } from '@/lib/pixel/gearDispatch';
import { composeConsumable } from '@/lib/pixel/consumableArt';
import { composeMaterial } from '@/lib/pixel/materialArt';
import type { BandingOptions, LintRender } from './pixelLint';

/**
 * Per-system banding configuration (consumed by lintBanding).
 * Line keys are each system's line-work — outline, rarity frame,
 * ground shadow, glint — which the march clause must not mistake
 * for body tone. Ramp groups / derived pairs name the tone sets
 * that derive from one base hex in that system's palette.
 *
 * 'weapon-pixel' is deliberately ABSENT (no banding gate):
 * S1's pixel-path treatment was selout only — its palette is the
 * master color mapping, pinned byte-exact by S1's palette-law
 * test, so its tones cannot travel in hue by design; and its
 * forms retire with the One Grammar slice (brief Amendment 1),
 * which moves the stage onto the card grammar this gate covers.
 * The pixel path still answers to the pxl rules (orphan / jaggy /
 * pillow / colors) in the gate suite.
 */
export const BANDING_BY_SYSTEM: Record<string, BandingOptions> = {
  'weapon-card': {
    lineKeys: new Set(['K', 'k', 'T', 'G']),
    marchGroups: [['D', 'd', 'P', 'p', 'L'], ['E', 'e', 'c'], ['w', 'u', 'v']],
    derivedPairs: [
      { derived: 'd', base: 'D', toward: 55 },
      { derived: 'L', base: 'p', toward: 55 },
      { derived: 'c', base: 'E', toward: 250 },
    ],
  },
  'gear-shield': { lineKeys: new Set(['K', 'k', 'F', 'f', 'T', 'W']), rampGroups: [['D', 'd', 'P', 'p', 'L']] },
  'gear-ordnance': { lineKeys: new Set(['K', 'k', 'F', 'f', 'T', 'W']), rampGroups: [['D', 'd', 'P', 'p', 'L']] },
  'gear-classMod': { lineKeys: new Set(['K', 'k', 'F', 'f', 'T', 'W']), rampGroups: [['D', 'd', 'P', 'p', 'L']] },
  'gear-relic': { lineKeys: new Set(['K', 'k', 'F', 'f', 'T', 'W']), rampGroups: [['D', 'd', 'P', 'p', 'L']] },
  consumable: {
    lineKeys: new Set(['K', 'S']),
    rampGroups: [['D', 'd', 'P', 'p', 'L'], ['A', 'a', 'E']],
  },
  material: {
    lineKeys: new Set(['K', 'S']),
    rampGroups: [['D', 'd', 'P', 'p', 'L'], ['A', 'a', 'E']],
  },
};

export interface CorpusEntry {
  /** Stable corpus id, e.g. 'weapon-card/sniper/fire/legendary'. */
  id: string;
  /** The in-scope system this render belongs to. */
  system: string;
  render: LintRender;
}

const rngFor = (slot: string) => seededRandom(hashString(`pxl-s2-corpus:${slot}`));

function weaponEntries(): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  const types = Object.values(WeaponType);
  const elements = [Element.Fire, Element.Shock, Element.Kinetic, Element.Void];
  const rarities = [Rarity.Common, Rarity.Epic, Rarity.Legendary];
  const makers = Object.values(Manufacturer);
  let n = 0;
  for (const type of types) {
    for (const element of elements) {
      for (const rarity of rarities) {
        n++;
        const slot = `weapon/${type}/${element}/${rarity}`;
        const weapon = generateWeapon(
          {
            source: DropSource.WorldDrop,
            level: 20,
            forcedType: type,
            forcedRarity: rarity,
            forcedElement: element,
            forcedManufacturer: makers[n % makers.length],
          },
          rngFor(slot),
        );
        weapon.pixelSeed = hashString(`pxl-s2:${slot}`);
        weapon.id = `pxl-s2-${slot}`;
        const input = pixelWeaponInputFromWeapon(weapon);
        out.push({ id: `weapon-pixel/${slot}`, system: 'weapon-pixel', render: composePixelWeapon(input) });
        out.push({ id: `weapon-card/${slot}`, system: 'weapon-card', render: composeWeaponCard(input) });
      }
    }
  }
  return out;
}

function gearEntries(
  kind: 'shield' | 'ordnance' | 'classMod' | 'relic',
  generate: (slot: string, rarity: Rarity) => { id: string } & object,
  count: number,
): CorpusEntry[] {
  const grammar: GearGrammar = GEAR_GRAMMARS[kind];
  const rarities = [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
  const out: CorpusEntry[] = [];
  for (let i = 0; i < count; i++) {
    const rarity = rarities[i % rarities.length];
    const slot = `${kind}/${i}/${rarity}`;
    const item = generate(slot, rarity);
    // ClassMod/Relic carry no pixelSeed field — their compose seeds derive
    // from item id (pinned on the next line); Shield/Ordnance read this one.
    (item as { pixelSeed?: number }).pixelSeed = hashString(`pxl-s2:${slot}`);
    item.id = `pxl-s2-${slot}`;
    const input = grammar.inputFromItem!(item as never);
    out.push({ id: `gear-card/${slot}`, system: `gear-${kind}`, render: composeGear(input, grammar, 'card') });
    out.push({ id: `gear-thumb/${slot}`, system: `gear-${kind}`, render: composeGear(input, grammar, 'thumb') });
  }
  return out;
}

function smallEntries(): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const id of Object.keys(CONSUMABLES)) {
    out.push({ id: `consumable/${id}`, system: 'consumable', render: composeConsumable(id, 'object') });
    out.push({ id: `consumable-thumb/${id}`, system: 'consumable', render: composeConsumable(id, 'thumb') });
  }
  const materialIds = [...Object.keys(MATERIAL_VISUALS), ...Object.keys(ESSENCE_VISUALS)];
  for (const id of materialIds) {
    out.push({ id: `material/${id}`, system: 'material', render: composeMaterial(id, 'object') });
    out.push({ id: `material-thumb/${id}`, system: 'material', render: composeMaterial(id, 'thumb') });
  }
  return out;
}

let cached: CorpusEntry[] | null = null;

export function buildCorpus(): CorpusEntry[] {
  if (cached) return cached;
  cached = [
    ...weaponEntries(),
    ...gearEntries('shield', (slot, rarity) => generateShield(20, rngFor(slot), { [rarity]: 1 }), 12),
    ...gearEntries('ordnance', (slot, rarity) => generateOrdnance(20, rngFor(slot), { [rarity]: 1 }), 10),
    ...gearEntries('classMod', (slot, rarity) => generateClassMod(20, rngFor(slot), { [rarity]: 1 }), 10),
    ...gearEntries('relic', (slot, rarity) => generateRelic(20, rngFor(slot), { [rarity]: 1 }), 10),
    ...smallEntries(),
  ];
  return cached;
}
