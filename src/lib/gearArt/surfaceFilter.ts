/**
 * Map a VisualAsset texture name to the corresponding SVG surface filter ID.
 * Returns undefined for textures that don't have a dedicated filter.
 */
export function surfaceFilterId(texture?: string): string | undefined {
  switch (texture) {
    case 'metal': return 'surface-metal';
    case 'crystal': return 'surface-crystal';
    case 'energy': return 'surface-energy';
    case 'ordnance': return 'surface-ordnance';
    case 'data': return 'surface-data';
    case 'organic': return 'surface-organic';
    case 'liquid': return 'surface-liquid';
    default: return undefined;
  }
}
