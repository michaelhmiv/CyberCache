/**
 * Recipe detail surfaces (Workshop Direction A, as corrected by the
 * owner 2026-11-03): the card face carries identity + numbers +
 * actions; the PROSE lives behind the info button in this inspect
 * sheet — full description/purpose, the item's quality range and
 * what the % means for this item, effect details, and the full
 * gate/material detail. SourceLine and GateLines are shared by the
 * card face (shortfall sources, non-material lock lines) and the
 * sheet (the complete detail), so the two can never disagree.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PickerSheet } from '@/components/common/PickerSheet';
import { useIdleStore, useMarketStore } from '@/store';
import { CONSUMABLES, getConsumableQualityBand } from '@/constants/consumables';
import {
  GEAR_TEMPER_BASE_CHANCE_DEFAULT,
  REFINE_BASE_YIELD_DEFAULT,
  craftQualityBounds,
  gearTemperChance,
  isMaterialInput,
  craftRelicByName,
  refineOutputRange,
  type CraftRecipe,
} from '@/content/crafting';
import {
  inputLabel,
  masteryLevel,
  recipePurpose,
  type RecipeGate,
  type RecipeReadiness,
  type WorkshopPlayerContext,
} from '@/lib/workshop/readiness';
import { sourcesForInput, type MaterialSource } from '@/lib/workshop/sources';
import { QuickBuyPlus } from '@/components/quickbuy/QuickBuyPlus';

// ─── Shortfall source line: sources with working doors ─────────────

export const SourceLine: React.FC<{
  inputId: string;
  onNavigate?: (screen: string) => void;
  onRefineFocus: (recipeId: string) => void;
}> = ({ inputId, onNavigate, onRefineFocus }) => {
  const sources = sourcesForInput(inputId);
  const doorClass = 'inline-flex items-center gap-0.5 font-black text-amber';
  const renderSource = (source: MaterialSource, index: number) => {
    const sep = index > 0 ? <span className="text-text-muted"> · </span> : null;
    switch (source.kind) {
      case 'refine':
        return (
          <span key={index}>
            {sep}
            <button type="button" className={doorClass} onClick={() => onRefineFocus(source.recipeId)}>
              Refine here — the {source.station === 'furnace' ? 'furnace' : 'crusher'} <PxIcon name="chevR" size={13} />
            </button>
          </span>
        );
      case 'roam':
        return (
          <span key={index}>
            {sep}
            <button
              type="button"
              className={doorClass}
              onClick={() => {
                useIdleStore.getState().setSelectedRoamingArea(source.areaId);
                onNavigate?.('home');
              }}
            >
              Roam {source.areaName} <PxIcon name="chevR" size={13} />
            </button>
            {source.home ? <span className="text-text-muted"> its home area</span> : null}
          </span>
        );
      case 'vendor':
        return (
          <span key={index}>
            {sep}
            <button type="button" className={doorClass} onClick={() => onNavigate?.('market:vendor')}>
              Vendor rotation <PxIcon name="chevR" size={13} />
            </button>
          </span>
        );
      case 'market':
        return (
          <span key={index}>
            {sep}
            <button
              type="button"
              className={doorClass}
              onClick={() => {
                useMarketStore.getState().requestBuyBrowse(isMaterialInput(inputId) ? 'material' : 'essence', inputLabel(inputId));
                onNavigate?.('market:buy');
              }}
            >
              Market <PxIcon name="chevR" size={13} />
            </button>
          </span>
        );
    }
  };
  return (
    <div className="pl-1 text-[11px] leading-snug text-text-secondary">
      <span className="text-text-muted">Get it: </span>
      {sources.map(renderSource)}
    </div>
  );
};

// ─── Gate lines: every gate, with its door ───────────────────────────

export const GateLines: React.FC<{
  gates: RecipeGate[];
  onNavigate?: (screen: string) => void;
  onOpenBenches: () => void;
}> = ({ gates, onNavigate }) => {
  const door = (gate: RecipeGate) => {
    if (gate.door === 'research') {
      return (
        <button type="button" onClick={() => onNavigate?.('research')} className="ml-1 inline-flex items-center gap-0.5 font-black text-amber">
          Research, Hunter tab <PxIcon name="chevR" size={13} />
        </button>
      );
    }
    if (gate.door === 'repdesk') {
      return (
        <button type="button" onClick={() => onNavigate?.('market:repdesk')} className="ml-1 inline-flex items-center gap-0.5 font-black text-amber">
          Rep Desk <PxIcon name="chevR" size={13} />
        </button>
      );
    }
    return null;
  };
  return (
    <div className="space-y-1">
      {gates.map((gate, i) => (
        <div key={`${gate.family}-${i}`} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <span className={`mt-px shrink-0 ${gate.met ? 'text-green' : 'text-red'}`}>
            <PxIcon name={gate.met ? 'check' : 'lock'} size={13} />
          </span>
          <span className={gate.met ? 'text-text-muted' : 'font-bold text-text-primary'}>
            {gate.label}
            {door(gate)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── The inspect sheet: the detail behind the (i) ────────────────────

export const RecipeInspectSheet: React.FC<{
  recipe: CraftRecipe;
  ctx: WorkshopPlayerContext;
  readiness: RecipeReadiness;
  bench: number;
  useCatalyst: boolean;
  onClose: () => void;
  onNavigate?: (screen: string) => void;
  onOpenBenches: () => void;
  onRefineFocus: (recipeId: string) => void;
}> = ({ recipe, ctx, readiness, bench, useCatalyst, onClose, onNavigate, onOpenBenches, onRefineFocus }) => {
  const purpose = recipePurpose(recipe, ctx);
  const def = recipe.consumableType ? CONSUMABLES[recipe.consumableType] : undefined;
  const bounds =
    recipe.kind === 'refine'
      ? null
      : craftQualityBounds({
          consumableType: recipe.kind === 'consumable' ? recipe.consumableType : null,
          masteryLevel: masteryLevel(ctx, recipe.kind === 'gear' ? 'crafting.gear' : recipe.kind === 'cosmetic' ? 'crafting.cosmetics' : 'crafting_consumables'),
          bench,
          catalyst: useCatalyst,
        });
  const temperChance =
    recipe.kind === 'gear'
      ? Math.round(gearTemperChance(masteryLevel(ctx, 'crafting.gear'), GEAR_TEMPER_BASE_CHANCE_DEFAULT) * 100)
      : null;
  const refineRange =
    recipe.kind === 'refine'
      ? refineOutputRange(recipe, masteryLevel(ctx, 'crafting.refining'), REFINE_BASE_YIELD_DEFAULT)
      : null;
  const refineOut = refineRange
    ? refineRange.max > refineRange.min
      ? `${refineRange.min}–${refineRange.max}`
      : `${refineRange.min}`
    : null;
  const relic = recipe.namedRelic ? craftRelicByName(recipe.namedRelic) : undefined;

  return (
    <PickerSheet title={recipe.name} subtitle="Recipe detail" onClose={onClose}>
      <div className="space-y-3 p-3" data-testid="recipe-inspect-sheet">
        {/* What it does — the full description/purpose. */}
        <div className="space-y-1">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber">What it does</div>
          <div className="text-[11px] leading-relaxed text-text-secondary">{purpose.text}</div>
          {purpose.hint && <div className="text-[11px] leading-relaxed text-text-muted">{purpose.hint}</div>}
          {def && def.description !== def.shortDescription && (
            <div className="text-[11px] leading-relaxed text-text-secondary">{def.description}</div>
          )}
          {def && (
            <div className="space-y-0.5 text-[11px] leading-relaxed text-text-muted">
              <div>Role: {def.tacticalRole}</div>
              <div>Effect: {def.effect}</div>
              {def.uiHints
                .filter((hint) => hint !== purpose.hint)
                .map((hint) => (
                  <div key={hint}>{hint}</div>
                ))}
            </div>
          )}
        </div>

        {/* Quality — this item's range, and what the % means for it. */}
        <div className="space-y-1">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber">Quality</div>
          {bounds ? (
            <div className="space-y-0.5 text-[11px] leading-relaxed text-text-secondary">
              <div>
                Your roll: <span className="font-black text-text-primary">{Math.round(bounds.min)}–{Math.round(bounds.max)}%</span>
                {' '}· {getConsumableQualityBand(Math.round(bounds.max))} ceiling
              </div>
              <div>
                The % is the share of the item’s base effect you actually get — 100% is exactly Vendor strength, and anything over it beats store-bought.
              </div>
              {def && <div>For this item: {def.quality.scalingSummary}</div>}
              {recipe.kind === 'cosmetic' && <div>The finished part carries the rolled % as its finish quality.</div>}
              {temperChance !== null && <div>Epic frames can finish tempered (a bonus stat roll) — your temper chance is {temperChance}%.</div>}
            </div>
          ) : recipe.kind === 'refine' ? (
            <div className="text-[11px] leading-relaxed text-text-secondary">
              Refining rolls no quality — the yield is the number: {refineOut} out per unit at your Refining mastery {masteryLevel(ctx, 'crafting.refining')}, rising toward 10 back for 10 as mastery grows.
            </div>
          ) : relic ? (
            <div className="text-[11px] leading-relaxed text-text-secondary">
              {relic.blurb} Equip it on your hunter and its workshop effects apply to every job
              while worn — permanently; relics never wear out.
            </div>
          ) : null}
        </div>

        {/* What it takes — per-unit materials, have counts, sources. */}
        <div className="space-y-1">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber">What it takes — per unit</div>
          {Object.entries(recipe.inputs).map(([key, per]) => {
            const have = isMaterialInput(key) ? (ctx.materials[key] ?? 0) : (ctx.essences[key] ?? 0);
            const short = have < per;
            return (
              <React.Fragment key={key}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary">{inputLabel(key)}</span>
                  <span className="inline-flex items-center">
                    <span className={short ? 'font-bold text-red' : 'font-bold text-text-primary'}>
                      {have.toLocaleString('en-US')}
                      <span className="text-text-muted"> / {per}</span>
                      {short ? <span> · short {per - have}</span> : null}
                    </span>
                    {/* QB-1: the same lone + as the card face. */}
                    {short && key !== 'Scrap' && (
                      <QuickBuyPlus
                        good={{ kind: isMaterialInput(key) ? 'material' : 'essence', id: key }}
                        goodName={inputLabel(key)}
                        shortfall={per - have}
                        contextLabel={recipe.name}
                        onNavigate={onNavigate}
                        onRefineFocus={onRefineFocus}
                      />
                    )}
                  </span>
                </div>
                {short && <SourceLine inputId={key} onNavigate={onNavigate} onRefineFocus={onRefineFocus} />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Gates — the full list, materials included (this is the
            detail surface; the card face never re-narrates them). */}
        <div className="space-y-1">
          <div className="text-[11px] font-black uppercase tracking-wider text-amber">Gates</div>
          <GateLines gates={readiness.gates} onNavigate={onNavigate} onOpenBenches={onOpenBenches} />
          {readiness.canEnqueue && <div className="text-[11px] font-bold text-green">Every gate is met — this can queue right now.</div>}
        </div>
      </div>
    </PickerSheet>
  );
};
