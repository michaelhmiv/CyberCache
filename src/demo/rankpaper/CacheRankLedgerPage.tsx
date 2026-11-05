/**
 * CacheRankLedgerPage — PROTOTYPE (design/hunter-subpages-rank-d,
 * 2026-11-05). NOT shipped UI. Variant D of the Hunter sub-page
 * pass: "Field paperwork."
 *
 * Cache Rank rendered as a SERVICE RECORD — the player's permanent
 * file at the frontier records office. The promotion history is a
 * ruled token LEDGER (grants in, endorsements out, balance carried
 * forward), the milestones are GRANT SLIPS stamped GRANTED /
 * PENDING, and the seven tracks are ENDORSEMENTS: each bought rank
 * is a stamp the clerk strikes into the track's row of boxes, and
 * the spend control is the endorsement stamp itself. There is no
 * manual milestone claim to design — grants are automatic
 * server-side; the file simply records them.
 *
 * Consumes the real CacheRankStateView (src/content/cacheRank.ts);
 * the demo harness derives the fixture through cacheRankStateView
 * and applies spends through the same cost curve the file prints.
 * The fee schedule in a track's file is read from
 * cacheRankCostForRank / cacheRankTrackCost — the game's own math.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  cacheRankCostForRank,
  cacheRankTrackCost,
  formatCacheRankPct,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import {
  AMBER,
  CTA,
  DIM,
  Doc,
  Field,
  FormHead,
  GOLD,
  INK,
  LedgerRow,
  MUT,
  PENCIL,
  Perf,
  PunchHoles,
  RULE,
  Stamp,
  displayStyle,
  ruledStock,
  tabular,
} from './paperKit';

/* ─── Doc 1 — the service record ─────────────────────────────────── */

const RecordDoc: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const filed = state.milestones.filter((m) => m.claimed).length;
  const spent = state.tokensEarned - state.tokens;
  const pct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;
  const ticks = 20;
  const filledTicks = Math.round((pct / 100) * ticks);
  return (
    <Doc raised testId="rankd-record">
      <PunchHoles />
      <FormHead left="Frontier Records Office" right="Form CR-31" title="Cache Rank — Service Record" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-3.5 pt-3">
        <Field label="Hunter level" value={String(state.level)} valueSize={19} />
        <Field label="Record status" value="Active — earning" />
        <Field label="Milestone grants filed" value={`${filed} of ${state.milestones.length}`} />
        <Field
          label="Next token"
          value={
            state.nextTokenLevel ? (
              <>
                at level{' '}
                <span
                  className="inline-block px-1"
                  style={{ border: `1.5px solid ${PENCIL}`, borderRadius: '50%', transform: 'rotate(-1.5deg)' }}
                >
                  {state.nextTokenLevel}
                </span>
              </>
            ) : (
              'Level cap reached'
            )
          }
        />
      </div>
      {/* The account box: balance as a stamped figure. */}
      <div className="mx-3.5 mt-4 mb-2 flex items-center gap-3 px-3 py-2.5" style={{ backgroundColor: '#120C06', border: `1.5px solid ${RULE}` }}>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
            Tokens on account
          </div>
          <div className="mt-0.5 text-[11px] font-semibold leading-snug" style={{ color: MUT }}>
            {state.tokensEarned} granted all-time · {spent} endorsed to tracks
          </div>
        </div>
        <span className="leading-none" style={{ ...displayStyle, fontSize: 44, color: GOLD, ...tabular }}>
          {state.tokens}
        </span>
        <Stamp color={GOLD} rotate={-3} size={11}>
          Verified
        </Stamp>
      </div>
      {/* Next-token progress as a clerk's ruler. */}
      <div className="px-3.5 pb-4 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUT }}>
            {state.nextTokenLevel ? `Progress to level ${state.nextTokenLevel}` : 'Every token earned'}
          </span>
          <span className="text-[11px] font-bold" style={{ color: INK, ...tabular }}>
            {state.xpForLevel > 0
              ? `${state.xpIntoLevel.toLocaleString()} / ${state.xpForLevel.toLocaleString()} XP · ${pct}%`
              : '—'}
          </span>
        </div>
        <div className="mt-1.5 flex items-end gap-[3px]" style={{ borderBottom: `2px solid ${MUT}` }} role="img" aria-label={`${pct}% to next token`}>
          {Array.from({ length: ticks }, (_, i) => (
            <span
              key={i}
              className="flex-1"
              style={{
                height: i % 5 === 4 ? 12 : 8,
                backgroundColor: i < filledTicks ? GOLD : RULE,
              }}
            />
          ))}
        </div>
      </div>
    </Doc>
  );
};

/* ─── Doc 2 — the token ledger ───────────────────────────────────── */

