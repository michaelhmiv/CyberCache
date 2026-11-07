/**
 * Bench seat resolution (Motion M4b) — the truthfulness contract.
 *
 * The bench may only picture what is actually known:
 *  - recipe-specified outputs (consumable / material / cosmetic
 *    part / named relic) resolve to their real renders mid-job;
 *  - a generic gear job's item DOES NOT EXIST until the server
 *    rolls it at completion, so its seat is the slot+rarity frame
 *    and nothing more — a plan that smuggled in a fabricated item
 *    render would fail these pins;
 *  - completions rise as themselves for EVERY gear kind (the
 *    pre-M4b rise let non-weapon gear and cosmetics fall through
 *    to a generic glow disc);
 *  - salvage rises as its yield (Scrap), never as the destroyed
 *    item, and a failed batch earns no beat at all.
 */
import { describe, expect, it } from 'vitest';
import {
  benchRisePlanForEntry,
  benchSeatPlanForJob,
  namedRelicSeatInput,
  salvageRisePlanForEntry,
} from '@/lib/pixel/benchSeat';
import type { WorkshopCompletionView, WorkshopJobView } from '@/store/slices/workshopSlice';
import type { SalvageFeedEntry } from '@/store/slices/salvageFeedSlice';
import { MaterialType, Rarity } from '@/types/game';
import type { GearItem, Shield, Weapon } from '@/types/items';
import { Manufacturer, WeaponType, Element } from '@/types/game';

const job = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'job-1',
  bench: 1,
  kind: 'consumable',
  recipeId: 'recipe_patch_kit',
  name: 'Patch Kit',
  state: 'running',
  unitsTotal: 1,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 1_000,
  remainingMs: 59_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
  ...over,
});

describe('benchSeatPlanForJob — mid-job seat resolution', () => {
  it('consumable job seats the real consumable render', () => {
    expect(benchSeatPlanForJob(job({}))).toEqual({ kind: 'consumable', consumableType: 'PatchKit' });
  });

  it('refine job seats the real output material', () => {
    const plan = benchSeatPlanForJob(job({ kind: 'refine', recipeId: 'refine_refined_alloy' }));
    expect(plan).toEqual({ kind: 'material', materialId: 'RefinedAlloy' });
  });

  it('cosmetic job seats the skin part itself', () => {
    const plan = benchSeatPlanForJob(
      job({ kind: 'gear', recipeId: 'recipe_skin_bulwark_torso' }),
    );
    expect(plan).toEqual({ kind: 'cosmeticPart', partId: 'bulwark-torso', spriteId: 'part-bulwark-torso' });
  });

  it('named-relic job seats the relic form — never the generic gear frame', () => {
    const plan = benchSeatPlanForJob(job({ kind: 'gear', recipeId: 'tool_precision_calipers' }));
    expect(plan?.kind).toBe('namedRelic');
    if (plan?.kind !== 'namedRelic') return;
    expect(plan.name).toBe('Precision Calipers');
    expect(plan.input.rarity).toBe(Rarity.Epic); // the recipe's fixed rarity
    expect(plan.input.variant).toMatch(/\/crafted$/);
  });

  it('generic gear job seats ONLY the slot+rarity frame — the item does not exist yet', () => {
    const plan = benchSeatPlanForJob(
      job({ kind: 'gear', recipeId: 'frame_shield', gearRarity: 'Rare' }),
    );
    // Exact-shape pin: a frame plan carries slot + rarity and NO
    // item, input, sprite, or seed a fabricated render could use.
    expect(plan).toEqual({ kind: 'gearFrame', slot: 'shield', rarity: Rarity.Rare });
  });

  it('gear frame falls back to Common when the job carries no rarity snapshot', () => {
    const plan = benchSeatPlanForJob(job({ kind: 'gear', recipeId: 'frame_weapon' }));
    expect(plan).toEqual({ kind: 'gearFrame', slot: 'weapon', rarity: Rarity.Common });
  });

  it('service jobs seat the target record itself', () => {
    expect(benchSeatPlanForJob(job({ kind: 'repair', repairItemId: 'veh-1' }))).toEqual({
      kind: 'serviceItem',
      itemId: 'veh-1',
    });
    expect(
      benchSeatPlanForJob(job({ kind: 'shieldtech', recipeId: 'svc', shieldtechItemId: 'sh-1' })),
    ).toEqual({ kind: 'serviceItem', itemId: 'sh-1' });
  });

  it('no seat for a job that is not running, an unknown recipe, or a targetless service job', () => {
    expect(benchSeatPlanForJob(job({ state: 'queued' }))).toBeNull();
    expect(benchSeatPlanForJob(job({ recipeId: 'no_such_recipe' }))).toBeNull();
    expect(benchSeatPlanForJob(job({ kind: 'repair', repairItemId: null }))).toBeNull();
    expect(benchSeatPlanForJob(null)).toBeNull();
    expect(benchSeatPlanForJob(undefined)).toBeNull();
  });

  it('namedRelicSeatInput: stable per job, affixes as pips, unknown name refuses', () => {
    const a = namedRelicSeatInput('Servo Bench Rig', Rarity.Epic, 'job-9');
    const b = namedRelicSeatInput('Servo Bench Rig', Rarity.Epic, 'job-9');
    expect(a).not.toBeNull();
    expect(a?.seed).toBe(b?.seed);
    expect(a?.pips).toBe(1); // the Rig's one fixed affix
    expect(namedRelicSeatInput('No Such Relic', Rarity.Epic, 'job-9')).toBeNull();
  });
});

