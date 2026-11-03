/**
 * Weapon-marriage sample renderer (slice 1 working script).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-weapon-marriage-samples.ts <outDir>
 *
 * Rasterizes the production card compositor's renders to PNG cells
 * in <outDir>: the 36 maker×type identities (Kinetic/Common/clean),
 * an element ladder, a rarity ladder, and a couple of part-variant
 * rolls. Sheets are assembled from these cells by
 * scripts/assemble-weapon-marriage-sheets.py.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Manufacturer, Rarity, WeaponType } from '../src/types/game';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import { composeWeaponCard, type WeaponCardRender } from '../src/lib/pixel/weaponCardCompositor';
import type { PixelWeaponInput } from '../src/lib/pixel/weaponCompositor';

const outDir = process.argv[2] ?? '/tmp/weapon-marriage-cells';
mkdirSync(outDir, { recursive: true });

const BG: [number, number, number] = [13, 15, 20];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rasterize(render: WeaponCardRender, scale: number): RgbaImage {
  const width = render.width * scale;
  const height = render.height * scale;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = BG[0]; data[i * 4 + 1] = BG[1]; data[i * 4 + 2] = BG[2]; data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const shade = render.rows[y][x];
      if (shade === '.') continue;
      const color = render.colors[shade as keyof typeof render.colors];
      if (!color) continue;
      const [r, g, b] = hexToRgb(color);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = (x * scale + dx) + (y * scale + dy) * width;
        data[px * 4] = r; data[px * 4 + 1] = g; data[px * 4 + 2] = b; data[px * 4 + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function save(name: string, input: PixelWeaponInput, scale = 2) {
  const render = composeWeaponCard(input);
  writeFileSync(join(outDir, `${name}.png`), encodePng(rasterize(render, scale)));
  console.log(`${name}: sig=${render.signature} cond=${render.condition} decals=${render.decals.length}`);
  return render;
}

const base = { element: Element.Kinetic, rarity: Rarity.Common, rollQuality: 75, pixelSeed: 1234 } satisfies Partial<PixelWeaponInput>;

// 36 identities
for (const type of Object.values(WeaponType)) {
  for (const maker of Object.values(Manufacturer)) {
    save(`id-${type}-${maker}`, { ...base, weaponType: type, manufacturer: maker, id: `id-${type}-${maker}` });
  }
}
// Element ladder — Redline Sniper + Ironwood SMG
for (const el of Object.values(Element)) {
  save(`el-sniper-redline-${el}`, { ...base, weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Redline, element: el, id: `el-s-${el}` });
  save(`el-smg-ironwood-${el}`, { ...base, weaponType: WeaponType.SMG, manufacturer: Manufacturer.Ironwood, element: el, id: `el-i-${el}` });
}
// Rarity ladder — BlastForge Shotgun + Prismatek Beam (Fire)
for (const rar of Object.values(Rarity)) {
  save(`rar-shotgun-blastforge-${rar}`, { ...base, weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.BlastForge, rarity: rar, id: `rar-b-${rar}` });
  save(`rar-beam-prismatek-${rar}`, { ...base, weaponType: WeaponType.Beam, manufacturer: Manufacturer.Prismatek, element: Element.Fire, rarity: rar, id: `rar-p-${rar}` });
}
// Part-variant rolls — same maker×type, different rolled parts
const part = (slot: string, mod: string) => ({
  id: `p-${slot}-${mod}`, name: `${slot} ${mod}`, slot: slot as never, rarity: Rarity.Rare,
  modifier: { [mod]: 3 }, damage: 10, fireRate: 2, value: 100,
});
for (const mod of ['alpha', 'beta', 'gamma']) {
  save(`var-helixsmg-${mod}`, {
    ...base, weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks, rarity: Rarity.Rare,
    id: `var-${mod}`,
    parts: ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'].map((slot) => part(slot, mod)) as never,
  });
}
// Theme proof — wasteland bone on the Ironwood sniper
{
  const render = composeWeaponCard(
    { ...base, weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Ironwood, id: 'theme-bone' },
    'wasteland-bone',
  );
  writeFileSync(join(outDir, 'theme-wasteland-bone.png'), encodePng(rasterize(render, 2)));
  console.log(`theme-wasteland-bone: sig=${render.signature}`);
}
console.log('done');
