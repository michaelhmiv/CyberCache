/**
 * wikiMarkdown — PROTOTYPE subset markdown renderer
 * (design/field-manual-wiki-native, 2026-11-05; NEVER shipped).
 *
 * The repo has no markdown library, so this renders the wiki corpus'
 * actual constructs to React elements directly (no innerHTML):
 * headings 1–4, paragraphs, bold / italic / inline code, wikilinks
 * `[[Page]]` / `[[Page|label]]` / `[[images/…]]`, standard links,
 * `<img>` tags, nested bullet + numbered lists, tables, rules, and
 * code fences. Deliberate gaps (logged in the prototype MEMO):
 * `_underscore_` emphasis is NOT parsed — every `_…_` span in the
 * corpus is a snake_case identifier fragment (e.g. `cc_record_…`), so
 * parsing it would corrupt real content; HTML beyond `<img>` is
 * shown as text; link anchors (`[[Page#x]]`) open the page, anchor
 * scroll is not attempted.
 *
 * Table strategy (412px): scroll-don't-shrink — the table keeps its
 * natural column widths inside a horizontally scrolling well, with
 * the first column pinned (position: sticky) so a row's identity
 * (icon + name) stays on screen while its stats scroll. Generated
 * Reference tables are records — one item per row — and stacking
 * them would sever name from stats; the record stays intact and
 * the well scrolls.
 */
/* eslint-disable react-refresh/only-export-components -- prototype renderer: the two small components below are co-located with the render function deliberately; never shipped. */
import React from 'react';
import { CK } from './consoleTokens';
import { resolveWikiPage, wikiImageUrl } from './wikiCorpus';

export interface MdCtx {
  openPage: (id: string) => void;
}

const BODY = '#DCD6C6';
const SCANLINES =
  'repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)';

let keySeq = 0;
const k = () => `wm${(keySeq += 1)}`;

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

const INLINE_RE_SRC =
  '(`[^`]+`)|(\\[\\[[^\\]]+\\]\\])|(<img[^>]*>)|(\\[[^\\]]*\\]\\([^)]*\\))|(\\*\\*[^*]+\\*\\*)|(\\*[^*\\s][^*]*\\*)|(https?:\\/\\/[^\\s)]+)';

function imgAttrs(tag: string): { src?: string; alt?: string; width?: number } {
  const src = tag.match(/src="([^"]*)"/)?.[1];
  const alt = tag.match(/alt="([^"]*)"/)?.[1];
  const width = tag.match(/width="(\d+)"/)?.[1];
  return { src, alt, width: width ? Number(width) : undefined };
}

function WikiImg({ rel, alt, width, inTable }: { rel: string; alt?: string; width?: number; inTable?: boolean }) {
  const url = wikiImageUrl(rel);
  if (!url) {
    return (
      <span className="text-[12px] italic" style={{ color: CK.label }}>
        [image: {alt ?? rel}]
      </span>
    );
  }
  if (inTable) {
    const w = Math.min(width ?? 40, 48);
    return <img src={url} alt={alt ?? ''} width={w} height={w} className="block" style={{ imageRendering: 'auto' }} />;
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      className="block h-auto w-full"
      style={{ maxWidth: width ? `${width}px` : undefined }}
    />
  );
}

