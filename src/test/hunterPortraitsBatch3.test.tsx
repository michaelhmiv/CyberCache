/**
 * Portraits conversion (device-pass Batch 3, migration 0100) —
 * owner rulings 2026-11-15 (paintings only) + 2026-11-17 (no
 * equipped weapon in hand, anywhere): the public portrait surfaces
 * render the fielded hunter's PAINTING, never the assembled parts
 * figure.
 *
 * Pins:
 *  - Migration 0100 restates cc_hunter_look_view as the 0053 body
 *    VERBATIM plus the one marked insertion (stripping the
 *    insertion reproduces the chain head byte-for-byte), and the
 *    insertion resolves identity through cc_profile_active_hunter.
 *  - The store twin's getHunterLooks carries the fielded hunter:
 *    the stored id when set, the selection-derived hunter when the
 *    stored id is NULL, the default hunter when neither exists,
 *    and null for a player with no profile.
 *  - HunterPortrait paints the record's hunter (another player's
 *    included); a record with no identity — or a bogus one — falls
 *    back to the default hunter's painting, never to parts.
 *  - A Standings row paints its entry's hunter from the look
 *    record.
 *  - The market part thumb renders the part itself (its sprite),
 *    not a figure wearing it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryChefGameplayStore } from '@/server/gameplay/memory';
import { SkillTreeType } from '@/types/game';
import type { HunterLookView } from '@/content/skins';
import { HunterPortrait, portraitHunterId } from '@/components/pixelArt/HunterPortrait';
import { PartSpriteThumb } from '@/components/pixelArt/PartSpriteThumb';
import { CosmeticMiniCard } from '@/components/market/CosmeticMiniCard';
import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import { getPixelSprite, pixelHunterSpriteForHunter } from '@/lib/pixel/manifest';
import type { LeaderboardEntry } from '@/lib/api/leaderboardService';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const view = (over: Partial<HunterLookView> = {}): HunterLookView => ({
  playerId: B,
  username: 'bravo',
  headVariant: 'visor',
  parts: {},
  activeHunterId: null,
  ...over,
});

// ─── Migration 0100: the restated view ──────────────────────────

describe('migration 0100 — cc_hunter_look_view learns hunter identity', () => {
  const dir = join(process.cwd(), 'db/migrations');
  const sql0100 = readFileSync(join(dir, '0100_look_view_hunter_identity.sql'), 'utf8');
  const sql0053 = readFileSync(join(dir, '0053_skins_cosmetics.sql'), 'utf8');

  const body = (sql: string): string => {
    const start = sql.indexOf('create or replace function public.cc_hunter_look_view');
    const end = sql.indexOf('$$;', start);
    return sql.slice(start, end + 3);
  };

  it('the insertion is the ONLY change: stripping it reproduces the 0053 body byte-for-byte', () => {
    const insertion = `    'parts', v_parts,
    -- 0100 insertion: the fielded hunter's identity, resolved by
    -- 0097's cc_profile_active_hunter (stored id when valid, else
    -- the selection-derived default). NULL only when the profile
    -- itself does not exist; the client falls back the same way.
    'activeHunterId', (
      select public.cc_profile_active_hunter(p)
        from public.profiles p
       where p.id = p_player_id
    )
`;
    expect(body(sql0100)).toContain(insertion);
    expect(body(sql0100).replace(insertion, "    'parts', v_parts\n")).toBe(body(sql0053));
  });

  it('carries identity only — no parts data is dropped or altered', () => {
    expect(body(sql0100)).toContain("'headVariant'");
    expect(body(sql0100)).toContain("'partId'");
    expect(body(sql0100)).toContain("'tintPaletteId'");
    expect(body(sql0100)).not.toContain('delete');
    expect(body(sql0100)).not.toContain('drop');
  });
});

// ─── The store twin: getHunterLooks carries the hunter ──────────

describe('getHunterLooks — hunter identity (0100 twin)', () => {
  const store = () => new InMemoryChefGameplayStore(() => new Date('2026-11-17T12:00:00.000Z'));

  it('carries the stored fielded hunter', async () => {
    const s = store();
    s.seedProfile({ id: A, username: 'alpha', active_hunter_id: 'josie' });
    const looks = await s.getHunterLooks([A]);
    expect(looks[A]?.activeHunterId).toBe('josie');
  });

  it('resolves the selection-derived hunter when the stored id is NULL', async () => {
    const s = store();
    s.seedProfile({ id: B, username: 'bravo', action_skill_selection: SkillTreeType.Demolition });
    const looks = await s.getHunterLooks([B]);
    expect(looks[B]?.activeHunterId).toBe('silas');
  });

  it('resolves the default hunter when neither exists', async () => {
    const s = store();
    s.seedProfile({ id: C, username: 'charlie' });
    const looks = await s.getHunterLooks([C]);
    expect(looks[C]?.activeHunterId).toBe('vesper');
  });

  it('a player with no profile reads null identity (the client falls back)', async () => {
    const s = store();
    const looks = await s.getHunterLooks([D]);
    expect(looks[D]?.activeHunterId).toBeNull();
  });
});

// ─── The portrait component: paintings only ─────────────────────

describe('HunterPortrait — the painting, never the parts figure', () => {
  it("paints another player's fielded hunter from their record", () => {
    const { container } = render(<HunterPortrait look={view({ activeHunterId: 'silas' })} testId="portrait" />);
    const el = screen.getByTestId('portrait');
    expect(el.getAttribute('data-hunter-id')).toBe('silas');
    expect(el.getAttribute('data-portrait-sprite')).toBe('hunter-silas-boone');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(getPixelSprite('hunter-silas-boone')?.url);
    // The retired contract: no parts set, no assembled actor.
    expect(el.getAttribute('data-look-set')).toBeNull();
    expect(container.querySelector('[data-testid$="-actor"]')).toBeNull();
  });

  it('a record with no identity falls back to the default hunter’s painting', () => {
    render(<HunterPortrait look={view({ activeHunterId: null })} testId="portrait" />);
    const el = screen.getByTestId('portrait');
    expect(el.getAttribute('data-hunter-id')).toBe('vesper');
    expect(el.getAttribute('data-portrait-sprite')).toBe(pixelHunterSpriteForHunter('vesper'));
  });

  it('a bogus identity falls back the same way', () => {
    expect(portraitHunterId(view({ activeHunterId: 'goblin' }))).toBe('vesper');
    expect(portraitHunterId(view({ activeHunterId: 'doc' }))).toBe('doc');
  });
});

// ─── Standings: a row paints its hunter ─────────────────────────

describe('Standings board row — portrait from the look record', () => {
  const entry = (n: number): LeaderboardEntry => ({
    rank: n,
    player_id: `p-${n}`,
    username: `Hunter ${n}`,
    value: 1000 - n * 10,
    previous_value: null,
    trend: 0,
  });

  it('the row for a hunter fields their painting; a row without a record paints none', () => {
    render(
      <BoardConsole
        metric="level"
        period="all_time"
        onMetricChange={vi.fn()}
        onPeriodChange={vi.fn()}
        entries={[entry(1), entry(2)]}
        loading={false}
        myPlayerId={null}
        myRank={null}
        myRanks={{}}
        looks={{ 'p-2': view({ playerId: 'p-2', activeHunterId: 'doc' }) }}
        totalPlayers={2}
      />,
    );
    const wrap = screen.getByTestId('standings-portrait-p-2');
    const portrait = wrap.firstElementChild;
    expect(portrait?.getAttribute('data-hunter-id')).toBe('doc');
    expect(portrait?.getAttribute('data-portrait-sprite')).toBe('hunter-doc-sutter');
    expect(screen.queryByTestId('standings-portrait-p-1')).toBeNull();
  });
});

// ─── Market: the part renders as itself ─────────────────────────

describe('market part thumb — the part itself, not a figure wearing it', () => {
  it('PartSpriteThumb renders the part’s own sprite', () => {
    const { container } = render(<PartSpriteThumb partId="bulwark-torso" testId="thumb" />);
    const el = screen.getByTestId('thumb');
    expect(el.getAttribute('data-part-id')).toBe('bulwark-torso');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('PartSpriteThumb renders nothing for an unknown part', () => {
    const { container } = render(<PartSpriteThumb partId="no-such-part" testId="thumb" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('CosmeticMiniCard shows the part thumb, no hunter painting', () => {
    const { container } = render(
      <CosmeticMiniCard partId="bulwark-torso" name="Bulwark Siege Torso" qualityPercent={80} tintPaletteId={null} />,
    );
    expect(container.querySelector('[data-part-id="bulwark-torso"]')).not.toBeNull();
    expect(container.querySelector('[data-hunter-id]')).toBeNull();
    expect(container.querySelector('[data-look-set]')).toBeNull();
  });
});
