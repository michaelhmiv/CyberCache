/**
 * Workshop error humanizer (Direction A — the `research_required`
 * fix). The Chef's craft engine refuses with a mix of human
 * sentences and machine codes (`research_required`,
 * `standing_required`, `Insufficient material NitrocellGel`,
 * `Requires crafting.gear mastery 10`). Those strings used to reach
 * the screen verbatim — a raw snake_case code in red text is a bug,
 * not a message.
 *
 * Every Workshop error surface (store errors, enqueue/cancel/
 * unlock/fit failures, tint failures, the activity card) passes
 * through here. Server strings stay as they are (tests pin them;
 * the SQL twins share them) — translation happens at this client
 * boundary only. Already-human sentences pass through untouched;
 * anything still machine-shaped after mapping falls back to a
 * human sentence that points at the card's printed gates.
 */
import { getVisualAsset } from '@/constants/visualAssets';
import { masteryTrackLabel } from './readiness';

export const WORKSHOP_ERROR_FALLBACK =
  'The bench refused that — check the recipe’s gates and materials on its card, then try again.';

const RESEARCH_REFUSAL =
  'Locked — finish the Production Systems course in Research (Hunter tab) to unlock this recipe.';
const STANDING_REFUSAL =
  'Locked — this recipe needs more manufacturer standing. Earn it at the Rep Desk in Market.';

function label(id: string): string {
  return getVisualAsset('material', id).label;
}

/** Translate one Chef refusal (or any error) into player words. */
export function humanizeWorkshopError(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').trim();
  if (!text) return WORKSHOP_ERROR_FALLBACK;

  // The two machine codes, wherever they appear in the message.
  if (text.includes('research_required')) return RESEARCH_REFUSAL;
  if (text.includes('standing_required')) return STANDING_REFUSAL;

  // "Requires crafting.gear mastery 10" / "Requires crafting_consumables mastery 15"
  const mastery = text.match(/^Requires ([\w.]+) mastery (\d+)$/);
  if (mastery) {
    return `Locked — this recipe needs ${masteryTrackLabel(mastery[1])} mastery ${mastery[2]}. Every finished job on that lane raises it.`;
  }
  // "Epic frames require crafting.gear mastery 10"
  const epic = text.match(/^Epic frames require ([\w.]+) mastery (\d+)$/);
  if (epic) {
    return `Epic frames need ${masteryTrackLabel(epic[1])} mastery ${epic[2]} — yours shows on the card.`;
  }

  if (text === 'Insufficient material Chromaweave') {
    return 'Not enough Chromaweave — refine Myco-Steel Fiber + Void Essence in the Refining lane.';
  }
  // "Insufficient material NitrocellGel" / "Insufficient essence IgnitionFluid"
  const insufficient = text.match(/^Insufficient (material|essence) (\w+)$/);
  if (insufficient) {
    return `Not enough ${label(insufficient[2])} — the card prints where it comes from.`;
  }
  if (text === 'Insufficient material quantity') {
    return 'Not enough of one of the listed materials — check the have/need counts on the card.';
  }
  if (text === 'Insufficient scrap') return 'Not enough Scrap — roam, salvage gear, or sell loot to earn more.';
  if (text === 'Insufficient credits') return 'Not enough credits for that bench yet.';
  if (text === 'Insufficient legendary cores') {
    return 'Not enough legendary cores — they come from salvaging Legendary gear.';
  }

  // "Not enough PatchKit in inventory" (repair lane kit types).
  const kit = text.match(/^Not enough (\w+) in inventory$/);
  if (kit) return `Not enough ${label(kit[1])} in inventory.`;

  if (text === 'Profile not found') {
    return 'Your hunter profile could not be loaded — reconnect and try again.';
  }

  // Any remaining bare machine code (snake_case token) never renders.
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(text)) return WORKSHOP_ERROR_FALLBACK;
  // A message still carrying a raw track id gets the id translated.
  if (/crafting[._][a-z_]+/.test(text)) {
    return text.replace(/crafting[._]([a-z_]+)/g, (_m, track: string) => masteryTrackLabel(`crafting.${track}`));
  }
  return text;
}