const LedgerDoc: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const bundleSum = state.milestones.filter((m) => m.claimed).reduce((sum, m) => sum + m.bundle, 0);
  const levelGrants = state.tokensEarned - bundleSum;
  const spent = state.tokensEarned - state.tokens;
  return (
    <Doc testId="rankd-ledger">
      <FormHead left="Account" right="Ledger A" title="Token Account" titleSize={22} />
      <div className="px-3.5 pb-4 pt-1" style={ruledStock}>
        <LedgerRow label="Granted — one token per level gained" amount={`+${levelGrants}`} />
        <LedgerRow
          label={`Granted — milestone bundles (${state.milestones.filter((m) => m.claimed).length} filed)`}
          amount={`+${bundleSum}`}
        />
        <LedgerRow label="Endorsed — paid out to the seven tracks" amount={`−${spent}`} />
        <div className="mt-1" style={{ borderTop: `3px double ${INK}` }}>
          <LedgerRow strong label="Balance carried forward" amount={`${state.tokens} TOKENS`} amountColor={GOLD} />
        </div>
        <div className="pt-2 text-[11px] font-semibold leading-snug" style={{ color: DIM }}>
          Tokens are minted by levels only — one per level, plus the bundles in Schedule B. This office
          accepts no other tender, and pays no interest.
        </div>
      </div>
    </Doc>
  );
};

/* ─── Doc 3 — milestone grant slips ──────────────────────────────── */

