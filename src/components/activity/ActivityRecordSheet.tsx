/**
 * ActivityRecordSheet (AL-3) — the inspect face of one log record.
 *
 * DETAIL BEHIND INSPECT: the stream card carries identity +
 * headline numbers; this sheet carries the receipt. For a drop,
 * the receipt is AL-1's stamp read back verbatim — where it came
 * from, the enemy relation in honest words (a drop that rolled
 * while fighting X never claims X dropped it), and the odds it
 * rolled, factor by factor, exactly as recorded. Pre-stamp items
 * say so plainly. Nothing here is recomputed from live state:
 * the record is the durable carrier, so a sold or salvaged item's
 * story still reads true.
 */
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SheetPortal } from '@/components/common/SheetPortal';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import type { PxIconName } from '@/lib/pixel/icons';
import type { ActivityRecord } from '@/lib/api/activityLogService';
import {
  bossWinChance, cachePaymentLabel, dropChance, elapsedLabel, earningsLine,
  foundViaLabel, fullWhen, goodsDisplayName, itemKindLabel, rarityHex, recordFace, recordKindIcon,
} from '@/lib/activity/activityLogView';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };

const KIND_EYEBROW: Record<ActivityRecord['kind'], string> = {
  drop: 'Drop', kills: 'Kills', boss: 'Boss Fight', cache: 'Cache', craft: 'Craft',
  market: 'Market', earnings: 'Earnings', settlement: 'While Away', salvage: 'Salvage',
  dispatch: 'Dispatch', endless: 'Endless', system: 'System',
};

interface FactRow { label: string; value: string; tone?: string }

