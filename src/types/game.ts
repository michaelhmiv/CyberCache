export enum Element {
  Kinetic = 'Kinetic',
  Fire = 'Fire',
  Shock = 'Shock',
  Corrosive = 'Corrosive',
  Cryo = 'Cryo',
  Void = 'Void',
}

export enum Rarity {
  Common = 'Common',
  Uncommon = 'Uncommon',
  Rare = 'Rare',
  Epic = 'Epic',
  Legendary = 'Legendary',
}

export enum WeaponType {
  Pistol = 'Pistol',
  SMG = 'SMG',
  Shotgun = 'Shotgun',
  Sniper = 'Sniper',
  Launcher = 'Launcher',
  Beam = 'Beam',
}

export enum Manufacturer {
  Redline = 'Redline',
  Ironwood = 'Ironwood',
  BlastForge = 'BlastForge',
  Prismatek = 'Prismatek',
  ThrowTech = 'ThrowTech',
  HelixWorks = 'HelixWorks',
}

export enum DropSource {
  WorldDrop = 'World Drop',
  BossDrop = 'Boss Drop',
  CacheForged = 'Cache-Forged',
  Crafted = 'Crafted',
  Event = 'Event',
  Marketplace = 'Marketplace',
}

export enum SkillTreeType {
  Gunslinger = 'Gunslinger',
  Demolition = 'Demolition',
  Scavenger = 'Scavenger',
  Fixer = 'Fixer',
}

export enum ConsumableType {
  MedKit = 'MedKit',
  MedKitRefined = 'MedKitRefined',
  Grenade = 'Grenade',
  OrdnanceCharge = 'OrdnanceCharge',
  AmmoPack = 'AmmoPack',
  HighCapacityAmmoPack = 'HighCapacityAmmoPack',
  ShieldCell = 'ShieldCell',
  ElementalCoating = 'ElementalCoating',
  LuckBooster = 'LuckBooster',
  BossScanner = 'BossScanner',
  InsuranceToken = 'InsuranceToken',
  NanoSwarm = 'NanoSwarm',
  AdrenalineShot = 'AdrenalineShot',
  ArmorPiercingAmmo = 'ArmorPiercingAmmo',
  IncendiaryAmmo = 'IncendiaryAmmo',
  ShockAmmo = 'ShockAmmo',
  CorrosiveAmmo = 'CorrosiveAmmo',
  CryoAmmo = 'CryoAmmo',
  VoidAmmo = 'VoidAmmo',
  OverchargeStim = 'OverchargeStim',
  TargetPainter = 'TargetPainter',
  PhaseShiftGrenade = 'PhaseShiftGrenade',
  EMPCharge = 'EMPCharge',
  CorrosiveCharge = 'CorrosiveCharge',
  MagnetizedPayload = 'MagnetizedPayload',
  Jammer = 'Jammer',
  DataSkimmer = 'DataSkimmer',
  SignalScrambler = 'SignalScrambler',
  LootBeacon = 'LootBeacon',
  SalvageContract = 'SalvageContract',
  WorkshopRushTicket = 'WorkshopRushTicket',
  GenericFuelCell = 'GenericFuelCell',
  PatchKit = 'PatchKit',
  // Crafted vehicle consumables (crafting-as-occupation slice): the
  // tier-2/tier-3 patch kits and the crafted fuel cell. None are
  // vendor-stocked — they exist only from crafters and the player
  // market (occupations law: >100% quality and non-vendor types come
  // only from crafters/market). Defs live in src/constants/consumables.ts.
  FieldPatchKit = 'FieldPatchKit',
  MasterPatchKit = 'MasterPatchKit',
  FuelCell = 'FuelCell',
  // Manufacturer Standing exclusives (0043): one craftable consumable
  // per manufacturer, gated behind rank 2 on that manufacturer's
  // standing ladder (requiresStanding). vendorExcluded — the NPC
  // vendor never sells them; they exist only from crafters holding
  // the rank and from the player market. Defs in
  // src/constants/consumables.ts.
  RedlineTonic = 'RedlineTonic',
  HeartwoodSightOil = 'HeartwoodSightOil',
  ForgeheartCharge = 'ForgeheartCharge',
  PrismCoating = 'PrismCoating',
  ThrowTechDecoyKit = 'ThrowTechDecoyKit',
  HelixCalibrationKit = 'HelixCalibrationKit',
  // Shield-Tech services (0044): the Calibration Core — the
  // crafter-only consumable a shield tech burns to recalibrate a
  // shield's behavior archetype. vendorExcluded: it exists only from
  // crafters and the player market. Def in src/constants/consumables.ts;
  // the capacity model lives in src/content/shieldTech.ts.
  CalibrationCore = 'CalibrationCore',
}

