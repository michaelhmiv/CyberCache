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
