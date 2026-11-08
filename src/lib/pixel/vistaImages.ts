/**
 * Vista ambient image cache — the one HTMLImage cache both stage
 * renderers paint ambient sprites from (DOM canvases directly, the
 * Pixi stage through canvas textures). Images load lazily from the
 * manifest; a sprite joins the paint map once it has actually
 * loaded, so a slow asset never blanks a frame.
 */
import { getPixelSprite } from './manifest';
import type { VistaAmbientInstance, VistaImageSource } from './vistaAmbient';

const cache = new Map<string, HTMLImageElement>();

export function vistaImageMapFor(instances: VistaAmbientInstance[]): Map<string, VistaImageSource> {
  const out = new Map<string, VistaImageSource>();
  for (const inst of instances) {
    if (out.has(inst.spriteId)) continue;
    let img = cache.get(inst.spriteId);
    if (!img) {
      const entry = getPixelSprite(inst.spriteId);
      if (!entry || typeof Image === 'undefined') continue;
      img = new Image();
      img.src = entry.url;
      cache.set(inst.spriteId, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      out.set(inst.spriteId, { width: img.naturalWidth, height: img.naturalHeight, source: img });
    }
  }
  return out;
}
