/**
 * itemSlugs — the game-id → Top-Choice wave-slug maps for the
 * INT-4 item families (Wave 11 consumables, Wave 12 materials /
 * essences / wallet resources). Pure data, no imports: the wiki
 * generator imports these maps under tsx, where the Vite-only
 * manifest module cannot load — so the maps live in their own
 * leaf module and itemArt.ts re-exports them beside the sprite
 * lookups. Cache Fragment has NO entry anywhere here: deleted
 * (owner ruling 2026-11-11).
 */

/** ConsumableType id (game id, e.g. 'MedKit') → Wave 11 slug. */
export const CONSUMABLE_SLUGS: Readonly<Record<string, string>> = {
  MedKit: 'med-kit',
  MedKitRefined: 'med-kit-refined',
  ShieldCell: 'shield-cell',
  NanoSwarm: 'nano-swarm',
  AdrenalineShot: 'adrenaline-shot',
  AmmoPack: 'ammo-pack',
  HighCapacityAmmoPack: 'high-capacity-ammo-pack',
  ArmorPiercingAmmo: 'armor-piercing-ammo',
  IncendiaryAmmo: 'incendiary-ammo',
  ShockAmmo: 'shock-ammo',
  CorrosiveAmmo: 'corrosive-ammo',
  CryoAmmo: 'cryo-ammo',
  VoidAmmo: 'void-ammo',
  Grenade: 'grenade',
  OrdnanceCharge: 'ordnance-charge',
  EMPCharge: 'emp-charge',
  CorrosiveCharge: 'corrosive-charge',
  PhaseShiftGrenade: 'phase-shift-grenade',
  MagnetizedPayload: 'magnetized-payload',
  OverchargeStim: 'overcharge-stim',
  TargetPainter: 'target-painter',
  BossScanner: 'boss-scanner',
  Jammer: 'jammer',
  SignalScrambler: 'signal-scrambler',
  LootBeacon: 'loot-beacon',
  InsuranceToken: 'insurance-token',
  DataSkimmer: 'data-skimmer',
  LuckBooster: 'luck-booster',
  SalvageContract: 'salvage-contract',
  WorkshopRushTicket: 'workshop-rush-ticket',
  ElementalCoating: 'elemental-coating',
  GenericFuelCell: 'generic-fuel-cell',
  PatchKit: 'patch-kit',
  FieldPatchKit: 'field-patch-kit',
  MasterPatchKit: 'master-patch-kit',
  FuelCell: 'fuel-cell',
  CalibrationCore: 'calibration-core',
  RedlineTonic: 'redline-tonic',
  HeartwoodSightOil: 'heartwood-sight-oil',
  ForgeheartCharge: 'forgeheart-charge',
  PrismCoating: 'prism-coating',
  ThrowTechDecoyKit: 'throw-tech-decoy-kit',
  HelixCalibrationKit: 'helix-calibration-kit',
  OverclockSerum: 'overclock-serum',
};

/** MaterialType / EssenceType id → Wave 12 slug. Scrap is the
 *  unified stock (migration 0069): MaterialType.Scrap and the
 *  'scrap' resource are the same entry, served by one master. */
export const MATERIAL_SLUGS: Readonly<Record<string, string>> = {
  Scrap: 'scrap',
  BallisticParts: 'ballistic-parts',
  ReactiveComponents: 'reactive-components',
  TechFragments: 'tech-fragments',
  VoidDust: 'void-dust',
  Siltglass: 'siltglass',
  NitrocellGel: 'nitrocell-gel',
  HeartwoodResin: 'heartwood-resin',
  ForgeheartIngots: 'forgeheart-ingots',
  PrismShards: 'prism-shards',
  MagnetiteCores: 'magnetite-cores',
  MycoSteelFiber: 'myco-steel-fiber',
  RefinedAlloy: 'refined-alloy',
  TemperedParts: 'tempered-parts',
  StabilizedCells: 'stabilized-cells',
  WovenCircuits: 'woven-circuits',
  CondensedVoid: 'condensed-void',
  CompositePlating: 'composite-plating',
  CircuitLattice: 'circuit-lattice',
  Voidweave: 'voidweave',
  Chromaweave: 'chromaweave',
  IgnitionFluid: 'ignition-fluid',
  ConduitWire: 'conduit-wire',
  AcidCompound: 'acid-compound',
  CryoGel: 'cryo-gel',
  VoidEssence: 'void-essence',
};

/** ResourceVisualId → Wave 12 slug, for the wallet masters.
 *  'scrap' resolves through MATERIAL_SLUGS (one stock, one
 *  master); Cache Fragment is deleted, not mapped. */
export const WALLET_SLUGS: Readonly<Record<string, string>> = {
  credits: 'credits',
  cacheKey: 'cache-key',
  xp: 'xp',
  level: 'level',
  masteryPoint: 'mastery-point',
  loot: 'loot',
  legendaryCore: 'legendary-core',
};

