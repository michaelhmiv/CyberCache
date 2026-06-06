import { Element, Manufacturer, WeaponType } from '../../types/game';

const MANUFACTURER_PALETTES: Record<Manufacturer, string[]> = {
  [Manufacturer.Redline]: ['#7F1D1D', '#EF4444', '#FCA5A5', '#FFFFFF'],
  [Manufacturer.Ironwood]: ['#14532D', '#22C55E', '#86EFAC', '#E2E8F0'],
  [Manufacturer.BlastForge]: ['#78350F', '#F59E0B', '#FCD34D', '#FFFFFF'],
  [Manufacturer.Prismatek]: ['#581C87', '#A855F7', '#D8B4FE', '#FFFFFF'],
  [Manufacturer.ThrowTech]: ['#164E63', '#06B6D4', '#A5F3FC', '#E2E8F0'],
  [Manufacturer.HelixWorks]: ['#1E3A8A', '#3B82F6', '#93C5FD', '#FFFFFF'],
};

// Silhouette shape data: relative rectangles [x, y, w, h] for 64x64 grid
const TYPE_SHAPES: Record<WeaponType, number[][]> = {
  [WeaponType.Pistol]: [
    [28, 30, 24, 6], // barrel
    [16, 28, 12, 10], // body
    [12, 34, 8, 6], // grip
  ],
  [WeaponType.SMG]: [
    [28, 30, 30, 5], // long barrel
    [14, 28, 14, 8], // body
    [12, 32, 10, 10], // grip
    [36, 30, 10, 3], // mag
  ],
  [WeaponType.Shotgun]: [
    [26, 28, 18, 8], // wide barrel
    [14, 28, 12, 10], // body
    [10, 32, 10, 8], // grip
  ],
  [WeaponType.Sniper]: [
    [24, 30, 36, 4], // very long barrel
    [14, 28, 10, 8], // body
    [10, 32, 10, 8], // grip
    [24, 34, 8, 6], // mag
  ],
  [WeaponType.Launcher]: [
    [26, 26, 20, 12], // bulky barrel
    [14, 28, 12, 10], // body
    [10, 32, 10, 10], // grip
    [28, 32, 10, 8], // mag
  ],
  [WeaponType.Beam]: [
    [28, 30, 24, 4], // slim barrel
    [14, 28, 14, 8], // body
    [12, 32, 8, 10], // grip
    [28, 34, 10, 4], // energy cell
  ],
};

function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function applyShading(ctx: CanvasRenderingContext2D, rects: number[][], palette: string[]) {
  rects.forEach((rect, idx) => {
    const [x, y, w, h] = rect;
    // Base
    drawRect(ctx, x, y, w, h, palette[1]);
    // Shadow (bottom-right)
    drawRect(ctx, x + w - 2, y, 2, h, palette[0]);
    drawRect(ctx, x, y + h - 2, w, 2, palette[0]);
    // Highlight (top-left)
    drawRect(ctx, x, y, w, 1, palette[2]);
    drawRect(ctx, x, y, 1, h, palette[2]);
    // Accent edge on some rects
    if (idx === 0) {
      drawRect(ctx, x + w - 1, y, 1, h, palette[3]);
    }
  });
}

function drawElementOverlay(
  ctx: CanvasRenderingContext2D,
  element: Element,
  time: number,
  rects: number[][]
) {
  const muzzle = rects[0]; // barrel rect
  const mx = muzzle[0] + muzzle[2];
  const my = muzzle[1];

  switch (element) {
    case Element.Fire: {
      const count = 3 + Math.floor(Math.sin(time / 200) * 2);
      for (let i = 0; i < count; i++) {
        const fx = mx + (Math.random() * 4 - 2);
        const fy = my - (Math.random() * 6);
        drawRect(ctx, fx, fy, 1, 1, Math.random() > 0.5 ? '#EF4444' : '#FBBF24');
      }
      break;
    }
    case Element.Shock: {
      if (Math.floor(time / 400) % 2 === 0) {
        const sx = muzzle[0] + Math.random() * muzzle[2];
        const sy = muzzle[1] + Math.random() * muzzle[3];
        const ex = muzzle[0] + Math.random() * muzzle[2];
        const ey = muzzle[1] + Math.random() * muzzle[3];
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      break;
    }
    case Element.Corrosive: {
      const dripCount = 2;
      for (let i = 0; i < dripCount; i++) {
        const dx = muzzle[0] + (i * 8);
        const dy = (muzzle[1] + ((time / 600 + i) % 3) * 2);
        drawRect(ctx, dx, dy, 1, 1, '#22C55E');
      }
      break;
    }
    case Element.Cryo: {
      const crystals = [
        [muzzle[0] - 2, muzzle[1]],
        [muzzle[0] + muzzle[2], muzzle[1] + muzzle[3] - 2],
      ];
      crystals.forEach(([cx, cy]) => {
        const alpha = 0.5 + Math.sin(time / 500) * 0.3;
        ctx.fillStyle = `rgba(6, 182, 212, ${alpha})`;
        ctx.fillRect(cx, cy, 2, 2);
      });
      break;
    }
    case Element.Void: {
      const glitchX = muzzle[0] + Math.floor(Math.random() * muzzle[2]);
      const glitchY = muzzle[1] + Math.floor(Math.random() * muzzle[3]);
      ctx.fillStyle = '#8B5CF6';
      ctx.fillRect(glitchX, glitchY, 2, 1);
      break;
    }
    case Element.Kinetic: {
      // Metallic scanline
      const scanY = (Math.floor(time / 50) % muzzle[3]) + muzzle[1];
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(muzzle[0], scanY, muzzle[2], 1);
      break;
    }
  }
}

export function renderWeaponSprite(
  canvas: HTMLCanvasElement,
  type: WeaponType,
  manufacturer: Manufacturer,
  element: Element,
  rarity: string,
  time: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Setup pixelated rendering
  canvas.width = 64;
  canvas.height = 64;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);

  const palette = MANUFACTURER_PALETTES[manufacturer];
  const rects = TYPE_SHAPES[type];

  // Draw base weapon shape with shading
  applyShading(ctx, rects, palette);

  // Draw element overlay
  drawElementOverlay(ctx, element, time, rects);

  // Rarity shimmer for Legendary
  if (rarity === 'Legendary') {
    const shimmerX = (Math.floor(time / 80) % 64);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fillRect(shimmerX, 0, 4, 64);
  }
}
