// Reveal-hold capture backstop (dash/reveal-hold-shots, dev only).
// The real ChestScreen talks to the Chef through the real
// verifiedOps/http transport; in the stills rig there is no Chef,
// so this fetch backstop answers the two calls the cache-open flow
// makes: the lane read (GET /caches/me) with the seeded key stock,
// and the open itself (POST /ops/make-item) with one fixed
// Legendary grant — Emberfall, the named legendary the component
// suites use, carrying its bespoke painting, the Glass Sun effect
// banner, its hand-written flavor line, and (round 2, 2026-11-20)
// the LARGEST deck shape the reveal can show: an activity module
// strip plus four regular affix lines, so the one-screen fit proof
// runs against the worst case. Every other /api/ call 503s fast
// (the offline pattern from the store-shots round); the op's
// fire-and-forget runtime snapshot save fails silently by design.
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

export const CAPTURE_LEGENDARY: Weapon = {
  id: 'shots-emberfall',
  name: 'Emberfall',
  level: 12,
  rarity: Rarity.Legendary,
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Fire,
  rollQuality: 88,
  baseDamage: 4210,
  attackSpeed: 1.1,
  critChance: 0.22,
  critDamage: 2.4,
  statusChance: 0.3,
  statusDamage: 120,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: {} },
    { slot: 'Core', modifier: {} },
    { slot: 'Magazine', modifier: {} },
    { slot: 'Sight', modifier: { critChance: 1.1 } },
    { slot: 'Chamber', modifier: {} },
  ],
  affixes: [
    { id: 'af-1', category: 'combat', stat: 'critChance', value: 0.12, displayText: '+12% Crit Chance' },
    { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 0.09, displayText: '+9% Boss Damage' },
    { id: 'af-3', category: 'combat', stat: 'attackSpeed', value: 0.07, displayText: '+7% Attack Speed' },
    { id: 'af-4', category: 'idle', stat: 'scrapYieldMod', value: 0.1, displayText: '+10% Scrap Yield' },
    {
      id: 'activity_salvaging_weapon',
      category: 'activity',
      stat: 'salvagingModule',
      value: 0.97,
      subStats: { salvageYield: 0.227, rareMaterialChance: 0.075, essenceExtraction: 0.097 },
      displayText: 'Salvage Module [97%] · +22.7% Salvage Yield · +7.5% Rare Material · +9.7% Essence Yield',
    },
  ],
  legendaryEffectId: 'glass_sun',
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 7,
  combatPower: 900,
  bossPower: 950,
  farmPower: 400,
  economyScore: 50,
} as Weapon;

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

export function installChestBackstop() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/ops/make-item')) {
      return json({
        item: { id: CAPTURE_LEGENDARY.id, is_locked: false, payload: { ...CAPTURE_LEGENDARY } },
        cache_lane: { keys: 2, rule: '' },
        profile: { cache_tokens: 2 },
      });
    }
    if (url.includes('/caches/me')) {
      return json({ keys: 3, rule: '' });
    }
    if (url.includes('/api/')) {
      return json({ error: 'harness offline' }, 503);
    }
    return realFetch(input, init);
  };
}