const shieldItem = {
  id: 'shield-1',
  name: 'Test Aegis',
  rarity: Rarity.Rare,
  level: 4,
  hp: 120,
  rechargeRate: 8,
  rechargeDelay: 2,
  element: Element.Kinetic,
} as unknown as Shield;

const weaponItem = {
  id: 'weapon-1',
  name: 'Test Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [],
  pixelSeed: 7,
} as unknown as Weapon;

const entry = (over: Record<string, unknown>): WorkshopCompletionView => ({
  jobId: 'job-1',
  recipeId: 'recipe-1',
  name: 'Unit',
  unit: 0,
  completedAtMs: 1_700_000_000_000,
  ...over,
});

describe('benchRisePlanForEntry — completions rise as themselves', () => {
  it('consumable and material outputs rise as their renders', () => {
    expect(benchRisePlanForEntry(entry({ consumableType: 'PatchKit' }), [])).toEqual({
      kind: 'consumable',
      consumableType: 'PatchKit',
    });
    expect(benchRisePlanForEntry(entry({ outputMaterial: 'RefinedAlloy' }), [])).toEqual({
      kind: 'material',
      materialId: 'RefinedAlloy',
    });
  });

  it('a SHIELD completion rises as the shield itself — the pre-M4b fall-through', () => {
    const plan = benchRisePlanForEntry(entry({ itemId: 'shield-1', rarity: 'Rare' }), [shieldItem]);
    expect(plan).toEqual({ kind: 'item', item: shieldItem });
  });

  it('a weapon completion still rises as the weapon', () => {
    const plan = benchRisePlanForEntry(entry({ itemId: 'weapon-1' }), [weaponItem]);
    expect(plan).toEqual({ kind: 'item', item: weaponItem });
  });

  it('a cosmetic completion rises as the part — the part beats the item lookup', () => {
    const cosmeticRecord = { id: 'cos-1', name: 'Bulwark Siege Torso' } as unknown as GearItem;
    const plan = benchRisePlanForEntry(
      entry({ itemId: 'cos-1', cosmeticPartId: 'bulwark-torso' }),
      [cosmeticRecord],
    );
    expect(plan).toEqual({ kind: 'cosmeticPart', partId: 'bulwark-torso', spriteId: 'part-bulwark-torso' });
  });

  it('glow only when the completion truly has no picture', () => {
    // Service work: points restored, no output item.
    expect(benchRisePlanForEntry(entry({ repairPointsRestored: 40 }), [shieldItem])).toEqual({ kind: 'glow' });
    // The minted item already left the inventory (listed/sold): no fake render.
    expect(benchRisePlanForEntry(entry({ itemId: 'gone-1' }), [shieldItem])).toEqual({ kind: 'glow' });
  });
});

describe('salvageRisePlanForEntry — the salvage beat pictures the yield', () => {
  const scrapItem = { id: 'scrap-1', name: 'Old Boot' } as unknown as GearItem;
  const yieldFixture = {
    scrapValue: 12,
    scrapAlloy: 0,
    ballisticParts: 0,
    reactiveComponents: 0,
    techFragments: 0,
    voidDust: 0,
    essences: {},
  };

  it('a settled recycle rises as Scrap — never as the destroyed item', () => {
    const e: SalvageFeedEntry = { id: 's1', kind: 'item', item: scrapItem, yield: yieldFixture, timestamp: 1 };
    expect(salvageRisePlanForEntry(e)).toEqual({ kind: 'material', materialId: MaterialType.Scrap });
  });

  it('a batch settlement earns the same single beat', () => {
    const e: SalvageFeedEntry = {
      id: 's2',
      kind: 'batch',
      summary: { maxRarity: 'Rare', totalItems: 9, countsByRarity: {}, scrap: 300, cores: 0, bonusMaterials: {} },
      timestamp: 2,
    };
    expect(salvageRisePlanForEntry(e)).toEqual({ kind: 'material', materialId: MaterialType.Scrap });
  });

  it('a failed batch settled nothing — no beat', () => {
    const e: SalvageFeedEntry = { id: 's3', kind: 'batchFailed', ceiling: 'Rare', totalItems: 9, message: 'nope', timestamp: 3 };
    expect(salvageRisePlanForEntry(e)).toBeNull();
  });
});
