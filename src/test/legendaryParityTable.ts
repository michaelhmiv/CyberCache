import { WeaponType } from '@/types/game';

/**
 * Legendary art↔type parity table — the audit made data (weapon pixel
 * program, slice 2).
 *
 * The law (owner, 2026-11-02): legendary drops are constrained to the
 * weapon type their bespoke art depicts — the art and the item always
 * agree. The generator enforces it by pinning a legendary's type to
 * its effect def's `weaponType` (weaponGenerator step 3b/4), so the
 * def's type is only honest if the SPRITE actually depicts that type.
 *
 * Every row below was read off the sprite itself (silhouette grammar:
 * stock + long thin barrel + optic = Sniper; compact frame + prominent
 * magazine = SMG; handgun grip with no stock = Pistol, twin barrels
 * included; twin/stocked double barrel or pump + shell furniture =
 * Shotgun; oversized bore / bell / drum ordnance = Launcher; energy
 * emitter in place of a bore = Beam). `depictedType` records what the
 * art shows, NOT what the def claims — the parity test asserts the two
 * agree, so re-typing a def or re-arting a sprite without re-reading
 * the other side fails the suite and forces a fresh audit.
 *
 * The one documented exception is Thunder Receipt: its sprite reads
 * as a carbine, and the owner ruled the item a Sniper anyway (PR
 * #285; the def carries the ruling). Its row records the honest read
 * and verdict 'owner-ruled' — the test pins that it stays the ONLY
 * exception.
 */
export interface LegendaryArtParityRow {
  /** LEGENDARY_EFFECTS id, or null for the name-keyed proof piece. */
  effectId: string | null;
  /** Display name (the effect's name, or 'Emberfall'). */
  name: string;
  /** Manifest sprite id (kind 'weapon-legendary'). */
  spriteId: string;
  /** The def's weaponType — null for Emberfall, which has no def. */
  defType: WeaponType | null;
  /** The type the sprite's silhouette actually depicts. */
  depictedType: WeaponType;
  verdict: 'agree' | 'owner-ruled';
  /** The silhouette evidence for the read. */
  note: string;
}

