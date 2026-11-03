/**
 * ActionLoadout — the loadout doll.
 *
 * Two modes (Phase 1: one gear home):
 *  - Manage mode (the merged Gear page, Exec C "the Split" — owner
 *    layout, 2026-11-03): tap any slot block to open the Slot
 *    Picker — the one equip surface. The doll zone is the Split: a
 *    compact figure stage sized to the hunter (Wardrobe door on the
 *    stage, the DPS/HP hero plate at its foot), the three gun slots
 *    as full rows down the right column (Primary as a poster row),
 *    and the four accessories as a 2×2 band beneath. Block content
 *    comes from slotBlockSummary — this component renders segments,
 *    it does not pick stats. No collapse toggle here (INVENTORY L4):
 *    the merged page is a scroll surface and the zone is compact by
 *    construction. The belt chips ride under the zone.
 *  - Read-only mode (Fight tab): display only; slot taps and the
 *    Manage button route to the gear home via `onManageLoadout`.
 *    This mode keeps the earlier composition — the figure band over
 *    the 3-column slot-chip constellation, with the collapse toggle
 *    and the header DPS/HP readouts — untouched by the merge.
 *
 * The wallet prints ONCE, in the Strip (F1): this panel carries no
 * Credits / Scrap / Items / Keys row in either mode.
 *
 * Read-only layout (3-column grid, expanded):
 *   Row 1:   (figure)   Secondary      Heavy
 *   Row 2:   Shield     ★PRIMARY★    Class Mod
 *   Row 3:   (figure)   Relic         Ordnance
 */
import React, { useCallback, useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLoadoutStore, usePlayerStore, useInventoryStore, useSkillStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { ConsumablesChips } from '@/components/action/ConsumablesChips';
import { SlotGearPicker } from '@/components/action/SlotGearPicker';
import { PresetSwitcher } from '@/components/action/PresetSwitcher';
import { SwapUndoToast } from '@/components/action/SwapUndoToast';
import { PixelPartsActor } from '@/components/pixelArt/PixelPartsActor';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { hunterPartSet, headVariantPreference } from '@/lib/pixel/headParts';
import { mountedGearForLoadout } from '@/lib/pixel/gearMounts';
import { loadoutEffectiveDps } from '@/lib/combat/loadoutSurvival';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import {
  ACCESSORY_SLOTS,
  elementTintOf,
  GUN_SLOTS,
  slotBlockSummary,
  type SlotBlockSummary,
} from '@/lib/loadout/slotBlockSummary';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';
import { SKILL_NODES } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import type { GearItem, Weapon, Shield as ShieldItem, ClassMod, Relic, Ordnance } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const COLLAPSE_STORAGE_KEY = 'cybercache_action_loadout_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch { return false; }
}

function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_STORAGE_KEY, v ? '1' : '0'); } catch { /* noop */ }
}

const SLOT_CONFIG: Array<{
  slot: LoadoutSlot;
  label: string;
  icon: PxIconName;
  row: number;
  col: number;
  isCenter?: boolean;
}> = [
  { slot: 'secondary',  label: 'Secondary', icon: 'rings', row: 1, col: 2 },
  { slot: 'heavy',      label: 'Heavy',     icon: 'rings', row: 1, col: 3 },
  { slot: 'shield',     label: 'Shield',    icon: 'shield', row: 2, col: 1 },
  { slot: 'primary',    label: 'Primary',   icon: 'rings', row: 2, col: 2, isCenter: true },
  { slot: 'classMod',   label: 'Mod',       icon: 'gem', row: 2, col: 3 },
  { slot: 'relic',      label: 'Relic',     icon: 'diamond', row: 3, col: 2 },
  { slot: 'ordnance',   label: 'Ordnance',  icon: 'bolt', row: 3, col: 3 },
];

const SATURATED: Record<string, string> = {
  Common:    '#A5A7B5',
  Uncommon:  '#7CFC00',
  Rare:      '#5AA7FF',
  Epic:      '#FF9DF5',
  Legendary: '#FFEA3A',
};