const GrantsDoc: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const nextIdx = state.milestones.findIndex((m) => !m.claimed);
  return (
    <Doc testId="rankd-grants">
      <FormHead left="Schedule B" right="Bundles" title="Milestone Grants" titleSize={22} />
      <div className="px-3.5 pb-3 pt-1">
        <div className="pb-1 text-[11px] font-semibold leading-snug" style={{ color: DIM }}>
          Filed automatically by the server the moment the level is reached — there is nothing to claim.
        </div>
        {state.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          return (
            <React.Fragment key={m.level}>
              {i > 0 && <Perf />}
              <div className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
                    Grant No. {i + 1}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span style={{ ...displayStyle, fontSize: 20, color: INK }}>Level {m.level}</span>
                    <span className="text-[12px] font-bold" style={{ color: MUT, ...tabular }}>
                      +{m.bundle} tokens
                    </span>
                  </div>
                  {isNext && (
                    <div
                      className="mt-0.5 inline-block text-[11px] font-black"
                      style={{ color: PENCIL, borderBottom: `1.5px solid ${PENCIL}`, transform: 'rotate(-0.5deg)' }}
                    >
                      Next grant — {m.level - state.level} levels out
                    </div>
                  )}
                </div>
                {m.claimed ? (
                  <Stamp color={GOLD} rotate={-2}>
                    Granted
                  </Stamp>
                ) : isNext ? (
                  <Stamp color={INK} rotate={1.5}>
                    Pending
                  </Stamp>
                ) : (
                  <Stamp color={DIM} rotate={0}>
                    Not yet due
                  </Stamp>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </Doc>
  );
};

/* ─── Doc 4 — the endorsements ───────────────────────────────────── */

const RankBoxes: React.FC<{ track: CacheRankTrackView }> = ({ track }) => (
  <div className="flex items-center gap-[5px]" role="img" aria-label={`${track.ranks} of ${track.maxRanks} endorsements`}>
    {Array.from({ length: track.maxRanks }, (_, i) => {
      const stamped = i < track.ranks;
      return (
        <span
          key={i}
          className="flex h-[23px] w-[23px] items-center justify-center text-[12px] font-black"
          style={
            stamped
              ? {
                  backgroundColor: track.color,
                  color: '#171008',
                  border: '1.5px solid #000',
                  transform: `rotate(${((i * 37) % 5) - 2}deg)`,
                  ...tabular,
                }
              : { border: `1.5px solid ${RULE}`, backgroundColor: 'rgba(18,12,6,0.5)' }
          }
        >
          {stamped ? i + 1 : ''}
        </span>
      );
    })}
    <span className="ml-1.5 text-[11px] font-black uppercase tracking-wide" style={{ color: MUT, ...tabular }}>
      {track.ranks} / {track.maxRanks}
    </span>
  </div>
);

const EndorsementEntry: React.FC<{
  track: CacheRankTrackView;
  index: number;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
  onOpen: (track: CacheRankTrackView) => void;
}> = ({ track, index, tokens, busy, onSpend, onOpen }) => {
  const affordable = track.nextCost !== null && tokens >= track.nextCost;
  return (
    <div className="py-3" style={index > 0 ? { borderTop: `1.5px solid ${RULE}` } : undefined}>
      <button
        type="button"
        onClick={() => onOpen(track)}
        aria-label={`Open the full file for ${track.name}`}
        className="flex min-h-[44px] w-full items-center gap-2 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
          Entry {String(index + 1).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1 truncate uppercase leading-none" style={{ ...displayStyle, fontSize: 22, color: INK }}>
          {track.name}
        </span>
        {track.effect > 0 ? (
          <Stamp color={track.color} rotate={-1.5} size={14}>
            {formatCacheRankPct(track.effect)}
          </Stamp>
        ) : (
          <Stamp color={DIM} rotate={-1.5} size={11}>
            Not in force
          </Stamp>
        )}
      </button>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-[12px] font-semibold leading-snug" style={{ color: MUT }}>
          {track.summary}
        </span>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide" style={{ color: DIM, ...tabular }}>
          {formatCacheRankPct(track.perRank)} / stamp
        </span>
      </div>
      <div className="mt-2.5">
        <RankBoxes track={track} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold" style={{ color: DIM }}>
          {track.maxed ? 'Schedule complete — file closed.' : `Next endorsement: ${track.nextCost} token${track.nextCost === 1 ? '' : 's'}.`}
        </span>
        {track.maxed ? (
          <Stamp color={track.color} rotate={-2}>
            Fully endorsed
          </Stamp>
        ) : (
          <button
            type="button"
            data-testid={`rankd-spend-${track.id}`}
            onClick={() => onSpend(track)}
            disabled={!affordable || busy}
            className="flex min-h-[44px] items-center gap-1.5 px-3.5 uppercase transition-transform active:scale-95"
            style={
              affordable
                ? {
                    ...displayStyle,
                    fontSize: 15,
                    letterSpacing: '0.1em',
                    backgroundColor: CTA,
                    color: '#171008',
                    border: '2px solid #000',
                    boxShadow: '3px 3px 0 rgba(0,0,0,0.6)',
                  }
                : {
                    ...displayStyle,
                    fontSize: 15,
                    letterSpacing: '0.1em',
                    backgroundColor: 'rgba(18,12,6,0.6)',
                    color: DIM,
                    border: `2px solid ${RULE}`,
                  }
            }
          >
            <PxIcon name="hex" size={13} />
            {busy ? 'Filing…' : affordable ? `Endorse · ${track.nextCost}` : `Need ${(track.nextCost ?? 0) - tokens} more`}
          </button>
        )}
      </div>
    </div>
  );
};

const EndorsementsDoc: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
  onOpen: (track: CacheRankTrackView) => void;
}> = ({ state, busyTrack, onSpend, onOpen }) => (
  <Doc testId="rankd-endorsements">
    <FormHead left="Schedule C" right="Seven tracks" title="Endorsements" titleSize={22} />
    <div className="px-3.5 pb-2">
      <div className="pt-1 text-[11px] font-semibold leading-snug" style={{ color: DIM }}>
        Every stamp is a permanent bonus, applied last over gear, skills, and activity. Tap a track's
        heading to open its full file, fee schedule included.
      </div>
      {state.tracks.map((track, i) => (
        <EndorsementEntry
          key={track.id}
          track={track}
          index={i}
          tokens={state.tokens}
          busy={busyTrack === track.id}
          onSpend={onSpend}
          onOpen={onOpen}
        />
      ))}
    </div>
  </Doc>
);

/* ─── Attestation ────────────────────────────────────────────────── */

const Attestation: React.FC<{ state: CacheRankStateView }> = ({ state }) => (
  <div className="px-1 pb-2 pt-1">
    <div className="flex justify-center pb-2">
      <Stamp color={MUT} rotate={-1} size={11}>
        Attested — Frontier Records
      </Stamp>
    </div>
    <div className="text-[11px] font-semibold leading-snug" style={{ color: DIM }}>
      Endorsements are permanent and there is no respec: the bonuses are tiny and broad by design, so a
      misclick costs little. At full endorsement this record is worth{' '}
      {state.tracks.map((t) => `${formatCacheRankPct(t.perRank * t.maxRanks)} ${t.name.toLowerCase()}`).join(' · ')} —
      earned across a whole career of levels.
    </div>
  </div>
);

/* ─── The track file (detail) ────────────────────────────────────── */

export const TrackFileSheet: React.FC<{
  track: CacheRankTrackView;
  index: number;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
  onClose: () => void;
}> = ({ track, index, tokens, busy, onSpend, onClose }) => {
  const paid = cacheRankTrackCost(track.ranks);
  const affordable = track.nextCost !== null && tokens >= track.nextCost;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-label={`File for ${track.name}`}>
      <button type="button" aria-label="Close the file" onClick={onClose} className="absolute inset-0" style={{ backgroundColor: 'rgba(6,4,2,0.78)' }} />
      <div className="relative max-h-[90vh] w-full max-w-[430px] overflow-y-auto" data-testid="rankd-track-file">
        <Doc raised>
          <FormHead left="Track file" right={`Entry ${String(index + 1).padStart(2, '0')} of 7`} title={track.name} titleSize={26} />
          <div className="px-3.5 pb-4 pt-3">
            <div className="flex items-center gap-3">
              {track.effect > 0 ? (
                <Stamp color={track.color} rotate={-2} size={18}>
                  {formatCacheRankPct(track.effect)}
                </Stamp>
              ) : (
                <Stamp color={DIM} rotate={-2} size={13}>
                  Not in force
                </Stamp>
              )}
              <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: MUT }}>
                {track.ranks} of {track.maxRanks} endorsements in force
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-4">
              <Field label="Particulars" value={track.summary} valueSize={12} />
              <Field label="Per endorsement" value={formatCacheRankPct(track.perRank)} />
              <Field label="Paid into this track" value={`${paid} tokens`} />
              <Field label="Applies" value="Last — over every other modifier" valueSize={12} />
            </div>
            <div className="pt-4 text-[12px] font-black uppercase tracking-wide" style={{ color: INK }}>
              Schedule of fees — ten endorsements
            </div>
            <div className="pt-1">
              {Array.from({ length: track.maxRanks }, (_, r) => {
                const cost = cacheRankCostForRank(r);
                const isPaid = r < track.ranks;
                const isNext = r === track.ranks;
                return (
                  <div
                    key={r}
                    className="flex items-center gap-2 py-[6px]"
                    style={{
                      borderBottom: `1px solid ${RULE}`,
                      backgroundColor: isNext ? 'rgba(255,138,0,0.08)' : undefined,
                    }}
                  >
                    <span className="flex-1 text-[12px] font-semibold" style={{ color: isNext ? INK : MUT, ...tabular }}>
                      Endorsement {r + 1}
                    </span>
                    <span className="text-[12px] font-bold" style={{ color: isNext ? INK : MUT, ...tabular }}>
                      {cost} token{cost === 1 ? '' : 's'}
                    </span>
                    <span className="flex w-[104px] justify-end">
                      {isPaid ? (
                        <Stamp color={track.color} rotate={-2} size={11}>
                          Paid
                        </Stamp>
                      ) : isNext ? (
                        <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: AMBER }}>
                          Next due
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: DIM }}>
                          Due in turn
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {track.maxed ? (
              <div className="flex justify-center pt-4">
                <Stamp color={track.color} rotate={-2} size={14}>
                  Fully endorsed — file closed
                </Stamp>
              </div>
            ) : (
              <button
                type="button"
                data-testid={`rankd-file-spend-${track.id}`}
                onClick={() => onSpend(track)}
                disabled={!affordable || busy}
                className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-1.5 uppercase transition-transform active:scale-[0.98]"
                style={
                  affordable
                    ? {
                        ...displayStyle,
                        fontSize: 17,
                        letterSpacing: '0.1em',
                        backgroundColor: CTA,
                        color: '#171008',
                        border: '2px solid #000',
                        boxShadow: '3px 3px 0 rgba(0,0,0,0.6)',
                      }
                    : {
                        ...displayStyle,
                        fontSize: 17,
                        letterSpacing: '0.1em',
                        backgroundColor: 'rgba(18,12,6,0.6)',
                        color: DIM,
                        border: `2px solid ${RULE}`,
                      }
                }
              >
                <PxIcon name="hex" size={14} />
                {busy
                  ? 'Filing…'
                  : affordable
                    ? `Endorse — ${track.nextCost} token${track.nextCost === 1 ? '' : 's'}`
                    : `Endorse — need ${(track.nextCost ?? 0) - tokens} more tokens`}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center text-[12px] font-black uppercase tracking-widest"
              style={{ color: MUT, textDecoration: 'underline dotted', textUnderlineOffset: 4 }}
            >
              Return file to the stack
            </button>
          </div>
        </Doc>
      </div>
    </div>
  );
};

/* ─── Page ───────────────────────────────────────────────────────── */

export const CacheRankLedgerPage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  selected: CacheRankTrackView | null;
  onSpend: (track: CacheRankTrackView) => void;
  onOpen: (track: CacheRankTrackView | null) => void;
}> = ({ state, busyTrack, selected, onSpend, onOpen }) => (
  <div className="space-y-3">
    <RecordDoc state={state} />
    <LedgerDoc state={state} />
    <GrantsDoc state={state} />
    <EndorsementsDoc state={state} busyTrack={busyTrack} onSpend={onSpend} onOpen={onOpen} />
    <Attestation state={state} />
    {selected && (
      <TrackFileSheet
        track={state.tracks.find((t) => t.id === selected.id) ?? selected}
        index={state.tracks.findIndex((t) => t.id === selected.id)}
        tokens={state.tokens}
        busy={busyTrack === selected.id}
        onSpend={onSpend}
        onClose={() => onOpen(null)}
      />
    )}
  </div>
);
