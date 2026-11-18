import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion } from 'framer-motion';
import { Lock, RotateCcw } from 'lucide-react';
import { getSkillTreeNodes, SKILL_NODES } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SkillNode } from '@/types/skill';
import { usePlayerStore, useSkillStore } from '@/store';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { SkillKeystoneArt } from '@/components/common/SkillKeystoneArt';
import {
  getActionSkillState,
  newActionSkillNonce,
  selectActionSkill,
} from '@/lib/chef/chefClient';
import {
  ACTION_SKILL_DEFS,
  ACTION_SKILL_CHARGE_MAX,
  type ActionSkillStateView,
} from '@/content/actionSkills';
import { hunterById, treeForHunter } from '@/lib/hunters/hunters';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { Bolts, PlateFootStrip } from '@/components/profile/HunterPlates';
import {
  AMBER,
  AMBER_GLOW,
  BONE,
  BONE_FAINT,
  BONE_MUTED,
  STEEL,
  plateShell,
} from '@/components/profile/hunterPlateTheme';
import { TreesBoardVariant } from '@/harness/TreesBoardVariants';
import { applyTreesCopy } from '@/harness/treesCopyOverrides';

/**
 * ActionSkillPicker — the FIELDED hunter's signature plate (0030,
 * reshape slice (b)). The selection is the active hunter's
 * signature (brief §2.5: switching hunters collapses the selection
 * server-side), so this plate presents exactly one signature: the
 * fielded hunter's. The server derives qualification from that
 * hunter's skill spends + the equipped class mod; the plate only
 * sends the player's pick (select this tree, or clear). Charge is
 * one shared pool across hunters. It lives here, where respec
 * happens — a respec that drops the keystone clears the signature
 * server-side.
 */
const ActionSkillPicker: React.FC = () => {
  const [view, setView] = useState<ActionSkillStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const activeHunterId = useSkillStore((s) => s.activeHunterId);
  const hunter = hunterById(activeHunterId);
  const tree = treeForHunter(activeHunterId);

  const load = useCallback(() => {
    getActionSkillState()
      .then((r) => setView(r.actionSkill))
      .catch(() => { /* no picker without the server's word */ });
  }, []);
  useEffect(() => { load(); }, [load, activeHunterId]);

  if (!view) return null;
  const sig = view.signatures.find((s) => s.tree === tree);
  if (!sig) return null;
  const def = ACTION_SKILL_DEFS[tree];
  const visual = getSkillTreeVisual(tree);
  const isActive = view.selected === tree;

  const pick = async (next: SkillTreeType | null) => {
    if (busy) return;
    setBusy(true);
    setPickError(null);
    try {
      const result = await selectActionSkill({ nonce: newActionSkillNonce('select'), tree: next });
      setView(result.actionSkill);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : 'Selection failed');
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative overflow-hidden p-3.5" style={plateShell} data-testid="action-skill-picker">
      <Bolts />
      <div className="relative space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>Action Skill</div>
          {view.selected && (
            <div className="font-mono text-[11px] font-black" style={{ color: BONE }}>
              {Math.floor(view.charge)}/{ACTION_SKILL_CHARGE_MAX} charge
            </div>
          )}
        </div>
        {!sig.qualified ? (
          <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }} data-testid="action-skill-picker-none">
            No action skill yet — own the {String(tree)} keystone to unlock {hunter.name}&apos;s signature
          </div>
        ) : (
          <>
            <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
              {hunter.name}&apos;s signature — charges through boss attempts and endless fights (Fixers also charge at the benches and the repair bay)
            </div>
            <button
              type="button"
              data-testid={`action-skill-pick-${tree}`}
              onClick={() => void pick(isActive ? null : tree)}
              disabled={busy}
              className="relative block min-h-[44px] w-full overflow-hidden p-2.5 pb-3.5 text-left disabled:opacity-50"
              style={{
                border: '2px solid #000',
                background: 'linear-gradient(158deg, #1D1811 0%, #0C0A08 100%)',
                boxShadow: isActive
                  ? `3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 2px ${AMBER}`
                  : '3px 3px 0 rgba(0,0,0,0.7)',
              }}
            >
              <div className="flex items-center gap-1.5">
                <PxIcon name={visual.sigil} size={13} style={{ color: visual.color }} />
                <span className="text-xs font-black" style={{ color: BONE }}>{def.name}</span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>{def.summary}</div>
              <div className="mt-1 text-[11px] font-black uppercase" style={{ color: visual.color }}>
                {isActive ? 'Active — tap to clear' : `${String(tree)} signature — tap to select`}
              </div>
              {/* The tree's color rides the foot strip — never
                  a side bar (Arena Plates law). */}
              <PlateFootStrip color={visual.color} height={3} />
            </button>
            {pickError && (
              <div role="alert" className="text-[11px] font-black uppercase text-red">{pickError}</div>
            )}
          </>
        )}
      </div>
      <PlateFootStrip color={STEEL} height={3} />
    </div>
  );
};

