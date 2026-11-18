/**
 * Trees icon set — capture-only node icons for the icon-tree
 * board variant (?trees=4, branch dash/trees-icons — presentation
 * only, never merged).
 *
 * One generated pixel icon per Fixer node: a function glyph
 * embossed on a dark riveted octagonal medallion (the framing
 * device the shipped node tiles already wear), generated on
 * magenta, keyed with a hue-band chroma key, normalized to
 * 128×128 and palette-capped (FASTOCTREE, 128 colors) in the
 * prep package — see cybercache-prep/cache-hunters/
 * first-screen-fix/trees-icons/ (process_icons.py + the icon
 * contact sheet). Paired nodes carry sibling glyphs: same base
 * glyph, varied treatment (one stopwatch / two stopwatches;
 * eye in reticle / eye in caliper jaws; wrench + one arc /
 * wrench + circling arrows; kit alone / kit + soldering iron;
 * wheel + wrench / wheel + fairing; shell upright / shell on a
 * test cradle).
 *
 * Only the Fixer tree is keyed here — the rendering covers Doc
 * Sutter's board; the other trees fall back to no icon (their
 * nodes never render in this harness seed).
 */
import fix_craft_time_1 from './treesIcons/fix_craft_time_1.png';
import fix_craft_time_2 from './treesIcons/fix_craft_time_2.png';
import fix_quality_1 from './treesIcons/fix_quality_1.png';
import fix_quality_2 from './treesIcons/fix_quality_2.png';
import fix_repair_speed_1 from './treesIcons/fix_repair_speed_1.png';
import fix_repair_speed_2 from './treesIcons/fix_repair_speed_2.png';
import fix_repair_eff_1 from './treesIcons/fix_repair_eff_1.png';
import fix_repair_eff_2 from './treesIcons/fix_repair_eff_2.png';
import fix_vehicle_yield_1 from './treesIcons/fix_vehicle_yield_1.png';
import fix_vehicle_yield_2 from './treesIcons/fix_vehicle_yield_2.png';
import fix_vehicle_fuel_1 from './treesIcons/fix_vehicle_fuel_1.png';
import fix_vendor_1 from './treesIcons/fix_vendor_1.png';
import fix_major_1 from './treesIcons/fix_major_1.png';
import fix_major_2 from './treesIcons/fix_major_2.png';
import fix_major_3 from './treesIcons/fix_major_3.png';
import fix_major_4 from './treesIcons/fix_major_4.png';
import fix_ord_1 from './treesIcons/fix_ord_1.png';
import fix_ord_2 from './treesIcons/fix_ord_2.png';
import fix_exp_1 from './treesIcons/fix_exp_1.png';
import fix_armor_1 from './treesIcons/fix_armor_1.png';
import fix_stag_1 from './treesIcons/fix_stag_1.png';
import fix_keystone from './treesIcons/fix_keystone.png';

export const TREE_NODE_ICONS: Record<string, string> = {
  fix_craft_time_1,
  fix_craft_time_2,
  fix_quality_1,
  fix_quality_2,
  fix_repair_speed_1,
  fix_repair_speed_2,
  fix_repair_eff_1,
  fix_repair_eff_2,
  fix_vehicle_yield_1,
  fix_vehicle_yield_2,
  fix_vehicle_fuel_1,
  fix_vendor_1,
  fix_major_1,
  fix_major_2,
  fix_major_3,
  fix_major_4,
  fix_ord_1,
  fix_ord_2,
  fix_exp_1,
  fix_armor_1,
  fix_stag_1,
  fix_keystone,
};
