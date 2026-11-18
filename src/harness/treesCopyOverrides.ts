/**
 * Trees V3 copy pass — capture-only description overrides
 * (first-screen fix program, track R1 copy round, branch
 * dash/trees-v3copy — presentation only, never merged).
 *
 * The tightened, player-facing node descriptions from the
 * owner-ruled copy pass (2026-11-17): the whole description
 * still shows, worded concisely, with every number preserved
 * exactly and all implementation-speak ("server-side",
 * "snapshotted at enqueue", "affix bracket", "buyback lever",
 * "check score") translated into what the player experiences.
 * 18 of 88 nodes are rewritten; the other 70 already read clean
 * and are NOT in this map — they render their shipped text.
 *
 * Applied ONLY when the harness is opened with ?copy=1 (on top
 * of ?trees=3). The production defs in
 * src/constants/skillTrees.ts are untouched; if the owner
 * approves this copy, the build applies it to the defs later.
 * Full before/after table: COPY-TABLE.md in the prep folder
 * (cybercache-prep/cache-hunters/first-screen-fix/trees-v3copy/).
 */
import type { SkillNode } from '@/types/skill';

export const TREES_COPY_OVERRIDES: Record<string, string> = {
  // Demolition supply nodes — PR #611's quantized wording kept
  // exact (2% steps, −20% at all five maxed); the snapshot fact
  // in player words: the rate is set when the job is queued.
  demo_cons_1: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.',
  demo_cons_2: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.',
  demo_cons_3: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.',
  demo_cons_4: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.',
  demo_cons_5: 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.',
  scav_cons_1: 'Workshop craft jobs run faster: −2% unit time per point, set at queue time.',
  fix_craft_time_1: 'Workshop craft jobs run faster: −2.5% unit time per point, set at queue time.',
  fix_quality_1: '+1 crafted quality shift per point, counted when a unit completes.',
  fix_repair_speed_1: 'Repair work runs faster: −3% unit time per point, set when the job starts.',
  fix_vehicle_yield_1: '+2% vehicle yield per point (stacks with yield affixes).',
  fix_vehicle_fuel_1: 'Vehicles burn −3% fuel per point, after fuel-efficiency affixes.',
  fix_vendor_1: '+1% vendor buyback rate per point. Buyback rate caps at 90%.',
  gs_keystone: 'Critical hits increase your DPS by an additional +25%. If crit chance exceeds 50%, gain +10% boss damage.',
  demo_keystone: 'Explosive damage counts toward Armor Break. When armor is broken, your next heavy weapon burst deals +50% damage.',
  demo_major_1: 'Ordnance strips an additional 20% shield before the DPS phase.',
  fix_major_2: 'Vehicles lose 25% less condition while fueled.',
  gs_major_4: "A weapon matching the boss's weakness grants +10% damage.",
  fix_major_3: 'Listing fees reduced an additional 15% for Workshop-crafted items you sell.',
};

/** Map a node list through the copy overrides (identity for unlisted nodes). */
export function applyTreesCopy(nodes: SkillNode[]): SkillNode[] {
  return nodes.map((n) => {
    const d = TREES_COPY_OVERRIDES[n.id];
    return d ? { ...n, description: d } : n;
  });
}
