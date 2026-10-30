import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BESPOKE_LEGENDARY_SPRITES,
  PIXEL_AREA_BACKGROUNDS,
  bespokeSpriteIdForWeaponName,
  getPixelManifest,
  getPixelSprite,
  listPixelSprites,
} from '@/lib/pixel/manifest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pixelDir = join(repoRoot, 'src', 'assets', 'pixel');

function pngSize(buffer: Buffer): { width: number; height: number } {
  // IHDR: width/height are big-endian uint32 at bytes 16/20.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer: Buffer): { width: number; height: number } {
  // Scan markers for a Start Of Frame segment (C0/C1/C2).
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('No SOF marker found');
}

const REQUIRED_ANCHORS: Record<string, string[]> = {
  character: ['feet', 'centerMass', 'muzzle', 'lootPoint', 'grip'],
  enemy: ['feet', 'centerMass', 'lootPoint'],
  prop: ['feet', 'centerMass', 'lootPoint'],
  'weapon-legendary': ['muzzle', 'grip', 'centerMass', 'lootPoint'],
  background: ['groundLine'],
};

describe('pixel sprite manifest — integrity', () => {
  const manifest = getPixelManifest();

  it('has at least the P1 proof sprites registered', () => {
    for (const id of ['hunter', 'brute', 'crate', 'legendary-emberfall', 'zone-dustwaste-bg']) {
      expect(manifest.sprites[id], `missing sprite ${id}`).toBeDefined();
      expect(getPixelSprite(id)?.url).toBeTruthy();
    }
    expect(listPixelSprites().length).toBe(Object.keys(manifest.sprites).length);
  });

  it('every manifest file exists on disk with the declared dimensions', () => {
    for (const [id, entry] of Object.entries(manifest.sprites)) {
      const file = join(pixelDir, entry.src);
      expect(existsSync(file), `${id}: ${entry.src} missing`).toBe(true);
      const buffer = readFileSync(file);
      const size = entry.src.endsWith('.png') ? pngSize(buffer) : jpegSize(buffer);
      expect(size.width, `${id} width`).toBe(entry.width);
      expect(size.height, `${id} height`).toBe(entry.height);
    }
  });

  it('every sprite carries its kind’s required anchors, all normalized', () => {
    for (const [id, entry] of Object.entries(manifest.sprites)) {
      for (const anchorName of REQUIRED_ANCHORS[entry.kind] ?? []) {
        const anchor = entry.anchors[anchorName];
        expect(anchor, `${id} missing anchor ${anchorName}`).toBeDefined();
        expect(anchor.x).toBeGreaterThanOrEqual(0);
        expect(anchor.x).toBeLessThanOrEqual(1);
        expect(anchor.y).toBeGreaterThanOrEqual(0);
        expect(anchor.y).toBeLessThanOrEqual(1);
      }
      if (entry.kind !== 'background') {
        expect(entry.anchors.feet.y, `${id} feet anchor sits on the ground line`).toBe(1);
      }
    }
  });

  it('area + bespoke maps point at real sprites', () => {
    for (const spriteId of Object.values(PIXEL_AREA_BACKGROUNDS)) {
      expect(getPixelSprite(spriteId)?.kind).toBe('background');
    }
    for (const spriteId of Object.values(BESPOKE_LEGENDARY_SPRITES)) {
      expect(getPixelSprite(spriteId)?.kind).toBe('weapon-legendary');
    }
    expect(bespokeSpriteIdForWeaponName('Emberfall')).toBe('legendary-emberfall');
    expect(bespokeSpriteIdForWeaponName('Some Procedural Rifle')).toBeUndefined();
  });
});

describe('pixel-key.py pipeline', () => {
  const probe = (() => {
    try {
      execFileSync('python3', ['-c', 'import PIL'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!probe)('keys a magenta fixture to transparency with anchors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-key-'));
    const fixture = join(dir, 'fixture.png');
    const out = join(dir, 'fixture-keyed.png');
    execFileSync('python3', [
      '-c',
      `from PIL import Image
img = Image.new('RGB', (100, 80), (252, 0, 170))
for y in range(20, 60):
    for x in range(30, 70):
        img.putpixel((x, y), (200, 60, 40))
img.save('${fixture}')`,
    ]);
    const stdout = execFileSync('python3', [join(repoRoot, 'scripts', 'pixel-key.py'), fixture, out, '--max-height', '40'], {
      encoding: 'utf8',
    });
    const result = JSON.parse(stdout.trim());
    expect(result.width).toBe(40);
    expect(result.height).toBe(40);
    expect(result.anchors.feet).toEqual({ x: 0.5, y: 1 });
    expect(result.anchors.centerMass).toEqual({ x: 0.5, y: 0.5 });
    const verify = execFileSync(
      'python3',
      ['-c', `from PIL import Image; im = Image.open('${out}'); print(im.getpixel((0, 0))[3], im.getpixel((20, 20))[3])`],
      { encoding: 'utf8' },
    );
    expect(verify.trim()).toBe('0 255');
    expect(existsSync(join(dir, 'fixture-keyed.anchors.json'))).toBe(true);
    writeFileSync(join(dir, 'done.txt'), 'ok');
  });
});