export const LEGENDARY_ART_PARITY: readonly LegendaryArtParityRow[] = [
  {
    effectId: 'debt_collector',
    name: 'Debt Collector',
    spriteId: 'legendary-debt-collector',
    defType: WeaponType.Pistol,
    depictedType: WeaponType.Pistol,
    verdict: 'agree',
    note: 'Revolver: handgun grip, hammer, tally-mark cylinder. The long barrel does not make it a rifle — no stock, no optic.',
  },
  {
    effectId: 'warranty_void',
    name: 'Warranty Void',
    spriteId: 'legendary-warranty-void',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Compact stocked carbine with a long stick magazine — the magazine is the silhouette’s loudest feature.',
  },
  {
    effectId: 'ricochet_gospel',
    name: 'Ricochet Gospel',
    spriteId: 'legendary-ricochet-gospel',
    defType: WeaponType.Sniper,
    depictedType: WeaponType.Sniper,
    verdict: 'agree',
    note: 'Extreme-length thin barrel with fin blades, halo optic, thumbhole stock, no magazine to speak of.',
  },
  {
    effectId: 'bad_decision',
    name: 'Bad Decision',
    spriteId: 'legendary-bad-decision',
    defType: WeaponType.Shotgun,
    depictedType: WeaponType.Shotgun,
    verdict: 'agree',
    note: 'Stocked side-by-side double barrel with a shell bandolier — the stocked twin barrel is the shotgun read (cf. Second Opinion).',
  },
  {
    effectId: 'glass_sun',
    name: 'Glass Sun',
    spriteId: 'legendary-glass-sun',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Short, chunky compact: pistol grip, short fat barrel, the sun orb rides the receiver like a drum. No stock-and-reach, no optic.',
  },
  {
    effectId: 'the_accountant',
    name: 'The Accountant',
    spriteId: 'legendary-the-accountant',
    defType: WeaponType.Sniper,
    depictedType: WeaponType.Sniper,
    verdict: 'agree',
    note: 'Textbook precision rifle: longest thin barrel in the set, full scope, thumbhole stock, minimal magazine.',
  },
  {
    effectId: 'armor_eater',
    name: 'Armor Eater',
    spriteId: 'legendary-armor-eater',
    defType: WeaponType.Sniper,
    depictedType: WeaponType.Sniper,
    verdict: 'agree',
    note: 'Scoped rifle with fixed stock and a long barrel; the toothed maw muzzle and hanging acid vials are decoration on a sniper frame.',
  },
  {
    effectId: 'thunder_receipt',
    name: 'Thunder Receipt',
    spriteId: 'legendary-thunder-receipt',
    defType: WeaponType.Sniper,
    depictedType: WeaponType.SMG,
    verdict: 'owner-ruled',
    note: 'The sprite reads as a carbine (stocked automatic body, stick mag, tesla-coil barrel). Owner ruling 2026-11-02 (PR #285): Thunder Receipt is a Sniper — the owner’s call over the art’s read, recorded in the def. This row is the pinned, only exception.',
  },
  {
    effectId: 'second_opinion',
    name: 'Second Opinion',
    spriteId: 'legendary-second-opinion',
    defType: WeaponType.Pistol,
    depictedType: WeaponType.Pistol,
    verdict: 'agree',
    note: 'Twin barrels on a handgun frame: pistol grip and trigger guard, NO stock. The grip decides — Bad Decision’s stocked double barrel is the shotgun, this is the double-barrel handgun.',
  },
  {
    effectId: 'salvage_rights',
    name: 'Salvage Rights',
    spriteId: 'legendary-salvage-rights',
    defType: WeaponType.Launcher,
    depictedType: WeaponType.Launcher,
    verdict: 'agree',
    note: 'Heavy industrial ordnance: massive drum body, thick barrel, crane hook. Nothing about it is a firearm silhouette.',
  },
  {
    effectId: 'overclocked',
    name: 'Overclocked',
    spriteId: 'legendary-overclocked',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Stocked automatic with a glowing stick magazine and a ribbed heat-shroud barrel — compact SMG carbine.',
  },
  {
    effectId: 'borrowed_time',
    name: 'Borrowed Time',
    spriteId: 'legendary-borrowed-time',
    defType: WeaponType.Pistol,
    depictedType: WeaponType.Pistol,
    verdict: 'agree',
    note: 'Revolver: clock-face cylinder, single handgun grip, hammer. Long barrel, still a handgun.',
  },
  {
    effectId: 'kickback',
    name: 'Kickback',
    spriteId: 'legendary-kickback',
    defType: WeaponType.Shotgun,
    depictedType: WeaponType.Shotgun,
    verdict: 'agree',
    note: 'Pump-form gun with a row of shotgun shells carried along the body and a fat muzzle brake.',
  },
  {
    effectId: 'vampiric_ledger',
    name: 'Vampiric Ledger',
    spriteId: 'legendary-vampiric-ledger',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Stocked carbine automatic, prominent magazine; the blood tube and claw muzzle are decoration.',
  },
  {
    effectId: 'echo_chamber',
    name: 'Echo Chamber',
    spriteId: 'legendary-echo-chamber',
    defType: WeaponType.Launcher,
    depictedType: WeaponType.Launcher,
    verdict: 'agree',
    note: 'The barrel terminates in a huge flared bell — an oversized bore is the launcher read, whatever the receiver looks like.',
  },
  {
    effectId: 'insurance_fraud_weapon',
    name: 'Insurance Fraud',
    spriteId: 'legendary-insurance-fraud',
    defType: WeaponType.Pistol,
    depictedType: WeaponType.Pistol,
    verdict: 'agree',
    note: 'Semi-automatic handgun: slide, single grip with shield emblem, trigger guard, threaded tip. The tallest sprite in the set and still unmistakably a pistol.',
  },
  {
    effectId: 'market_crash',
    name: 'Market Crash',
    spriteId: 'legendary-market-crash',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Scoped carbine — the scope pulls toward Sniper, but the chunky drum magazine and thick mid-length barrel carry the SMG read (cf. Hot Swapper).',
  },
  {
    effectId: 'stable_loop',
    name: 'Stable Loop',
    spriteId: 'legendary-stable-loop',
    defType: WeaponType.Beam,
    depictedType: WeaponType.Beam,
    verdict: 'agree',
    note: 'A glowing ring emitter with an energy orb sits where the barrel’s work happens — the ring is the weapon, the tube through it is a mount.',
  },
  {
    effectId: 'phase_shifter',
    name: 'Phase Shifter',
    spriteId: 'legendary-phase-shifter',
    defType: WeaponType.Beam,
    depictedType: WeaponType.Beam,
    verdict: 'agree',
    note: 'Translucent phase barrel ending in a swirling portal — no bore, an energy projection.',
  },
  {
    effectId: 'hot_swapper',
    name: 'Hot Swapper',
    spriteId: 'legendary-hot-swapper',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Scoped carbine whose loudest feature is TWO stick magazines (the swap is the theme) — compact automatic, SMG.',
  },
  {
    effectId: 'chain_lightning',
    name: 'Chain Lightning',
    spriteId: 'legendary-chain-lightning',
    defType: WeaponType.Beam,
    depictedType: WeaponType.Beam,
    verdict: 'agree',
    note: 'Rifle furniture, but the muzzle is a forked tesla emitter around a charged orb — an energy weapon, not a bore.',
  },
  {
    effectId: 'molten_core',
    name: 'Molten Core',
    spriteId: 'legendary-molten-core',
    defType: WeaponType.Sniper,
    depictedType: WeaponType.Sniper,
    verdict: 'agree',
    note: 'The closest call in the set: the fat lava barrel pulls toward Launcher, but it carries a full scope, a fixed stock and a long straight barrel — the anti-materiel sniper read. No def-Launcher sprite carries a scope.',
  },
  {
    effectId: 'cryo_stasis',
    name: 'Cryo Stasis',
    spriteId: 'legendary-cryo-stasis',
    defType: WeaponType.Beam,
    depictedType: WeaponType.Beam,
    verdict: 'agree',
    note: 'Frosted rifle body whose barrel is a coil emitter tipped with a snowflake — energy emitter, not a bore.',
  },
  {
    effectId: 'void_bargain',
    name: 'Void Bargain',
    spriteId: 'legendary-void-bargain',
    defType: WeaponType.Pistol,
    depictedType: WeaponType.Pistol,
    verdict: 'agree',
    note: 'Oversized handgun: pistol grip and trigger guard under a caged void portal. Bulky, but the handgun frame decides (cf. Second Opinion).',
  },
  {
    effectId: 'jackpot',
    name: 'Jackpot',
    spriteId: 'legendary-jackpot',
    defType: WeaponType.SMG,
    depictedType: WeaponType.SMG,
    verdict: 'agree',
    note: 'Stocked carbine automatic; the slot reels sit in the receiver and the coin tray rides exactly where the magazine belongs.',
  },
  {
    effectId: null,
    name: 'Emberfall',
    spriteId: 'legendary-emberfall',
    defType: null,
    depictedType: WeaponType.Sniper,
    verdict: 'agree',
    note: 'Name-keyed proof art (the approved loot proof’s rifle): scoped rifle with fixed stock and long barrel. No effect claims it and the name generator never mints “Emberfall”, so it resolves only for a weapon literally carrying that name.',
  },
];
