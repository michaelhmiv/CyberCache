/**
 * Skill-node icons — the wiring between skill defs and the pixel
 * sprite registry (icon-tree build, owner-approved 2026-11-18).
 *
 * Every one of the 88 skill nodes owns one medallion icon: a
 * function glyph embossed on a dark riveted octagonal medallion,
 * generated on magenta, keyed and palette-capped through the
 * repo's pixel pipeline (128×128 canonical). The assets live in
 * the sprite registry like every other sprite — files under
 * src/assets/pixel/sprites/skill-<node-id>.png, entries in
 * manifest.json under the `skill-icon` kind — and resolve through
 * manifest.ts, never through per-screen imports.
 *
 * Sprite id convention: `skill-` + the node id with underscores
 * turned to hyphens (fix_craft_time_1 → skill-fix-craft-time-1).
 * The prep packages that produced the set (and their per-node
 * glyph manifest) live in cybercache-prep/cache-hunters/
 * first-screen-fix/trees-icons/ (+ icons-production/MANIFEST.md).
 */
import { getPixelSprite } from './manifest';

export function skillNodeSpriteId(nodeId: string): string {
  return `skill-${nodeId.replace(/_/g, '-')}`;
}

/** The node's medallion icon URL, or undefined if unregistered. */
export function skillNodeIconUrl(nodeId: string): string | undefined {
  return getPixelSprite(skillNodeSpriteId(nodeId))?.url;
}
