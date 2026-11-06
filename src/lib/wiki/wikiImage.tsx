/**
 * wikiImage — the Field Manual's image components (split out of
 * wikiMarkdown.tsx so that file exports no components —
 * react-refresh/only-export-components — and this one exports
 * nothing else).
 *
 * Images are lazy: a reference resolves its asset URL when the
 * page that contains it renders, and only then do its bytes move.
 * Until the URL lands, an LCD well of the same footprint holds the
 * space; a reference with no file behind it prints its alt text,
 * the renderer's one honest fallback.
 */
import React from 'react';
import { CK } from '@/components/profile/manualConsoleTokens';
import { getWikiImageUrl, hasWikiImage, resolveWikiImage } from './wikiCorpus';

export function WikiImg({ rel, alt, width, inTable }: { rel: string; alt?: string; width?: number; inTable?: boolean }) {
  const known = hasWikiImage(rel);
  const [url, setUrl] = React.useState<string | undefined>(() => getWikiImageUrl(rel));
  React.useEffect(() => {
    if (url || !known) return undefined;
    let live = true;
    void resolveWikiImage(rel).then((resolved) => {
      if (live && resolved) setUrl(resolved);
    });
    return () => {
      live = false;
    };
  }, [rel, url, known]);

  if (!known) {
    return (
      <span className="text-[12px] italic" style={{ color: CK.label }}>
        [image: {alt ?? rel}]
      </span>
    );
  }
  if (inTable) {
    const w = Math.min(width ?? 40, 48);
    if (!url) {
      return (
        <span
          className="block"
          style={{ width: w, height: w, background: CK.lcd, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9)' }}
        />
      );
    }
    return <img src={url} alt={alt ?? ''} width={w} height={w} className="block" style={{ imageRendering: 'auto' }} loading="lazy" />;
  }
  if (!url) {
    return (
      <span
        className="flex h-[120px] w-full items-center justify-center text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ background: CK.lcd, color: CK.label, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9)' }}
      >
        {alt ? `Image — ${alt}` : 'Image'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      className="block h-auto w-full"
      style={{ maxWidth: width ? `${width}px` : undefined }}
      loading="lazy"
    />
  );
}

/** External-link marker: a small instrument tag, never an emoji. */
export const ExtChip: React.FC = () => (
  <span
    className="ml-1 inline-block px-1 align-middle text-[11px] font-bold uppercase tracking-[0.1em]"
    style={{ color: CK.amber, boxShadow: `inset 0 0 0 1px ${CK.amber}` }}
  >
    Ext
  </span>
);