function renderInline(text: string, ctx: MdCtx, inTable = false): React.ReactNode[] {
  // A FRESH regex per call: renderInline recurses (bold/italic spans
  // re-render their contents), and a shared /g regex's lastIndex is
  // mutated by the inner pass — the outer pass then re-matches its
  // first token forever (this hung the renderer on any bold span).
  const INLINE_RE = new RegExp(INLINE_RE_SRC, 'g');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [whole, code, wikilink, img, mdlink, bold, italic, bareUrl] = m;
    if (code) {
      out.push(
        <code
          key={k()}
          className="px-1 py-px text-[0.92em] font-semibold"
          style={{ background: CK.lcd, color: CK.bone, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9)' }}
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (wikilink) {
      const inner = wikilink.slice(2, -2);
      const [targetRaw, labelRaw] = inner.split('|').map((s) => s.trim());
      if (/^images\//i.test(targetRaw)) {
        out.push(<WikiImg key={k()} rel={targetRaw} inTable={inTable} />);
      } else {
        const page = resolveWikiPage(targetRaw);
        const label = labelRaw ?? targetRaw.split('#')[0];
        if (page) {
          out.push(
            <a
              key={k()}
              href="#"
              data-wiki-link={page.id}
              onClick={(e) => {
                e.preventDefault();
                ctx.openPage(page.id);
              }}
              className="font-semibold underline decoration-from-font underline-offset-4"
              style={{ color: CK.amber }}
            >
              {label}
            </a>,
          );
        } else {
          out.push(
            <span key={k()} className="font-semibold underline decoration-dotted underline-offset-4" style={{ color: CK.red }} title="No such wiki page">
              {label}
            </span>,
          );
        }
      }
    } else if (img) {
      const { src, alt, width } = imgAttrs(img);
      if (src) out.push(<WikiImg key={k()} rel={src} alt={alt} width={width} inTable={inTable} />);
    } else if (mdlink) {
      const linkMatch = mdlink.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
      const label = linkMatch?.[1] ?? mdlink;
      const href = linkMatch?.[2] ?? '';
      if (/^https?:\/\//.test(href)) {
        out.push(
          <a key={k()} href={href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4" style={{ color: CK.amber }}>
            {label}
            <ExtChip />
          </a>,
        );
      } else {
        const page = resolveWikiPage(href);
        if (page) {
          out.push(
            <a
              key={k()}
              href="#"
              data-wiki-link={page.id}
              onClick={(e) => {
                e.preventDefault();
                ctx.openPage(page.id);
              }}
              className="font-semibold underline underline-offset-4"
              style={{ color: CK.amber }}
            >
              {label}
            </a>,
          );
        } else {
          out.push(<span key={k()}>{label}</span>);
        }
      }
    } else if (bold) {
      out.push(
        <strong key={k()} style={{ color: CK.bone }}>
          {renderInline(bold.slice(2, -2), ctx, inTable)}
        </strong>,
      );
    } else if (italic) {
      out.push(<em key={k()}>{renderInline(italic.slice(1, -1), ctx, inTable)}</em>);
    } else if (bareUrl) {
      out.push(
        <a key={k()} href={bareUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4" style={{ color: CK.amber }}>
          {bareUrl}
          <ExtChip />
        </a>,
      );
    }
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** External-link marker: a small instrument tag, never an emoji. */
const ExtChip: React.FC = () => (
  <span
    className="ml-1 inline-block px-1 align-middle text-[11px] font-bold uppercase tracking-[0.1em]"
    style={{ color: CK.amber, boxShadow: `inset 0 0 0 1px ${CK.amber}` }}
  >
    Ext
  </span>
);

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function renderList(items: ListItem[], ctx: MdCtx): React.ReactNode {
  // Build a two-level tree: items deeper than the first item's indent
  // nest under the previous shallower item (the corpus nests once).
  const base = Math.min(...items.map((i) => i.indent));
  const roots: { item: ListItem; children: ListItem[] }[] = [];
  for (const item of items) {
    if (item.indent <= base || roots.length === 0) roots.push({ item, children: [] });
    else roots[roots.length - 1].children.push(item);
  }
  const renderItems = (list: { item: ListItem; children: ListItem[] }[], ordered: boolean, nested = false) => {
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag className={`${nested ? 'mt-1.5' : 'my-3'} space-y-1.5`} style={nested ? { marginLeft: 22 } : undefined}>
        {list.map((entry, i) => (
          <li key={k()} className="flex gap-2.5" style={{ fontSize: 15, lineHeight: 1.6, color: BODY }}>
            {ordered ? (
              <span className="ck-num shrink-0 font-bold" style={{ color: CK.amber, minWidth: 20 }}>
                {i + 1}.
              </span>
            ) : (
              <span aria-hidden className="mt-[9px] block h-[6px] w-[6px] shrink-0" style={{ background: CK.amber }} />
            )}
            <span className="min-w-0 flex-1">
              {renderInline(entry.item.text, ctx)}
              {entry.children.length > 0 &&
                renderItems(
                  entry.children.map((c) => ({ item: c, children: [] })),
                  entry.children[0].ordered,
                  true,
                )}
            </span>
          </li>
        ))}
      </Tag>
    );
  };
  return renderItems(roots, items[0].ordered);
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function renderTable(header: string[], aligns: (string | null)[], rows: string[][], ctx: MdCtx): React.ReactNode {
  return (
    <div
      key={k()}
      data-testid="wiki-table-scroll"
      className="my-4 overflow-x-auto"
      style={{
        background: `${SCANLINES}, ${CK.lcd}`,
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <table className="border-collapse" style={{ minWidth: '100%' }}>
        <thead>
          <tr>
            {header.map((cell, ci) => (
              <th
                key={k()}
                className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{
                  color: CK.boneDim,
                  background: '#10131B',
                  borderBottom: `1px solid ${CK.bezel}`,
                  textAlign: (aligns[ci] as React.CSSProperties['textAlign']) ?? 'left',
                  ...(ci === 0
                    ? { position: 'sticky', left: 0, zIndex: 2, boxShadow: '1px 0 0 rgba(0,0,0,0.85)' }
                    : {}),
                }}
              >
                {renderInline(cell, ctx, true)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={k()}>
              {header.map((_, ci) => (
                <td
                  key={k()}
                  className="px-3 py-2 align-top"
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: BODY,
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    textAlign: (aligns[ci] as React.CSSProperties['textAlign']) ?? 'left',
                    ...(ci === 0
                      ? { position: 'sticky', left: 0, zIndex: 1, background: '#0B0D12', boxShadow: '1px 0 0 rgba(0,0,0,0.85)' }
                      : {}),
                  }}
                >
                  {renderInline(row[ci] ?? '', ctx, true)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const HEADING_STYLE: Record<number, React.CSSProperties> = {
  1: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, lineHeight: 1.05, letterSpacing: '0.02em', color: CK.bone, margin: '2px 0 14px' },
  2: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, lineHeight: 1.1, letterSpacing: '0.03em', color: CK.bone, margin: '26px 0 10px', paddingBottom: 6, borderBottom: `1px solid ${CK.bezel}` },
  3: { fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: CK.bone, margin: '20px 0 8px' },
  4: { fontSize: 13.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: CK.boneDim, margin: '16px 0 6px' },
};

export function renderWikiMarkdown(markdown: string, ctx: MdCtx): React.ReactNode[] {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const lines = clean.split('\n');
  const out: React.ReactNode[] = [];
  let lastWasFigure = false;
  let i = 0;

  const isBlockStart = (idx: number): boolean => {
    const l = lines[idx];
    if (/^\s*$/.test(l)) return true;
    if (/^#{1,6}\s/.test(l)) return true;
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) return true;
    if (/^```/.test(l)) return true;
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) return true;
    if (/^>/.test(l)) return true;
    if (/^\[\[images\/[^\]]+\]\]\s*$/.test(l.trim())) return true;
    if (l.trim().startsWith('|') && idx + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[idx + 1].trim())) return true;
    return false;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Code fence (none in the corpus today; supported for safety).
    if (/^```/.test(trimmed)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        <pre
          key={k()}
          className="my-3 overflow-x-auto px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{ background: CK.lcd, color: CK.bone, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9)' }}
        >
          {buf.join('\n')}
        </pre>,
      );
      lastWasFigure = false;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level}` as React.ElementType;
      out.push(
        <Tag key={k()} style={HEADING_STYLE[level]}>
          {renderInline(heading[2].trim(), ctx)}
        </Tag>,
      );
      i += 1;
      lastWasFigure = false;
      continue;
    }

    // Rule.
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={k()} className="my-5 border-0" style={{ height: 1, background: CK.bezel }} />);
      i += 1;
      lastWasFigure = false;
      continue;
    }

    // Standalone wiki image → framed figure; a following lone-italic
    // paragraph becomes its caption (the corpus' caption pattern).
    const figMatch = trimmed.match(/^\[\[(images\/[^\]]+)\]\]$/i);
    if (figMatch) {
      out.push(
        <figure
          key={k()}
          className="my-4 px-2 py-2"
          style={{ background: CK.panelInner, border: '2px solid #000', boxShadow: `inset 0 0 0 1px ${CK.bezel}` }}
          data-figure={figMatch[1]}
        >
          <WikiImg rel={figMatch[1]} />
        </figure>,
      );
      i += 1;
      lastWasFigure = true;
      continue;
    }

    // Table.
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
      );
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(renderTable(header, aligns, rows, ctx));
      lastWasFigure = false;
      continue;
    }

    // Blockquote (none in the corpus today; supported for safety).
    if (/^>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(
        <blockquote
          key={k()}
          className="my-3 px-3.5 py-2.5 italic"
          style={{ background: CK.panelInner, color: CK.boneDim, fontSize: 15, lineHeight: 1.65, boxShadow: `inset 0 0 0 1px ${CK.bezel}` }}
        >
          {renderInline(buf.join(' '), ctx)}
        </blockquote>,
      );
      lastWasFigure = false;
      continue;
    }

    // List block (bullets / numbered, one nesting level).
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)(?:([- *])|(\d+)\.)\s+(.*)$/);
        if (itemMatch) {
          items.push({ indent: itemMatch[1].length, ordered: Boolean(itemMatch[3]), text: itemMatch[4] });
          i += 1;
          continue;
        }
        // Wrapped continuation of the previous item.
        if (items.length > 0 && lines[i].trim() !== '' && !isBlockStart(i)) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      out.push(<React.Fragment key={k()}>{renderList(items, ctx)}</React.Fragment>);
      lastWasFigure = false;
      continue;
    }

    // Paragraph (or a figure caption when it directly follows a figure
    // and is a single italic span — the corpus' caption convention).
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(i)) {
      buf.push(lines[i].trim());
      i += 1;
    }
    const text = buf.join(' ');
    const captionMatch = text.match(/^\*([^*]+)\*$/);
    if (lastWasFigure && captionMatch) {
      out.push(
        <p key={k()} className="-mt-2 mb-4 px-1 text-[12.5px] italic leading-relaxed" style={{ color: CK.label }}>
          {renderInline(captionMatch[1], ctx)}
        </p>,
      );
    } else {
      out.push(
        <p key={k()} className="my-3" style={{ fontSize: 15, lineHeight: 1.65, color: BODY }}>
          {renderInline(text, ctx)}
        </p>,
      );
    }
    lastWasFigure = false;
  }
  return out;
}
