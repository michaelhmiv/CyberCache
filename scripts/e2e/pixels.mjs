/**
 * Pixel-region statistics for the browser gates (Lane 1 e2e + the
 * fleet browser session).
 *
 * The production build exposes no stage instrumentation (the Pixi
 * probe surfaces are import.meta.env.DEV-gated), so presence checks
 * read the one thing a broken build cannot fake: the rendered pixels.
 * A PNG screenshot buffer is decoded INSIDE the page (blob URL ->
 * Image -> canvas -> getImageData) so this module needs no image
 * library — the same decode path the game itself ships.
 *
 * Region stats vocabulary:
 *  - modalShare: fraction of sampled pixels equal (within tolerance)
 *    to the region's most common colour. A smooth vista gradient sits
 *    high; an actor standing in the region breaks it up.
 *  - nonBgMass: fraction of sampled pixels FAR from the modal colour.
 *    This is the "something is standing here" signal.
 *  - distinct: number of distinct sampled colours (quantised). Actors
 *    carry palettes; empty sky/ground does not.
 *  - meanLuma: average luminance 0..255 (black-stage tripwire: a
 *    stranded blank stage reads ~0 across every region).
 */

export async function decodeRegionStats(page, pngBuffer, region) {
  const base64 = pngBuffer.toString('base64');
  return page.evaluate(
    async ({ base64, region }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const x0 = Math.floor(region.x * canvas.width);
        const y0 = Math.floor(region.y * canvas.height);
        const w = Math.max(1, Math.floor(region.w * canvas.width));
        const h = Math.max(1, Math.floor(region.h * canvas.height));
        const data = ctx.getImageData(x0, y0, w, h).data;
        const step = 4 * 7; // sample every 7th pixel — plenty for mass stats
        const counts = new Map();
        let samples = 0;
        let lumaSum = 0;
        const pixels = [];
        for (let i = 0; i < data.length; i += step) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          pixels.push([r, g, b]);
          lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          samples++;
        }
        let modalKey = null;
        let modalCount = 0;
        for (const [key, count] of counts) {
          if (count > modalCount) {
            modalCount = count;
            modalKey = key;
          }
        }
        const [mr, mg, mb] = modalKey.split(',').map((v) => (Number(v) << 4) + 8);
        let nonBg = 0;
        for (const [r, g, b] of pixels) {
          const dist = Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);
          if (dist > 90) nonBg++;
        }
        return {
          samples,
          distinct: counts.size,
          modalShare: samples ? modalCount / samples : 0,
          nonBgMass: samples ? nonBg / samples : 0,
          meanLuma: samples ? lumaSum / samples : 0,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { base64, region },
  );
}

/**
 * Capture a clip of the page via CDP, bypassing Playwright's
 * screenshot pipeline: both of its waits are wrong for a live game
 * stage — element captures wait for a "stable" (un-animating)
 * element (round 2: 19.6 s timeout), and page captures wait for
 * webfonts to settle (round 3: 30 s timeout). A CDP
 * Page.captureScreenshot takes the surface as it is.
 */
export async function captureClipPng(page, box) {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      const { data } = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
      });
      return Buffer.from(data, 'base64');
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    return page.screenshot({ clip: box });
  }
}

/** Screenshot an element and compute stats for a fractional region of it. */
export async function elementRegionStats(page, locator, region) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('elementRegionStats: element has no bounding box (detached?)');
  const png = await captureClipPng(page, box);
  return decodeRegionStats(page, png, region);
}

/**
 * Cheap whole-image change hash: downscale-sampled luma signature.
 * Two captures of a live stage differ; two captures of a frozen or
 * blank stage do not. Computed in-page from a PNG buffer.
 */
export async function imageSignature(page, pngBuffer) {
  const base64 = pngBuffer.toString('base64');
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 48, 48);
      const data = ctx.getImageData(0, 0, 48, 48).data;
      let sig = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        sig = ((sig * 31) + luma) | 0;
      }
      return sig;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, base64);
}

/** Mean absolute luma distance between two signatures' sources is not
 * recoverable from a hash — use this when you need a distance: it
 * returns the 48x48 luma grid itself (2,304 numbers). */
export async function imageLumaGrid(page, pngBuffer) {
  const base64 = pngBuffer.toString('base64');
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 48, 48);
      const data = ctx.getImageData(0, 0, 48, 48).data;
      const grid = [];
      for (let i = 0; i < data.length; i += 4) {
        grid.push(Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]));
      }
      return grid;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, base64);
}

export function gridDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
