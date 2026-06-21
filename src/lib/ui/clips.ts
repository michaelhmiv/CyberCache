/**
 * clips — shared Borderlands-style polygon clip paths used by sheets,
 * cards, and option rows across the UI.
 */

export const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' } as const;
export const chipClip = { clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' } as const;
export const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' } as const;