function Section({ title, icon, children }: { title: string; icon: PxIconName; children: ReactNode }) {
  return (
    <section className="mt-2 border-2 border-border bg-surface p-3" style={panelClip}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex text-amber"><PxIcon name={icon} size={15} /></span>
        <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-text-primary">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function FactRows({ rows }: { rows: FactRow[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3 border border-border bg-bg/70 px-2 py-1.5" style={slashClip}>
          <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.08em] text-text-muted">{row.label}</span>
          <span className={`text-right text-[12px] font-bold ${row.tone ?? 'text-text-primary'}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

const fmtNum = (n: number): string => n.toLocaleString('en-US');
const oddsPct = (fraction: number): string => {
  const pct = fraction * 100;
  if (pct >= 9.95) return `${Math.round(pct)}%`;
  if (pct >= 0.995) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2).replace(/0$/, '')}%`;
};

function dropSections(record: ActivityRecord): ReactNode {
  const receipt = record.receipt;
  if (receipt === null || receipt === undefined) {
    return (
      <Section title="Where It Came From" icon="pin">
        <p className="text-[12px] leading-snug text-text-secondary">
          This drop predates item records. The game didn't stamp its source or its odds when it
          dropped — and the log doesn't guess. Everything above the receipts line in the log
          carries its full story.
        </p>
      </Section>
    );
  }
  const rows: FactRow[] = [{ label: 'Source', value: foundViaLabel(receipt.foundVia) }];
  if (record.areaName) rows.push({ label: 'Place', value: record.areaName });
  else if (receipt.foundVia === 'endless' && receipt.foundContext !== null) {
    rows.push({ label: 'Place', value: `Endless — depth ${receipt.foundContext}` });
  }
  if (receipt.foundEnemy) {
    rows.push({ label: 'Enemy', value: receipt.foundEnemy.name });
    if (receipt.foundEnemy.relation === 'killed') {
      rows.push({ label: 'How', value: 'Dropped by the kill' });
    } else if (receipt.foundEnemy.relation === 'engaged') {
      rows.push({ label: 'How', value: 'Rolled while fighting it — not off the body' });
    } else if (receipt.foundEnemy.relation === 'elite') {
      rows.push({ label: 'How', value: 'Dropped by the elite kill' });
    } else if (receipt.foundEnemy.relation === 'bounty') {
      rows.push({ label: 'How', value: 'Dropped by the bounty kill' });
    }
  }
  if (record.away) rows.push({ label: 'When', value: 'Settled while you were away' });

  const chance = dropChance(record);
  const odds = receipt.dropOdds;
  const factorRows: FactRow[] = [];
  if (odds) {
    if (typeof odds.gearChance === 'number') factorRows.push({ label: 'Drop chance that tick', value: oddsPct(odds.gearChance) });
    if (odds.kind) factorRows.push({ label: 'Kind rolled', value: itemKindLabel(odds.kind) });
    if (odds.rarityWeights && record.item?.rarity) {
      const weights = Object.values(odds.rarityWeights).filter((v) => typeof v === 'number' && v > 0);
      const total = weights.reduce((a, b) => a + b, 0);
      const mine = Object.entries(odds.rarityWeights).find(([k]) => k.toLowerCase() === record.item?.rarity?.toLowerCase())?.[1];
      if (typeof mine === 'number' && total > 0) {
        factorRows.push({ label: `${record.item.rarity} share`, value: `${oddsPct(mine / total)} of the rarity roll` });
      }
    }
    if (typeof odds.luck === 'number' && odds.luck !== 1) factorRows.push({ label: 'Luck in force', value: `×${odds.luck.toFixed(2)}` });
    if (odds.boost) factorRows.push({ label: 'Boost', value: 'Active — drop chance doubled', tone: 'text-[#FFEA3A]' });
    if (odds.floor) factorRows.push({ label: 'Rarity floor', value: odds.floor });
    if (typeof odds.scalar === 'number' && odds.scalar !== 1) factorRows.push({ label: 'Legendary scalar', value: `×${odds.scalar}` });
    if (typeof odds.dedicatedChance === 'number') factorRows.push({ label: 'Dedicated chance', value: oddsPct(odds.dedicatedChance) });
    if (typeof odds.dedicatedHit === 'boolean') {
      factorRows.push({
        label: 'Dedicated roll',
        value: odds.dedicatedHit ? 'Hit — this item came from it' : 'Missed — regular table',
        tone: odds.dedicatedHit ? 'text-[#FFEA3A]' : undefined,
      });
    }
    if (typeof odds.dropLuckBonus === 'number' && odds.dropLuckBonus > 0) {
      factorRows.push({ label: 'Boss drop luck', value: `+${odds.dropLuckBonus}` });
    }
  }

  return (
    <>
      <Section title="Where It Came From" icon="pin">
        <FactRows rows={rows} />
      </Section>
      {(chance || factorRows.length > 0) && (
        <Section title="The Odds It Rolled" icon="diamondIn">
          {chance && (
            <div className="mb-2 flex items-end justify-between gap-3 border border-border bg-bg/70 px-2 py-2" style={slashClip}>
              <div>
                <div className="bl-title text-[34px] leading-none text-[#FFEA3A]">{chance.pct}</div>
                <div className="mt-1 text-[11px] font-semibold text-text-secondary">
                  {chance.oneIn}
                  {chance.basis === 'tick' && ' — chance of this exact drop, that tick'}
                  {chance.basis === 'rarity-roll' && ' — the kill guaranteed a drop; this was its rarity roll'}
                  {chance.basis === 'dedicated' && ' — the boss dedicated drop chance'}
                </div>
              </div>
            </div>
          )}
          {factorRows.length > 0 && <FactRows rows={factorRows} />}
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            Recorded on the item at the moment it dropped — these numbers never change after the fact.
          </p>
        </Section>
      )}
      {!chance && factorRows.length === 0 && (
        <Section title="The Odds It Rolled" icon="diamondIn">
          <p className="text-[12px] leading-snug text-text-secondary">
            This source doesn't roll odds the log can show — the drop itself is the record.
          </p>
        </Section>
      )}
    </>
  );
}

function kindSections(record: ActivityRecord): ReactNode {
  switch (record.kind) {
    case 'drop':
      return dropSections(record);
    case 'boss': {
      const b = record.boss;
      if (!b) return null;
      const win = bossWinChance(record);
      const rows: FactRow[] = [
        { label: 'Outcome', value: b.victory ? 'Victory' : 'Defeat', tone: b.victory ? 'text-[#7CFC00]' : 'text-[#FF4B5C]' },
      ];
      if (win) rows.push({ label: 'Win chance', value: `${win.pct} going in` });
      if (b.creditsGained > 0) rows.push({ label: 'Credits gained', value: `+${fmtNum(b.creditsGained)} cr`, tone: 'text-[#7CFC00]' });
      if (b.creditsLost > 0) rows.push({ label: 'Credits lost', value: `−${fmtNum(b.creditsLost)} cr`, tone: 'text-[#FF4B5C]' });
      if (typeof b.dedicatedChance === 'number') rows.push({ label: 'Dedicated chance', value: oddsPct(b.dedicatedChance) });
      if (typeof b.dedicatedDropAwarded === 'boolean') {
        rows.push({ label: 'Dedicated drop', value: b.dedicatedDropAwarded ? 'Awarded' : 'Not awarded', tone: b.dedicatedDropAwarded ? 'text-[#FFEA3A]' : undefined });
      }
      if (typeof b.dropLuckBonus === 'number' && b.dropLuckBonus > 0) rows.push({ label: 'Drop luck', value: `+${b.dropLuckBonus}` });
      return (
        <>
          <Section title="The Fight" icon="skull"><FactRows rows={rows} /></Section>
          {b.loot.length > 0 && (
            <Section title="Victory Loot" icon="loot">
              <div className="space-y-1.5">
                {b.loot.map((loot) => (
                  <div key={loot.id} className="flex items-baseline justify-between gap-3 border border-border bg-bg/70 px-2 py-1.5" style={slashClip}>
                    <span className="min-w-0 truncate text-[12px] font-bold" style={{ color: rarityHex(loot.rarity) }}>{loot.name ?? 'Unnamed drop'}</span>
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      {loot.rarity ?? ''} {itemKindLabel(loot.kind)}{loot.level != null ? ` · Lv ${loot.level}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Each piece carries its own receipt — find it in the stream under Loot.
              </p>
            </Section>
          )}
        </>
      );
    }
    case 'cache': {
      const c = record.cache;
      if (!c) return null;
      const rows: FactRow[] = [];
      if (c.outcome) rows.push({ label: 'Outcome', value: c.outcome, tone: 'text-[#FFEA3A]' });
      if (c.payment) rows.push({ label: 'Opened with', value: cachePaymentLabel(c.payment) });
      if (typeof c.roll === 'number' && typeof c.totalWeight === 'number') {
        rows.push({ label: 'The draw', value: `Roll ${fmtNum(c.roll)} of ${fmtNum(c.totalWeight)}` });
      }
      if (typeof c.cacheQuality === 'number') rows.push({ label: 'Cache quality', value: `${Math.round(c.cacheQuality * 100)}%` });
      if (typeof c.oddsTableVersion === 'number') rows.push({ label: 'Odds table', value: `Version ${c.oddsTableVersion}` });
      return (
        <Section title="The Draw" icon="crate">
          <FactRows rows={rows} />
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            The draw is recorded as rolled. Cache quality shapes the rarity weights before the
            roll, so the log shows the draw itself rather than a percentage it can't prove.
          </p>
        </Section>
      );
    }
    case 'earnings': {
      const e = record.earnings;
      if (!e) return null;
      const rows: FactRow[] = [];
      if (e.credits) rows.push({ label: 'Credits', value: `${e.credits > 0 ? '+' : ''}${fmtNum(e.credits)} cr`, tone: e.credits > 0 ? 'text-[#7CFC00]' : 'text-[#FF4B5C]' });
      if (e.scrap) rows.push({ label: 'Scrap', value: `+${fmtNum(e.scrap)}` });
      if (e.xp) rows.push({ label: 'XP', value: `+${fmtNum(e.xp)}` });
      if (e.fragments) rows.push({ label: 'Cache fragments', value: `+${fmtNum(e.fragments)}` });
      for (const [name, count] of Object.entries(e.materials ?? {})) rows.push({ label: name, value: `+${fmtNum(count)}` });
      for (const [name, count] of Object.entries(e.essences ?? {})) rows.push({ label: name, value: `+${fmtNum(count)}` });
      return <Section title="What Landed" icon="coin"><FactRows rows={rows} /></Section>;
    }
    case 'craft': {
      const c = record.craft;
      if (!c) return null;
      const rows: FactRow[] = [
        { label: 'Recipe', value: c.recipeName ?? c.recipeId },
        { label: 'Units', value: c.unitsTotal ? `${c.unitsCompleted} of ${c.unitsTotal}` : String(c.unitsCompleted) },
      ];
      if (typeof c.bench === 'number') rows.push({ label: 'Bench', value: String(c.bench) });
      if (c.xpAwarded > 0) rows.push({ label: 'Crafting XP', value: `+${fmtNum(c.xpAwarded)}`, tone: 'text-[#7CFC00]' });
      for (const out of c.outputs) rows.push({ label: 'Made', value: `×${out.count} ${out.name ?? 'output'}` });
      return <Section title="The Job" icon="hammer"><FactRows rows={rows} /></Section>;
    }
    case 'market': {
      const m = record.market;
      if (!m) return null;
      const rows: FactRow[] = [
        { label: 'Trade', value: m.direction === 'bought' ? 'Bought' : 'Sold' },
        { label: 'Price', value: `${fmtNum(m.priceCredits)} cr`, tone: 'text-[#FFEA3A]' },
      ];
      if (m.feeCredits) rows.push({ label: 'Market fee', value: `${fmtNum(m.feeCredits)} cr` });
      if (m.counterpartyName) rows.push({ label: m.direction === 'bought' ? 'Seller' : 'Buyer', value: m.counterpartyName });
      if (m.goodsKey) rows.push({ label: 'Goods', value: goodsDisplayName(m.goodsKey) });
      if (m.quantity) rows.push({ label: 'Quantity', value: String(m.quantity) });
      return <Section title="The Trade" icon="tag"><FactRows rows={rows} /></Section>;
    }
    case 'settlement': {
      const s = record.settlement;
      if (!s) return null;
      const rows: FactRow[] = [];
      const elapsed = elapsedLabel(s.elapsedMs);
      if (elapsed) rows.push({ label: 'Time away', value: elapsed });
      if (typeof s.ticks === 'number') rows.push({ label: 'Ticks settled', value: fmtNum(s.ticks) });
      if (typeof s.capHours === 'number') rows.push({ label: 'Offline cap', value: `${s.capHours}h` });
      if (typeof s.capReached === 'boolean') rows.push({ label: 'Cap reached', value: s.capReached ? 'Yes — the rest waited' : 'No' });
      return <Section title="The Settlement" icon="clock"><FactRows rows={rows} /></Section>;
    }
    case 'salvage':
      return record.salvage ? (
        <Section title="What It Paid" icon="recycle">
          <FactRows rows={[
            { label: 'Scrap', value: `+${fmtNum(record.salvage.scrapAward)}`, tone: 'text-[#7CFC00]' },
            ...(record.salvage.coresAward > 0
              ? [{ label: 'Legendary cores', value: `+${record.salvage.coresAward}`, tone: 'text-[#FFEA3A]' } as FactRow]
              : []),
          ]} />
        </Section>
      ) : null;
    case 'dispatch': {
      const d = record.dispatch;
      if (!d) return null;
      const rows: FactRow[] = [
        { label: 'Family', value: d.family },
        { label: 'Payout', value: `+${fmtNum(d.payoutCredits)} cr`, tone: 'text-[#7CFC00]' },
      ];
      if (d.payoutFraction !== null) rows.push({ label: 'Paid', value: `${Math.round(d.payoutFraction * 100)}%` });
      return <Section title="The Dispatch" icon="signal"><FactRows rows={rows} /></Section>;
    }
    case 'endless':
      return record.endless ? (
        <Section title="The Run" icon="infinity">
          <FactRows rows={[
            { label: 'Status', value: record.endless.status },
            { label: 'Depth reached', value: String(record.endless.depthReached) },
          ]} />
        </Section>
      ) : null;
    case 'kills':
      return (
        <Section title="The Stretch" icon="crosshair">
          <FactRows rows={[
            { label: 'Kills', value: record.kills ? fmtNum(record.kills.count) : '—' },
            ...(record.areaName ? [{ label: 'Ground', value: record.areaName } as FactRow] : []),
          ]} />
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            Kills land in the log as one line per roaming stretch — the drops they produced are
            their own entries, each with its receipt.
          </p>
        </Section>
      );
    default:
      return null;
  }
}

export function ActivityRecordSheet({ record, onClose }: { record: ActivityRecord | null; onClose: () => void }) {
  const face = record ? recordFace(record) : null;
  const rarityColor = record?.item ? rarityHex(record.item.rarity) : '#F5F5F5';
  return (
    <SheetPortal>
      <AnimatePresence>
        {record && face && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]"
              style={panelClip}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={face.title}
              data-testid="activity-record-sheet"
            >
              <div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div>

              <div className="relative overflow-hidden border-2 border-border bg-surface p-3" style={panelClip}>
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-[56px] w-[56px] shrink-0 items-center justify-center border bg-black/60"
                    style={{ borderColor: record.item ? rarityColor : 'rgba(255,255,255,0.14)', color: record.item ? rarityColor : '#B8B0A8' }}
                    aria-hidden
                  >
                    <PxIcon name={recordKindIcon(record)} size={30} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber">
                      Activity Log · {KIND_EYEBROW[record.kind]}
                    </div>
                    <div className="bl-title mt-0.5 text-[26px] leading-none" style={{ color: rarityColor }}>
                      {face.title}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      {record.item
                        ? `${record.item.rarity ?? ''} ${itemKindLabel(record.item.kind)}${record.item.level != null ? ` · Lv ${record.item.level}` : ''}`
                        : record.label}
                    </div>
                  </div>
                  <button
                    type="button" onClick={onClose} aria-label="Close record"
                    className="bl-secondary flex h-11 w-11 shrink-0 items-center justify-center text-text-muted"
                  >
                    <PxIcon name="x" size={15} />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                  <span>{fullWhen(record.at)}</span>
                  {record.away && <span className="text-[#3B82F6]">While away</span>}
                  {record.kind === 'earnings' && earningsLine(record.earnings) && (
                    <span className="font-bold normal-case tracking-normal text-[#7CFC00]">{earningsLine(record.earnings)}</span>
                  )}
                </div>
              </div>

              {kindSections(record)}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
