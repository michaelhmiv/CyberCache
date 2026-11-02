/**
 * Collections — the 81 discoverable entries in their four families.
 * Owner: src/content/collections.ts, whose COLLECTION_ENTRIES are
 * themselves derived from the effect defs, the boss roster, the
 * weapon frames, and the named elites — this page renders that one
 * derived list, so it agrees with the in-game shelf by construction.
 */
import { COLLECTION_ENTRIES, collectionEntriesForFamily, NAMED_ELITES } from '../../src/content/collections';
import { WEAPON_TYPES } from '../../src/constants/weaponTypes';
import { MANUFACTURERS } from '../../src/constants/manufacturers';
import { ROAMING_AREAS } from '../../src/constants/roamingAreas';
import { type GenBlock, table } from './lib';

function collectionsBody(): string {
  const effects = collectionEntriesForFamily('legendary_effect');
  const bosses = collectionEntriesForFamily('boss');
  const frames = collectionEntriesForFamily('weapon_frame');
  const elites = collectionEntriesForFamily('named_elite');

  const frameRows = Object.values(WEAPON_TYPES).map((t) => {
    const cells = Object.values(MANUFACTURERS).map(
      (m) => frames.find((f) => f.key === `${t.id}:${m.id}`)?.name ?? '—',
    );
    return [`**${t.name}**`, ...cells];
  });

  const eliteRows = NAMED_ELITES.map((e) => [
    `**${e.eliteName}**`,
    ROAMING_AREAS.find((a) => a.id === e.areaId)?.name ?? e.areaId,
  ]);

  return [
    `**${COLLECTION_ENTRIES.length} entries** in four families: ${effects.length} legendary effects, ${bosses.length} bosses, ${frames.length} weapon frames, ${elites.length} named elites.`,
    '',
    '### Legendary effects',
    '',
    table(['Entry', 'How it is found'], effects.map((e) => [`**${e.name}**`, e.hint])),
    '',
    '### Bosses',
    '',
    table(['Entry', 'How it is found'], bosses.map((e) => [`**${e.name}**`, e.hint])),
    '',
    '### Weapon frames',
    '',
    'A frame is collected when a Legendary of that exact type × manufacturer is obtained.',
    '',
    table(['Type \\ Maker', ...Object.values(MANUFACTURERS).map((m) => m.name)], frameRows),
    '',
    '### Named elites',
    '',
    table(['Entry', 'Area'], eliteRows),
  ].join('\n');
}

export const collectionsBlock: GenBlock = {
  id: 'collections',
  owners: ['src/content/collections.ts'],
  render: collectionsBody,
};
