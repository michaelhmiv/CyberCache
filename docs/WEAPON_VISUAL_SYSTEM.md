# Weapon Visual System

CyberCache weapon art is deterministic procedural SVG, not stored one-off generated images.

## Storage decision

Normal weapon images are not stored in Supabase Storage. The persisted item record stores gameplay data plus `pixelSeed`, and the client renders the same image from that data every time.

Supabase Storage should be reserved for curated static art, future share-card exports, user uploads, or hand-authored event art. It should not be used for every generated item thumbnail.

## Readability hierarchy

At a glance, a weapon should communicate:

1. Weapon type through silhouette.
2. Rarity through frame/glow/stamp treatment.
3. Element through visible energy/paint effect.
4. Manufacturer through body language, palette, and mark.
5. Special/legendary status through decals and aura.

On closer inspection, it can communicate:

1. Part variation through attachments.
2. Roll quality through condition/polish marks.
3. Affix categories through small decals.
4. Source tag through card metadata.
5. Lock/equipped/listed state through UI badges.

## Files

- `src/constants/visualAssets.ts`: central visual registry for elements, manufacturers, materials, essences, gear types, resources, drop sources, and consumables.
- `src/constants/weaponVisuals.ts`: weapon-specific visual grammar: silhouettes, manufacturer styles, rarity frames, part slots, and affix decal colors.
- `src/lib/weaponArt/buildWeaponVisualSpec.ts`: deterministic spec builder from a `Weapon` record.
- `src/components/weapon/WeaponIllustration.tsx`: scalable SVG renderer.
- `src/components/common/VisualBadge.tsx`: reusable badge renderer for registered visuals.
- `src/components/common/GearIcon.tsx`: unified gear icon component.
- `src/components/common/MaterialBadge.tsx`: material/essence badge renderer.

## Rules

- No `Math.random()` inside rendering.
- Same weapon data must always produce the same image.
- Do not encode every stat visually; use visual hierarchy.
- Add new materials/manufacturers/elements through the visual registry, not local emoji maps.
- Keep SVG readable at mobile thumbnail size before adding showcase detail.