export enum MaterialType {
  ScrapAlloy = 'ScrapAlloy',
  BallisticParts = 'BallisticParts',
  ReactiveComponents = 'ReactiveComponents',
  TechFragments = 'TechFragments',
  VoidDust = 'VoidDust',
  // Tier-2 area-signature materials (roaming-variance overhaul, Q2
  // ruling): one per area, home-area sourced, tradable. Their defs
  // (home area, unlock, use) live in src/content/roamingEvents.ts
  // (SIGNATURE_MATERIALS) — this enum is only the key space, and
  // MARKET_MATERIAL_IDS derives the tradable list from it.
  Siltglass = 'Siltglass',
  NitrocellGel = 'NitrocellGel',
  HeartwoodResin = 'HeartwoodResin',
  ForgeheartIngots = 'ForgeheartIngots',
  PrismShards = 'PrismShards',
  MagnetiteCores = 'MagnetiteCores',
  MycoSteelFiber = 'MycoSteelFiber',
  // Refined materials (crafting-as-occupation slice): outputs of the
  // Workshop refining recipes — Tier-2 refined forms of the five base
  // materials plus three Lab composites. They live in the same
  // profiles.materials map, are inputs to gear frames / tools /
  // composites, and are player-market tradable (migration 0024
  // extends the cc_market_create_material whitelist to all 20 ids —
  // MARKET_MATERIAL_IDS derives from this enum, so the TS twin is
  // automatic; the parity test pins the SQL list to this enum).
  RefinedAlloy = 'RefinedAlloy',
  TemperedParts = 'TemperedParts',
  StabilizedCells = 'StabilizedCells',
  WovenCircuits = 'WovenCircuits',
  CondensedVoid = 'CondensedVoid',
  CompositePlating = 'CompositePlating',
  CircuitLattice = 'CircuitLattice',
  Voidweave = 'Voidweave',
}

export enum EssenceType {
  IgnitionFluid = 'IgnitionFluid',
  ConduitWire = 'ConduitWire',
  AcidCompound = 'AcidCompound',
  CryoGel = 'CryoGel',
  VoidEssence = 'VoidEssence',
}

export enum CraftedConsumableType {
  MedKit = 'MedKit',
  MedKitRefined = 'MedKitRefined',
  ShieldCell = 'ShieldCell',
  NanoSwarm = 'NanoSwarm',
  AdrenalineShot = 'AdrenalineShot',
  AmmoPack = 'AmmoPack',
  HighCapacityAmmoPack = 'HighCapacityAmmoPack',
  ArmorPiercingAmmo = 'ArmorPiercingAmmo',
  IncendiaryAmmo = 'IncendiaryAmmo',
  ShockAmmo = 'ShockAmmo',
  CorrosiveAmmo = 'CorrosiveAmmo',
  CryoAmmo = 'CryoAmmo',
  VoidAmmo = 'VoidAmmo',
  OrdnanceCharge = 'OrdnanceCharge',
  OverchargeStim = 'OverchargeStim',
  TargetPainter = 'TargetPainter',
  PhaseShiftGrenade = 'PhaseShiftGrenade',
  EMPCharge = 'EMPCharge',
  CorrosiveCharge = 'CorrosiveCharge',
  LuckBooster = 'LuckBooster',
  BossScanner = 'BossScanner',
  InsuranceToken = 'InsuranceToken',
  DataSkimmer = 'DataSkimmer',
  Jammer = 'Jammer',
  MagnetizedPayload = 'MagnetizedPayload',
  SignalScrambler = 'SignalScrambler',
  LootBeacon = 'LootBeacon',
  SalvageContract = 'SalvageContract',
  WorkshopRushTicket = 'WorkshopRushTicket',
}

export enum ConsumableSlot {
  PreFight = 'PreFight',
  MidFight = 'MidFight',
  Emergency = 'Emergency',
}

export type ConsumableLoadout = Record<ConsumableSlot, string | null>;

export enum RiskSetting {
  Conservative = 'Conservative',
  Balanced = 'Balanced',
  Greedy = 'Greedy',
  AllIn = 'AllIn',
}
