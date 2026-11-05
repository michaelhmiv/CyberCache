import React from 'react';
import { CollectionsDossier } from '@/components/profile/CollectionsDossier';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
import { collectionEntriesForFamily } from '@/content/collections';

/**
 * CollectionsDossierDemo — DESIGN PASS capture harness (prototype
 * branch only, never merged). Mounted from main.tsx when the URL
 * carries ?collections-dossier. Renders the real CollectionsDossier
 * with a fixture payload shaped exactly like GET
 * /api/collections/me: keys drawn from the shipped catalog itself,
 * sources from the game's real discovery vocabulary ('Boss Drop',
 * 'Cache-Forged', 'World Drop', 'Marketplace', 'boss_victory',
 * 'elite_kill'), so every render derives from real definitions
 * through the shipped compositors — no drawn substitutes, no
 * invented entries. Same fixture state as the variant-A wall —
 * 9/25 effects, 5/13 bosses, 12/36 frames (two makers per weapon
 * type), 3/7 elites, 7 cores, 29/81 — so the five variants are
 * judged on composition, not on different data.
 */
function buildFixturePayload(): CollectionsPayload {
  const discoveries: CollectionsPayload['discoveries'] = [];
  const push = (family: string, entry_key: string, source: string, discovered_at: string) =>
    discoveries.push({ family, entry_key, source, discovered_at });

  const itemSources = ['Boss Drop', 'Cache-Forged', 'World Drop', 'Marketplace'];
  collectionEntriesForFamily('legendary_effect')
    .slice(0, 9)
    .forEach((e, i) => push('legendary_effect', e.key, itemSources[i % itemSources.length], '2026-10-28T14:12:00.000Z'));

  collectionEntriesForFamily('boss')
    .slice(0, 5)
    .forEach((e) => push('boss', e.key, 'boss_victory', '2026-10-30T09:41:00.000Z'));

  const frames = collectionEntriesForFamily('weapon_frame');
  const byType = new Map<string, typeof frames>();
  for (const f of frames) {
    const type = f.key.split(':')[0];
    byType.set(type, [...(byType.get(type) ?? []), f]);
  }
  for (const list of byType.values()) {
    list.slice(0, 2).forEach((e, i) => push('weapon_frame', e.key, itemSources[(i + 1) % itemSources.length], '2026-11-01T18:03:00.000Z'));
  }

  ['dustwaste_frontier', 'redline_circuit', 'ironwood_bastion'].forEach((key) =>
    push('named_elite', key, 'elite_kill', '2026-11-02T21:27:00.000Z'),
  );

  return { legendary_cores: 7, discoveries };
}

export const CollectionsDossierDemo: React.FC = () => (
  <div className="min-h-screen bg-bg">
    <CollectionsDossier payload={buildFixturePayload()} coresFallback={7} error={null} onRetry={() => {}} />
  </div>
);