const TREES = [
  { id: SkillTreeType.Gunslinger, label: 'Gunslinger', color: '#FF4B5C', desc: 'Weapon damage, crits, speed' },
  { id: SkillTreeType.Demolition, label: 'Demolition', color: '#FF9000', desc: 'Explosives, armor break' },
  { id: SkillTreeType.Scavenger, label: 'Scavenger', color: '#7CFC00', desc: 'Idle, loot, economy' },
  { id: SkillTreeType.Fixer, label: 'Fixer', color: '#2EC4B6', desc: 'Crafting, repair, vehicles, trade' },
];

const nodeTone = (node: SkillNode, isAvailable: boolean, isMaxed: boolean) => {
  if (isMaxed) return 'border-green/70 bg-green/10 text-green';
  if (isAvailable) return 'border-amber bg-amber/12 text-amber';
  if (node.type === 'keystone') return 'border-purple/45 bg-purple/10 text-purple opacity-80';
  if (node.type === 'major') return 'border-amber/30 bg-surface text-text-secondary opacity-80';
  return 'border-border bg-surface text-text-muted opacity-65';
};

export const SkillTreeScreen: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  // CAPTURE SEAM (dash/trees-render, presentation only): the
  // stills harness pre-selects a node with ?sel=<nodeId> so the
  // inspect plate is populated in frame. Absent the param this is
  // exactly the shipped initial state (null).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sel') : null,
  );
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const player = usePlayerStore();
  const skillStore = useSkillStore();

  // The board is the FIELDED hunter's tree (reshape slice (b),
  // brief check B2): there is no tree selector on this stop —
  // switching trees means switching hunters, at the Roster stop.
  const activeHunter = hunterById(skillStore.activeHunterId);
  const activeTree = treeForHunter(skillStore.activeHunterId);

  // Budget points spent in the ACTIVE hunter's pool — weighted by
  // listed cost (audit HTR-01), per-hunter since slice (a) — so
  // Available, the spend gate, and the Respec quote all match the
  // server (cc_retrain retrains this hunter's pool only).
  const pointsSpent = skillStore.getActiveSpentBudget();
  const pointsEarned = Math.max(0, player.level - 1);
  const pointsAvailable = Math.max(0, pointsEarned - pointsSpent);
  const nodes = getSkillTreeNodes(activeTree);
  const activeTreeDef = TREES.find((tree) => tree.id === activeTree) || TREES[0];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];
  const groupedTiers = new Map<number, SkillNode[]>();
  nodes.forEach((node) => {
    const current = groupedTiers.get(node.tier) || [];
    current.push(node);
    groupedTiers.set(node.tier, current.sort((a, b) => a.index - b.index));
  });
  const tiers = Array.from(groupedTiers.entries()).sort(([a], [b]) => a - b);

  const canSpend = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    if (pointsAvailable < node.cost) return false;
    if ((skillStore.spent[nodeId] || 0) >= node.maxPoints) return false;
    if (node.requires) {
      for (const req of node.requires) {
        if ((skillStore.spent[req] || 0) === 0) return false;
      }
    }
    return true;
  };

  // QC A7: the inspect panel used to render its Spend button ONLY when
  // the spend was already possible — a player with no points (every
  // level-1 guest) saw a node brief with no spend affordance at all
  // and no way to learn how a point is spent. The button now always
  // renders; when the spend is not possible this returns the plain
  // reason printed under the disabled button.
  const spendReason = (node: SkillNode): string | null => {
    const current = skillStore.spent[node.id] || 0;
    if (current >= node.maxPoints) return 'This node is maxed out.';
    if (pendingNodeId !== null && pendingNodeId !== node.id) {
      return 'Another node is training — one spend at a time.';
    }
    if (node.requires) {
      const unmet = node.requires.filter((req) => (skillStore.spent[req] || 0) === 0);
      if (unmet.length > 0) {
        const names = unmet.map((req) => nodes.find((n) => n.id === req)?.name ?? req);
        return `Spend a point in ${names.join(', ')} first.`;
      }
    }
    if (pointsAvailable < node.cost) {
      return `Needs ${node.cost} point${node.cost === 1 ? '' : 's'} — you have ${pointsAvailable}. Skill points come from levels: 1 per level.`;
    }
    return null;
  };

  const spendPoint = async (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setErrorMessage(null);
    if (!canSpend(nodeId) || pendingNodeId) return;
    const previousSpent = skillStore.spent;
    // Optimistic local update — the server-authoritative snapshot from
    // syncVerifiedResult will overwrite this on success. On RPC failure we
    // roll back to the pre-tap state so the UI never disagrees with the
    // server's skill_spends.
    skillStore.spendPoint(nodeId);
    setPendingNodeId(nodeId);
    try {
      await verifiedOps.trainSkill(nodeId);
    } catch (error) {
      useSkillStore.setState({ spent: previousSpent });
      setErrorMessage(error instanceof Error ? error.message : 'Failed to train skill');
    } finally {
      setPendingNodeId(null);
    }
  };

  // Two-step respec (audit HTR-07): the first tap only ARMS the
  // button — renamed to name the exact cost — and the second tap
  // executes. A one-tap respec let a misclick burn the whole build
  // and its cost (9,900cr at a full 99 points) with no undo. The arm
  // records the spent total it was armed at; any change to the build
  // disarms it (the derived check below), so a stale confirmation
  // can never fire against a different build. At zero spends the
  // button is disabled outright (the server refuses a zero-spend
  // retrain too — 'Nothing to respec').
  const [respecArm, setRespecArm] = useState<number | null>(null);
  const respecConfirmed = respecArm !== null && respecArm === pointsSpent;

  const respec = async () => {
    if (!respecConfirmed) {
      setRespecArm(pointsSpent);
      return;
    }
    setErrorMessage(null);
    try {
      await verifiedOps.retrain();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to respec');
    } finally {
      setRespecArm(null);
    }
  };

  // The Respec affordance + points summary used to live ONLY in the
  // non-embedded header/stats, but this screen is only ever rendered
  // embedded (Profile) — which suppressed both and made the working
  // cc_retrain flow unreachable. They now render in both modes, with
  // the exact cost semantics of the original header: cc_retrain
  // charges the ACTIVE hunter's weighted spent total × 100cr
  // server-side (per-hunter retrain, slice (a)) — pointsSpent here
  // is that same pool, so the quote and the charge agree.
  const respecButton = (
    <button
      onClick={respec}
      disabled={pendingNodeId !== null || pointsSpent === 0}
      className={`flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wide disabled:opacity-50 ${respecConfirmed ? 'animate-pulse' : ''}`}
      style={{
        color: respecConfirmed ? '#FF7A59' : AMBER,
        border: '2px solid #000',
        background: respecConfirmed
          ? 'linear-gradient(158deg, #2A130D 0%, #170B06 100%)'
          : 'linear-gradient(158deg, #1D1811 0%, #0C0A08 100%)',
        boxShadow: '3px 3px 0 rgba(0,0,0,0.7)',
      }}
    >
      <RotateCcw size={13} /> {respecConfirmed ? `Confirm Respec · ${skillStore.respecCost().toLocaleString()}cr` : 'Respec'}
    </button>
  );

  const header = embedded ? null : (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="bl-title text-3xl leading-none text-text-primary">Skill Trees</div>
        <div className="text-xs text-text-muted mt-1">Spend points on crooked branches. Small nodes feed majors; majors unlock keystones.</div>
      </div>
      {respecButton}
    </div>
  );

  // The points read as gauges on plate wells (Arena Plates): the
  // available count is the screen's hero numeral in amber glow;
  // the foot strip goes amber only while points wait to be spent.
  // Label and value stay adjacent siblings — the respec suite reads
  // the value as the label's next sibling.
  const stats = (
    <div className="grid grid-cols-3 gap-2">
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Available</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: AMBER_GLOW }}>{pointsAvailable}</div>
        <PlateFootStrip color={pointsAvailable > 0 ? AMBER : STEEL} height={3} />
      </div>
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Spent</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{pointsSpent}</div>
        <PlateFootStrip color={STEEL} height={3} />
      </div>
      <div className="relative overflow-hidden px-3 pb-3.5 pt-2.5" style={plateShell}>
        <div className="text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>Respec cost</div>
        <div className="text-[22px] font-black leading-tight" style={{ color: BONE }}>{pointsSpent * 100}cr</div>
        <PlateFootStrip color={STEEL} height={3} />
      </div>
    </div>
  );

  // CAPTURE SEAM (dash/trees-render, presentation only): with
  // ?trees=1|2|3 the stop renders a first-screen variant layout
  // fed by this screen's own derived state — same stores, same
  // handlers, same node defs. Absent the param, the shipped
  // composition below renders byte for byte.
  const treesVariantParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('trees')
    : null;
  // CAPTURE SEAM (dash/trees-v3copy, presentation only): ?copy=1
  // lays the owner-ruled tightened node descriptions over the
  // variant's nodes — harness-only data overrides, the shipped
  // defs untouched. Absent the param, defs render as shipped.
  const treesCopyParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('copy')
    : null;
  if (treesVariantParam === '1' || treesVariantParam === '2' || treesVariantParam === '3') {
    const copyNodes = treesCopyParam === '1' ? applyTreesCopy(nodes) : nodes;
    const copyTiers = treesCopyParam === '1'
      ? tiers.map(([tier, tierNodes]) => [tier, applyTreesCopy(tierNodes)] as [number, SkillNode[]])
      : tiers;
    const copySelected = treesCopyParam === '1'
      ? (applyTreesCopy([selectedNode])[0] ?? selectedNode)
      : selectedNode;
    return (
      <TreesBoardVariant
        variant={Number(treesVariantParam) as 1 | 2 | 3}
        nodes={copyNodes}
        tiers={copyTiers}
        spent={skillStore.spent}
        pointsAvailable={pointsAvailable}
        pointsSpent={pointsSpent}
        pointsEarned={pointsEarned}
        level={player.level}
        selectedNode={copySelected}
        onSpend={spendPoint}
        canSpend={canSpend}
        spendReason={spendReason}
        pendingNodeId={pendingNodeId}
        respecButton={respecButton}
        actionSkillPlate={<ActionSkillPicker />}
        activeHunter={activeHunter}
        activeTree={activeTree}
        activeTreeDef={activeTreeDef}
        errorMessage={errorMessage}
      />
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : 'bl-page space-y-4 p-4 pb-20'}>
      {header}
      {stats}
      {/* Audit UX-07: the board never said where points come from or
          what spending costs before the tap. One explainer line in
          both render modes, matching the shipped math exactly:
          pointsEarned = level − 1 (1 per level), a node's cost is
          spent from its inspect panel, and cc_retrain returns this
          hunter's spent points at a cost of pointsSpent × 100cr. */}
      <div className="text-[11px] leading-snug text-text-muted">
        Skill points come from levels — 1 per level ({pointsEarned} earned at level {player.level}). Tap a node to inspect it and spend its listed cost. Respec returns every spent point and costs 100cr per point spent. Each hunter holds their own pool — switch hunters at the Roster.
      </div>
      {embedded && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] leading-snug text-text-muted">Respec returns {activeHunter.name}&apos;s spent points — cost {pointsSpent * 100}cr (100cr per point spent).</div>
          {respecButton}
        </div>
      )}

      <ActionSkillPicker />

      <div className="relative" style={plateShell}>
        <Bolts />
        <div className="relative flex items-center justify-between px-4 py-3" style={{ borderBottom: '2px solid rgba(163,152,134,0.28)' }}>
          <div>
            <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: activeTreeDef.color }}>{activeTreeDef.label} Board</div>
            <div className="mt-0.5 text-[11px]" style={{ color: BONE_FAINT }}>{activeHunter.name}&apos;s tree · {activeHunter.basePerkName} base perk · tap a node to inspect or spend</div>
          </div>
          {/* The tree sigil is decorative (QC A7: an unexplained red
              glyph at the board's top-right read as a button). It now
              carries an accessible name saying what it is. */}
          <span
            role="img"
            aria-label={`${activeTreeDef.label} tree sigil`}
            title={`${activeTreeDef.label} tree sigil`}
            className="inline-flex shrink-0"
          >
            <PxIcon name="star" size={17} style={{ color: activeTreeDef.color }} />
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="relative border-b-2 border-red/40 bg-red/10 px-4 py-2 text-[11px] font-black uppercase text-red"
          >
            {errorMessage}
          </div>
        )}

        <div className="relative overflow-x-auto p-3">
          <div className="min-w-[520px] space-y-3">
            {tiers.map(([tier, tierNodes], tierIndex) => (
              <div key={tier} className="relative">
                {tierIndex > 0 && <div className="absolute -top-3 left-1/2 h-3 w-[2px] bg-amber/30" />}
                <div className="grid grid-cols-[58px_1fr] items-center gap-2">
                  <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>Tier {tier}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, idx) => {
                      // Audit COPY-03: a single-node tier renders its
                      // node exactly once, centered. The old expression
                      // matched an index-1 lone node (every keystone
                      // tier) at column 0 via find AND at column 1 via
                      // the centering fallback — the keystone listed
                      // twice on its own board.
                      const node = tierNodes.length === 1
                        ? (idx === 1 ? tierNodes[0] : undefined)
                        : tierNodes.find((n) => n.index === idx + 1);
                      if (!node) return <div key={`empty-${tier}-${idx}`} />;

                      const currentPoints = skillStore.spent[node.id] || 0;
                      const isMaxed = currentPoints >= node.maxPoints;
                      const prerequisitesMet = !node.requires || node.requires.every((req) => (skillStore.spent[req] || 0) > 0);
                      const isAvailable = canSpend(node.id) && pendingNodeId === null;
                      const isSelected = selectedNode?.id === node.id;
                      const isPending = pendingNodeId === node.id;
                      const size = node.type === 'keystone' ? 'min-h-[84px]' : node.type === 'major' ? 'min-h-[76px]' : 'min-h-[68px]';

                      return (
                        <motion.button
                          key={node.id}
                          whileTap={isAvailable ? { scale: 0.96 } : { scale: 0.98 }}
                          onClick={() => spendPoint(node.id)}
                          className={`relative border-2 p-2 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)] ${size} ${nodeTone(node, isAvailable, isMaxed)} ${isSelected ? 'ring-2 ring-amber/70' : ''}`}
                          style={{ clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1">
                              <SkillKeystoneArt
                                tree={activeTree}
                                nodeType={node.type}
                                unlocked={prerequisitesMet || currentPoints > 0 || isMaxed}
                                spentPoints={currentPoints}
                                locked={!prerequisitesMet && currentPoints === 0 && !isMaxed}
                                size={30}
                                animate={node.type === 'keystone' && currentPoints > 0}
                              />
                              <div className="truncate text-[11px] font-black text-text-primary">{node.name}</div>
                            </div>
                            {isMaxed && <Lock size={11} className="shrink-0 text-green" />}
                          </div>
                          <div className="mt-1 pr-8 text-[11px] leading-snug text-text-muted">{node.description}</div>
                          <div className="absolute bottom-1 right-2 text-[11px] font-black" style={{ color: isMaxed ? '#22C55E' : isAvailable ? '#F59E0B' : '#6B7280' }}>
                            {isPending ? '…' : `${currentPoints}/${node.maxPoints}`}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <PlateFootStrip color={activeTreeDef.color} height={3} />
      </div>

      {selectedNode && (
        <div className="relative overflow-hidden p-4" style={plateShell}>
          <Bolts />
          <div className="relative space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>{selectedNode.name}</div>
                <div className="mt-0.5 text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>{selectedNode.type} · Tier {selectedNode.tier}</div>
              </div>
              <div className="text-sm font-black" style={{ color: AMBER }}>{skillStore.spent[selectedNode.id] || 0}/{selectedNode.maxPoints}</div>
            </div>
            <div className="text-xs leading-snug" style={{ color: BONE_MUTED }}>{selectedNode.description}</div>
            {selectedNode.requires && selectedNode.requires.length > 0 && (
              <div className="text-[11px]" style={{ color: BONE_FAINT }}>Requires: {selectedNode.requires.map((reqId) => SKILL_NODES.find((n) => n.id === reqId)?.name ?? reqId).join(', ')}</div>
            )}
            {canSpend(selectedNode.id) ? (
              <button
                onClick={() => spendPoint(selectedNode.id)}
                disabled={pendingNodeId !== null}
                className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
              >
                {pendingNodeId === selectedNode.id ? 'Training…' : `Spend ${selectedNode.cost} Point${selectedNode.cost === 1 ? '' : 's'}`}
              </button>
            ) : (
              <>
                <button
                  disabled
                  aria-disabled="true"
                  data-testid="skill-spend-unavailable"
                  className="bl-primary min-h-[44px] w-full py-3 text-xs font-black disabled:opacity-50"
                >
                  {pendingNodeId === selectedNode.id ? 'Training…' : `Spend ${selectedNode.cost} Point${selectedNode.cost === 1 ? '' : 's'}`}
                </button>
                <div className="text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                  {spendReason(selectedNode) ?? 'Not spendable right now.'}
                </div>
              </>
            )}
          </div>
          {/* The tree's color rides the inspect plate's foot strip. */}
          <PlateFootStrip color={activeTreeDef.color} height={3} />
        </div>
      )}
    </div>
  );
};
