import React from 'react';

/**
 * Shared SVG filter definitions for procedural gear illustrations.
 * Include <SharedDefs /> inside an SVG <defs> block to make all surface
 * texture filters available by ID.
 *
 * Filter IDs use the pattern `surface-{texture}`:
 *   - surface-metal    — brushed steel / alloy with specular sheen
 *   - surface-crystal  — refractive faceted look
 *   - surface-energy   — bright inner glow with hot specular
 *   - surface-ordnance — rough cast military texture
 *   - surface-data     — digital / circuit-like micro-texture
 *   - surface-organic  — soft fibrous / biological texture
 *   - surface-liquid   — glossy fluid with droplet highlights
 *
 * Additional utility filters:
 *   - bevel-sm         — subtle 3D bevel (inner shadow)
 *   - bevel-lg         — pronounced 3D bevel
 *   - wear-scratches   — procedural scratch overlay (driven by rollQuality)
 */
export const SharedDefs: React.FC = () => (
  <>
    {/* ===== SURFACE TEXTURES ===== */}

    {/* Metal: horizontal brushed grain + specular lighting */}
    <filter id="surface-metal" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.6 0.04"
        numOctaves="4"
        seed="3"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.06  0 0 0 0 0.06  0 0 0 0 0.06  0 0 0 0.18 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="SourceGraphic" result="textured" />
      <feSpecularLighting
        surfaceScale="2.5"
        specularConstant="0.5"
        specularExponent="18"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="200" y="50" z="160" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feMerge>
        <feMergeNode in="textured" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* Crystal: internal refraction + bright specular */}
    <filter id="surface-crystal" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.04"
        numOctaves="3"
        seed="7"
        result="noise"
      />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" result="displaced" />
      <feSpecularLighting
        surfaceScale="4"
        specularConstant="0.7"
        specularExponent="8"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="180" y="40" z="200" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="displaced" result="specMasked" />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.04  0 0 0 0 0.04  0 0 0 0 0.04  0 0 0 0.12 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="displaced" result="grainMasked" />
      <feMerge>
        <feMergeNode in="displaced" />
        <feMergeNode in="specMasked" />
        <feMergeNode in="grainMasked" />
      </feMerge>
    </filter>

    {/* Energy: inner glow + hot specular + blur halo */}
    <filter id="surface-energy" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.08"
        numOctaves="3"
        seed="11"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0.22 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="SourceGraphic" result="textured" />
      <feSpecularLighting
        surfaceScale="5"
        specularConstant="0.8"
        specularExponent="4"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="160" y="30" z="220" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="glow" />
      <feMerge>
        <feMergeNode in="textured" />
        <feMergeNode in="glow" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* Ordnance: rough cast texture with subtle specular */}
    <filter id="surface-ordnance" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.3"
        numOctaves="5"
        seed="13"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.05  0 0 0 0 0.05  0 0 0 0 0.05  0 0 0 0.28 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="SourceGraphic" result="textured" />
      <feSpecularLighting
        surfaceScale="1.8"
        specularConstant="0.3"
        specularExponent="12"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="150" y="60" z="120" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feMerge>
        <feMergeNode in="textured" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* Data: digital micro-texture with sharp specular */}
    <filter id="surface-data" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.9 0.06"
        numOctaves="4"
        seed="17"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.04  0 0 0 0 0.08  0 0 0 0 0.04  0 0 0 0.14 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="SourceGraphic" result="textured" />
      <feSpecularLighting
        surfaceScale="3"
        specularConstant="0.6"
        specularExponent="6"
        lightingColor="#88ddff"
        in="noise"
        result="specular"
      >
        <fePointLight x="170" y="30" z="180" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feMerge>
        <feMergeNode in="textured" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* Organic: soft fibrous texture */}
    <filter id="surface-organic" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.5 0.03"
        numOctaves="4"
        seed="19"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.05  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 0.10 0"
        in="noise"
        result="grain"
      />
      <feComposite operator="in" in="grain" in2="SourceGraphic" result="textured" />
      <feSpecularLighting
        surfaceScale="1.2"
        specularConstant="0.25"
        specularExponent="20"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="160" y="50" z="140" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feMerge>
        <feMergeNode in="textured" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* Liquid: glossy with droplet highlights */}
    <filter id="surface-liquid" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.15 0.02"
        numOctaves="3"
        seed="23"
        result="noise"
      />
      <feSpecularLighting
        surfaceScale="6"
        specularConstant="0.9"
        specularExponent="3"
        lightingColor="#ffffff"
        in="noise"
        result="specular"
      >
        <fePointLight x="180" y="35" z="240" />
      </feSpecularLighting>
      <feComposite operator="in" in="specular" in2="SourceGraphic" result="specMasked" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="specMasked" />
      </feMerge>
    </filter>

    {/* ===== BEVEL EFFECTS ===== */}

    {/* Subtle inner bevel for raised panels */}
    <filter id="bevel-sm" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodColor="#000" floodOpacity="0.5" />
      <feDropShadow dx="0" dy="-1" stdDeviation="0.5" floodColor="#fff" floodOpacity="0.15" />
    </filter>

    {/* Pronounced 3D bevel for structural plates */}
    <filter id="bevel-lg" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.55" />
      <feDropShadow dx="-1" dy="-1" stdDeviation="0.8" floodColor="#fff" floodOpacity="0.12" />
    </filter>

    {/* ===== WEAR / CONDITION ===== */}

    {/* Procedural scratch overlay — intensity controlled by opacity */}
    <filter id="wear-scratches" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="1.2 0.01"
        numOctaves="5"
        seed="29"
        result="noise"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0"
        in="noise"
        result="scratches"
      />
      <feComposite operator="in" in="scratches" in2="SourceGraphic" result="scratchMask" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="scratchMask" />
      </feMerge>
    </filter>
  </>
);

/**
 * Map a VisualAsset texture name to the corresponding surface filter ID.
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