function slotItem(
  loadout: ReturnType<typeof useLoadoutStore.getState>,
  slot: string,
): Weapon | ShieldItem | ClassMod | Relic | Ordnance | null {
  switch (slot) {
    case 'primary':   return loadout.getWeapon('primary') ?? null;
    case 'secondary': return loadout.getWeapon('secondary') ?? null;
    case 'heavy':     return loadout.getWeapon('heavy') ?? null;
    case 'shield':    return loadout.getShield() ?? null;
    case 'classMod':  return loadout.getClassMod() ?? null;
    case 'relic':     return loadout.getRelic() ?? null;
    case 'ordnance':  return loadout.getOrdnance() ?? null;
    default:          return null;
  }
}

// ── SVG star connectors (unchanged) ───────────────────────────────

const STAR_LINES: Array<[number, number, number, number]> = [
  [2,2,1,2], [2,2,2,3], [2,2,3,3], [2,2,3,2], [2,2,2,1], [2,2,1,3],
  [1,2,2,1], [1,2,1,3], [2,1,3,2], [2,3,3,3], [1,3,2,3], [3,2,3,3],
];

function gridPct(row: number, col: number): [number, number] {
  const xPct = ((col - 1) / 2) * 100;
  const yPct = ((row - 1) / 2) * 100;
  return [xPct, yPct];
}

const StarConnectors: React.FC = () => (
  <svg className="pointer-events-none absolute inset-0 z-0" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden>
    {STAR_LINES.map(([r1, c1, r2, c2], i) => {
      const [x1, y1] = gridPct(r1, c1);
      const [x2, y2] = gridPct(r2, c2);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FF9000" strokeOpacity="0.18" strokeWidth="0.5" strokeDasharray="2 4" />;
    })}
  </svg>
);

// ── Slot chip (now a button) ──────────────────────────────────────

const SlotChip: React.FC<{
  label: string;
  icon: PxIconName;
  item: Weapon | ShieldItem | ClassMod | Relic | Ordnance | null;
  isCenter?: boolean;
  onClick: () => void;
}> = ({ label, icon, item, isCenter, onClick }) => {
  const filled = !!item;
  const accent = item?.rarity ? SATURATED[item.rarity] ?? '#8A847C' : '#8A847C';
  const name = item?.name ?? (isCenter ? 'No weapon' : 'Open');
  // Weapon slots render the ACTUAL instance through the compositor
  // (the same render the Trophy Shelf uses) — never a generic icon
  // standing in for a rolled gun. Non-weapon slots carry no
  // compositor art; their instances mount on the figure above.
  const weapon = item && 'weaponType' in item ? (item as Weapon) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 border-2 px-1.5 py-1.5 text-center transition-all active:scale-[0.97] ${
        isCenter
          ? 'border-amber/60 bg-amber/10 shadow-[0_0_18px_rgba(255,144,0,0.18)]'
          : filled
            ? 'border-border bg-bg/70 hover:border-amber/40'
            : 'border-border bg-bg/40 opacity-55 hover:opacity-80'
      }`}
      style={{
        ...signClip,
        ...(filled && !isCenter ? { borderColor: `${accent}55`, boxShadow: `inset 0 0 0 1px ${accent}20` } : {}),
      }}
    >
      <div className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-text-muted">
        <span className="inline-flex shrink-0" style={{ color: filled ? accent : undefined }}><PxIcon name={icon} size={15} /></span>
        <span>{label}</span>
      </div>
      {weapon && (
        <PixelWeapon weapon={weapon} size={84} className="my-0.5 max-w-full" testId={`slot-weapon-${label.toLowerCase()}`} />
      )}
      <div
        className={`max-w-full font-black leading-snug [overflow-wrap:anywhere] ${isCenter ? 'text-[13px]' : 'text-[11px]'}`}
        style={{ color: filled ? accent : '#8A847C' }}
      >
        {name}
      </div>
      {filled && (
        <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: accent }}>
          {item.rarity}
        </div>
      )}
    </button>
  );
};

// ── Merged-page slot blocks (Exec C — the Split) ──────────────────
// The gear home's slot surfaces: gun rows down the right column and
// accessory cards in the band beneath. Content comes from
// slotBlockSummary (the one place that picks what a block prints);
// these components only render it. Every block is the slot's picker
// door — the same tap the constellation chips carried.

const BLOCK_ICONS: Record<LoadoutSlot, PxIconName> = {
  primary: 'rings',
  secondary: 'rings',
  heavy: 'rings',
  shield: 'shield',
  classMod: 'gem',
  relic: 'diamond',
  ordnance: 'bolt',
};

type BlockItem = Weapon | ShieldItem | ClassMod | Relic | Ordnance | null;

const blockAccent = (item: BlockItem): string =>
  item?.rarity ? SATURATED[item.rarity] ?? '#8A847C' : '#8A847C';

const weaponOf = (item: BlockItem): Weapon | null =>
  item && 'weaponType' in item ? (item as Weapon) : null;

/** The block's perk line: muted segments, the headline's value in
 *  ink. Rarity and element never print here (owner ruling
 *  2026-11-03) — the name carries rarity's color, the icon and the
 *  item's own render carry the element's. */
const PerkLine: React.FC<{ block: SlotBlockSummary }> = ({ block }) => {
  const segments = block.statSegments;
  return (
    <span className="block text-[11px] font-bold leading-snug text-text-muted">
      {segments.map((segment, i) => {
        // Bold the headline segment's trailing value when it is one
        // ("DPS 486" → 486 in ink; a free-text headline like a
        // relic's affix bolds whole).
        const split = i === 0 ? segment.lastIndexOf(' ') : -1;
        const valueLike = split > 0 && /[0-9+]/.test(segment.charAt(split + 1));
        return (
          <React.Fragment key={`${segment}-${i}`}>
            {i > 0 && ' · '}
            {i === 0 && valueLike ? (
              <>
                {segment.slice(0, split)}{' '}
                <span className="font-black text-text-primary">{segment.slice(split + 1)}</span>
              </>
            ) : i === 0 ? (
              <span className="font-black text-text-primary">{segment}</span>
            ) : (
              segment
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
};

/** Primary — the poster row: name at poster-chip size, the weapon's
 *  own wide render beneath it, the full stat line under that. */
const GunPosterRow: React.FC<{
  block: SlotBlockSummary;
  item: BlockItem;
  onClick: () => void;
}> = ({ block, item, onClick }) => {
  const accent = blockAccent(item);
  const weapon = weaponOf(item);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`slot-block-${block.slot}`}
      aria-label={block.filled ? `${block.slotLabel}: ${block.name} — tap to change` : `${block.slotLabel}: empty — tap to equip`}
      className="relative w-full border-2 px-2.5 py-2 text-left transition-all active:scale-[0.99]"
      style={{
        ...signClip,
        borderColor: block.filled ? `${accent}66` : 'rgba(255,255,255,0.08)',
        background: 'linear-gradient(90deg, rgba(255,160,31,0.10), transparent 72%)',
      }}
    >
      <span className="flex items-center gap-1.5">
        {/* The icon carries the ELEMENT's color (owner ruling
            2026-11-03: element reads by color, never by word);
            the name beside it carries the rarity's. */}
        <PxIcon name={BLOCK_ICONS[block.slot]} size={15} className="shrink-0" style={{ color: elementTintOf(item) ?? accent }} />
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-black"
          style={{ color: block.filled ? accent : '#8A847C' }}
        >
          {block.name}
        </span>
        <PxIcon name="chevR" size={13} className="shrink-0 text-text-muted" />
      </span>
      {weapon && (
        <PixelWeapon weapon={weapon} size={164} className="my-1 max-w-full" testId="slot-weapon-primary" />
      )}
      <PerkLine block={block} />
    </button>
  );
};

/** Secondary / Heavy — a full row: the weapon's own render in a
 *  thumb tile, name + stat line beside it. */
const GunRow: React.FC<{
  block: SlotBlockSummary;
  item: BlockItem;
  onClick: () => void;
}> = ({ block, item, onClick }) => {
  const accent = blockAccent(item);
  const weapon = weaponOf(item);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`slot-block-${block.slot}`}
      aria-label={block.filled ? `${block.slotLabel}: ${block.name} — tap to change` : `${block.slotLabel}: empty — tap to equip`}
      className={`flex min-h-[52px] w-full items-center gap-2 border px-2 py-1.5 text-left transition-all active:scale-[0.99] ${
        block.filled ? 'border-border bg-bg/60' : 'border-border bg-bg/40 opacity-70'
      }`}
      style={signClip}
    >
      <span className="flex w-16 shrink-0 items-center justify-center">
        {weapon ? (
          <PixelWeapon weapon={weapon} size={64} className="max-w-full" testId={`slot-weapon-${block.slot}`} />
        ) : (
          <PxIcon name={BLOCK_ICONS[block.slot]} size={17} className="text-text-muted" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[11px] font-black"
          style={{ color: block.filled ? accent : '#8A847C' }}
        >
          {block.name}
        </span>
        <PerkLine block={block} />
      </span>
      <PxIcon name="chevR" size={13} className="shrink-0 text-text-muted" />
    </button>
  );
};

/** An accessory card in the band: the item's own art in a 44px tile,
 *  the slot as eyebrow, the name in rarity color, the headline stat.
 *  Visually quieter than the guns — dim border, no amber. */
const AccessoryCard: React.FC<{
  block: SlotBlockSummary;
  item: BlockItem;
  onClick: () => void;
}> = ({ block, item, onClick }) => {
  const accent = blockAccent(item);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`slot-block-${block.slot}`}
      aria-label={block.filled ? `${block.slotLabel}: ${block.name} — tap to change` : `${block.slotLabel}: empty — tap to equip`}
      className={`flex min-h-[60px] items-center gap-2 border p-2 text-left transition-all active:scale-[0.99] ${
        block.filled ? 'border-border/70 bg-bg/50' : 'border-border/70 bg-bg/30 opacity-70'
      }`}
      style={signClip}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-border/60 bg-bg/70">
        {item ? (
          <GearIllustration item={item as GearItem} size={44} showBadges={false} />
        ) : (
          <PxIcon name={BLOCK_ICONS[block.slot]} size={17} className="text-text-muted" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-black uppercase tracking-wider text-text-muted">
          {block.slotLabel}
        </span>
        <span
          className="block truncate text-[11px] font-black"
          style={{ color: block.filled ? accent : '#8A847C' }}
        >
          {block.name}
        </span>
        <PerkLine block={block} />
      </span>
    </button>
  );
};

// ── Main component ─────────────────────────────────────────────────

export interface ActionLoadoutProps {
  className?: string;
  /**
   * Read-only display mode (Phase 1: one gear home). Slot taps and the
   * Manage button route through `onManageLoadout` — the ONE door into
   * the gear home (Inventory → Loadout). No picker, no presets, no
   * equip/unequip controls render in this mode.
   */
  readOnly?: boolean;
  onManageLoadout?: () => void;
  /**
   * Gear-home deep link: when set at mount (e.g. GearHub's Equip action
   * picked a slot and the home switched to this tab), the picker for
   * that slot starts open. Mount-only — the home mounts this component
   * fresh when the Loadout tab is entered.
   */
  requestedPickerSlot?: LoadoutSlot | null;
  /**
   * Merged-page picker signal: open the picker for this slot when
   * `seq` changes — the merged page's Inventory section routes its
   * Equip actions here while the page (and this panel) stays
   * mounted. Manage mode only.
   */
  pickerRequest?: { slot: LoadoutSlot; seq: number } | null;
  /**
   * Manage mode: the Wardrobe door on the figure stage (canonical
   * home stays Hunter → Profile; this is the DESIGN §9 secondary
   * door the owner placed on the stage).
   */
  onOpenWardrobe?: () => void;
}

export const ActionLoadout: React.FC<ActionLoadoutProps> = ({
  className,
  readOnly = false,
  onManageLoadout,
  requestedPickerSlot = null,
  pickerRequest = null,
  onOpenWardrobe,
}) => {
  const loadout = useLoadoutStore();
  const inventory = useInventoryStore();
  const reduceMotion = useReducedMotion();
  // Subscribe to consumable changes so the chips re-render
  usePlayerStore((s) => s.consumables);
  useLoadoutStore((s) => s.consumables);
  // Subscribe to skill tree DPS changes — loadoutEffectiveDps() calls getState() internally
  // for skill bonuses, so we must force a re-render when spent points change.
  const spent = useSkillStore((s) => s.spent);
  // HP is the panel's second headline number (the mock's header line:
  // DPS · HP). The survival store owns the live max — the same read
  // the Home deck uses. The Strip prints neither, so no duplication.
  const maxHp = useSurvivalStore((s) => s.maxHp);

  const dps = loadoutEffectiveDps();

  // The figure: the parts actor wearing the ACTUAL equipped
  // instances — primary weapon held grip-to-grip, shield / relic /
  // class-mod pauldron / belt consumables mounted via the shared
  // gearMounts derivation (the same one the Home stage uses, M3).
  // Unarmed hunters stand relaxed with empty hands (real-item
  // invariant: no phantom weapon layer exists).
  const figureWeapon = loadout.getWeapon('primary');
  const figureGear = useMemo(
    () =>
      mountedGearForLoadout({
        shield: loadout.getShield(),
        relic: loadout.getRelic(),
        classMod: loadout.getClassMod(),
        consumables: [loadout.consumables.PreFight, loadout.consumables.MidFight, loadout.consumables.Emergency],
      }),
    [loadout],
  );
  // CONS-04: gear slots only (7) via the shared loadout read model —
  // the vehicle slot in the raw map is not gear.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadout.slots, inventory.items));
  const emptyLoadout = equippedCount === 0;

  // Auto-expand when loadout is empty — the player needs to see what to fill.
  // A mount-time picker request (gear-home deep link) also forces expand.
  // Flow audit F3: in the gear home (manage mode) the panel ALWAYS
  // mounts expanded — a persisted collapse used to hide the entire
  // slot grid behind a header + preset switcher, so the one equip
  // surface mounted with nothing to tap. Collapse persistence now
  // belongs only to read-only display contexts (the Fight tab).
  const [collapsed, setCollapsed] = useState(() => {
    if (requestedPickerSlot) return false;
    if (emptyLoadout) return false; // always expand for empty loadout
    if (!readOnly) return false; // gear home: slots reachable on arrival
    return readCollapsed();
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Gear-home deep link: a mount-time request starts with that slot's
  // picker already open (read-only displays never open the picker).
  const [pickerSlot, setPickerSlot] = useState<LoadoutSlot | null>(() =>
    readOnly ? null : requestedPickerSlot,
  );

  const handleSlotTap = (slot: LoadoutSlot) => {
    if (readOnly) {
      onManageLoadout?.();
      return;
    }
    setPickerSlot(slot);
  };
  const [undo, setUndo] = useState<{ slot: LoadoutSlot; previousId: string | null; name: string } | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      // Only display contexts persist the collapse (F3) — a collapse
      // made in the gear home must not hide the equip grid next visit.
      if (readOnly) saveCollapsed(next);
      return next;
    });
  }, [readOnly]);

  const onEquip = useCallback(async (itemId: string) => {
    if (!pickerSlot) return;
    setBusy(true);
    setError(null);
    setUndo(null);
    const previousId = loadout.slots[pickerSlot] ?? null;
    const item = inventory.items.find((i) => i.id === itemId);
    try {
      await verifiedOps.equipItem(itemId, pickerSlot);
      setPickerSlot(null);
      if (item) {
        setUndo({ slot: pickerSlot, previousId, name: item.name });
      }
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  }, [pickerSlot, inventory.items, loadout.slots, setUndo, setPickerSlot, setBusy, setError]);

  const onUnequip = useCallback(async () => {
    if (!pickerSlot) return;
    setBusy(true);
    setError(null);
    setUndo(null);
    try {
      await verifiedOps.unequipSlot(pickerSlot);
      setPickerSlot(null);
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  }, [pickerSlot, setBusy, setError, setUndo, setPickerSlot]);

  const handleUndo = useCallback(async () => {
    if (!undo) return;
    setBusy(true);
    setError(null);
    try {
      if (undo.previousId) {
        await verifiedOps.equipItem(undo.previousId, undo.slot);
      } else {
        await verifiedOps.unequipSlot(undo.slot);
      }
      setUndo(null);
    } catch (err) {
      setError(formatRpcError(err));
    } finally {
      setBusy(false);
    }
  }, [undo, setBusy, setError, setUndo]);

  // Merged-page picker signal (render-phase derived state, the
  // InventoryScreen precedent): a fresh seq opens that slot's picker
  // without remounting the page.
  const [appliedPickerSeq, setAppliedPickerSeq] = useState<number | null>(null);
  if (!readOnly && pickerRequest && pickerRequest.seq !== appliedPickerSeq) {
    setAppliedPickerSeq(pickerRequest.seq);
    setPickerSlot(pickerRequest.slot);
  }

  // Build identity (merged-page header, right side): the dominant
  // skill tree — most points spent, ties break in enum order — and
  // the active preset's name ("Gunslinger · Boss Kit"). Print only
  // what exists: a fresh account shows neither clause.
  const presets = useLoadoutPresetsStore((s) => s.presets);
  const activePresetId = useLoadoutPresetsStore((s) => s.activePresetId);
  const activePresetName = presets.find((p) => p.id === activePresetId)?.name ?? null;
  const buildTree = useMemo(() => {
    const byTree = new Map<string, number>();
    for (const node of SKILL_NODES) {
      const points = spent[node.id] ?? 0;
      if (points > 0) byTree.set(node.tree, (byTree.get(node.tree) ?? 0) + points);
    }
    let best: string | null = null;
    let bestPoints = 0;
    for (const tree of Object.values(SkillTreeType)) {
      const points = byTree.get(tree) ?? 0;
      if (points > bestPoints) {
        best = tree;
        bestPoints = points;
      }
    }
    return best;
  }, [spent]);
  const buildIdentity = [buildTree, activePresetName].filter(Boolean).join(' · ');

  const currentItemId = pickerSlot ? loadout.slots[pickerSlot] : null;

  return (
    <section
      data-testid="action-loadout"
      className={`relative overflow-hidden border-2 border-border bg-surface/95 p-3 ${className ?? ''}`}
      style={{ clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' }}
    >
      {/* Header. The wallet is NOT re-printed here — the Strip (F1)
          owns Credits / Scrap / Keys / Items. Read-only displays
          keep the collapse-toggle header with DPS/HP; the merged
          gear page (manage mode) prints the build identity instead
          and moves DPS/HP to the figure stage's hero plate — and
          has NO collapse toggle (INVENTORY L4: the merged page is a
          scroll surface; the Split zone is compact by construction). */}
      {readOnly ? (
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 text-left hover:text-amber transition-colors"
        >
          <PxIcon name="rings" size={17} className="shrink-0 text-amber" />
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber">Loadout</div>
            {/* Assumption-gaps G4: the /7 denominator is taught
                here, at the counter's destination surface — the
                header names what the 7 counts (gear slots) over
                the seven-slot constellation below. The Strip's
                one-line law leaves no room to teach it there. */}
            <div className="text-sm font-black text-text-primary">{equippedCount}/7 Gear slots</div>
            {!readOnly && <div className="text-[11px] font-bold text-text-muted">Tap a slot to equip</div>}
          </div>
        </button>
        <div className="flex items-center gap-2">
          {readOnly && (
            <button
              type="button"
              onClick={onManageLoadout}
              className="bl-primary px-2.5 py-1.5 text-[11px] font-black"
            >
              Manage
            </button>
          )}
          <div className="text-right">
            <div className="text-[11px] font-black uppercase tracking-widest text-text-muted">DPS</div>
            <div className={`text-lg font-black ${dps > 0 ? 'text-amber' : 'text-text-muted'}`}>
              {dps > 0 ? dps.toFixed(0) : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-black uppercase tracking-widest text-text-muted">HP</div>
            <div className="text-lg font-black text-text-primary">{Math.round(maxHp)}</div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="bl-secondary p-1.5 text-text-muted hover:text-amber"
            aria-label={collapsed ? 'Expand loadout' : 'Collapse loadout'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>
      ) : (
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PxIcon name="rings" size={17} className="shrink-0 text-amber" />
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber">Loadout</div>
            <div className="text-sm font-black text-text-primary">{equippedCount}/7 Gear slots</div>
            <div className="text-[11px] font-bold text-text-muted">Tap a slot to equip</div>
          </div>
        </div>
        {buildIdentity && (
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-black uppercase tracking-widest text-text-muted">Build</div>
            <div className="text-[13px] font-bold text-text-primary">{buildIdentity}</div>
          </div>
        )}
      </div>
      )}

      {/* Collapsed summary strip — presets are management, so they live
          only in the gear home (hidden in read-only display mode). */}
      {collapsed && !readOnly && (
        <div className="mt-2">
          <PresetSwitcher />
        </div>
      )}
      {collapsed && readOnly && (
        <div className="mt-2 text-[11px] text-text-muted">
          Gear is managed in one place — tap Manage to open your Loadout.
        </div>
      )}

      {/* Expanded body — the doll: figure first, then the compact
          constellation, then the belt. Rows size to their chips (the
          old 75%-aspect stage box stretched every row and left the
          panel mostly air — the fidelity audit's Gear finding). */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {readOnly ? (
            <>
            {/* The equipped hunter, wearing the actual loadout. */}
            <div
              data-testid="loadout-figure"
              className="relative mt-3 h-[176px] overflow-hidden border border-border/60 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,144,0,0.13),rgba(0,0,0,0.25)_70%)]"
            >
              <PixelPartsActor
                set={hunterPartSet(headVariantPreference())}
                xPct={50}
                heightPct={96}
                groundY={0.97}
                reduced={reduceMotion ?? false}
                pose={figureWeapon ? 'idle' : 'relaxed'}
                weapon={figureWeapon}
                weaponTestId="loadout-held-weapon"
                testId="loadout-hunter"
                gear={figureGear}
              />
            </div>

            <div className="relative mt-2">
              <StarConnectors />
              <div
                className="relative z-10 grid gap-1.5"
                style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
              >
                {SLOT_CONFIG.map(({ slot, label, icon, row, col, isCenter }) => {
                  const item = slotItem(loadout, slot);
                  return (
                    <div key={slot} style={{ gridRow: row, gridColumn: col }}>
                      <SlotChip
                        label={label}
                        icon={icon}
                        item={item}
                        isCenter={isCenter}
                        onClick={() => handleSlotTap(slot)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            </>
            ) : (
            <>
            <div className="mt-2">
              <PresetSwitcher />
            </div>

            {/* The Split (Exec C — owner layout): figure stage left,
                gun rows right. The stage is sized to the hunter —
                the figure fills it, the Wardrobe door rides its
                top-left corner, and the DPS/HP hero plate sits at
                its foot (the statistics that used to crowd the
                header). */}
            <div className="mt-3 flex gap-2">
              <div
                data-testid="loadout-figure"
                className="relative h-[257px] w-[152px] shrink-0 overflow-hidden border border-border/60 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,144,0,0.13),rgba(0,0,0,0.25)_70%)]"
              >
                <PixelPartsActor
                  set={hunterPartSet(headVariantPreference())}
                  xPct={50}
                  heightPct={91}
                  groundY={0.97}
                  reduced={reduceMotion ?? false}
                  pose={figureWeapon ? 'idle' : 'relaxed'}
                  weapon={figureWeapon}
                  weaponTestId="loadout-held-weapon"
                  testId="loadout-hunter"
                  gear={figureGear}
                />
                {onOpenWardrobe && (
                  <button
                    type="button"
                    onClick={onOpenWardrobe}
                    data-testid="loadout-wardrobe-door"
                    className="absolute left-2 top-2 z-10 flex min-h-[32px] items-center gap-1 border border-border bg-bg/85 px-2 py-1 text-[11px] font-black text-text-secondary backdrop-blur-sm transition-colors hover:text-amber"
                  >
                    <PxIcon name="person" size={13} className="text-amber" />
                    Wardrobe
                    <PxIcon name="chevR" size={11} className="text-text-muted" />
                  </button>
                )}
                <div
                  data-testid="loadout-stage-plate"
                  className="absolute inset-x-2 bottom-2 z-10 border border-border/60 bg-[#0b0e15]/90 px-2 py-1.5"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-black uppercase tracking-widest text-text-muted">DPS</span>
                    <span className={`text-lg font-black leading-none ${dps > 0 ? 'text-amber' : 'text-text-muted'}`}>
                      {dps > 0 ? dps.toFixed(0) : '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[11px] font-black uppercase tracking-widest text-text-muted">HP</span>
                    <span className="text-lg font-black leading-none text-text-primary">{Math.round(maxHp)}</span>
                  </div>
                </div>
              </div>

              {/* The guns — full rows down the right column, Primary
                  as the poster row. */}
              <div className="min-w-0 flex-1 space-y-1.5">
                {GUN_SLOTS.map((slot) => {
                  const item = slotItem(loadout, slot);
                  const block = slotBlockSummary(slot, item);
                  return slot === 'primary' ? (
                    <GunPosterRow key={slot} block={block} item={item} onClick={() => handleSlotTap(slot)} />
                  ) : (
                    <GunRow key={slot} block={block} item={item} onClick={() => handleSlotTap(slot)} />
                  );
                })}
              </div>
            </div>

            {/* Accessories — the 2×2 band directly beneath the zone,
                quieter than the guns. */}
            <div className="mt-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Accessories</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {ACCESSORY_SLOTS.map((slot) => {
                  const item = slotItem(loadout, slot);
                  const block = slotBlockSummary(slot, item);
                  return (
                    <AccessoryCard key={slot} block={block} item={item} onClick={() => handleSlotTap(slot)} />
                  );
                })}
              </div>
            </div>
            </>
            )}

            {/* The belt, under the doll (merged-page order). The chips are a
                quick count view of the slotted items only: roaming
                auto-activates ALL owned roaming consumables, slotted
                or not — the caption says so plainly, and carries the
                server-side fact the old Gear intro sentence held. */}
            <div className="mt-3">
              <ConsumablesChips className="text-[11px]" />
              <div className="mt-1 text-[11px] font-bold text-text-muted">
                Belt — all owned consumables auto-activate while roaming. Changes verify server-side; no Save button.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slot gear picker sheet — THE equip surface. It renders only in
          the gear home's manage mode, never on read-only displays. */}
      <AnimatePresence>
        {!readOnly && pickerSlot && (
          <SlotGearPicker
            slot={pickerSlot}
            currentItemId={currentItemId}
            onClose={() => setPickerSlot(null)}
            onEquip={onEquip}
            onUnequip={onUnequip}
            busy={busy}
            error={error}
          />
        )}
      </AnimatePresence>

      {/* Error banner */}
      {error && (
        <div className="mt-2 rounded-xl border border-red/30 bg-red/10 p-2 text-xs text-red-light">{error}</div>
      )}

      {/* Swap undo toast */}
      <SwapUndoToast
        visible={!!undo}
        itemName={undo?.name ?? ''}
        previousName={undo?.previousId ? inventory.items.find((i) => i.id === undo.previousId)?.name ?? null : null}
        onUndo={handleUndo}
        onDismiss={() => setUndo(null)}
      />
    </section>
  );
};
