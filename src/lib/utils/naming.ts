import { Element, WeaponType, Manufacturer } from '../../types/game';

const PREFIXES: Record<Element, string[]> = {
  [Element.Kinetic]: ['Solid', 'Standard', 'Reliable', 'Neutral'],
  [Element.Fire]: ['Burning', 'Scorched', 'Molten', 'Pyro'],
  [Element.Shock]: ['Surging', 'Live', 'Spark', 'Ion'],
  [Element.Corrosive]: ['Acid', 'Venom', 'Rust', 'Toxic'],
  [Element.Cryo]: ['Frozen', 'Cryo', 'Boreal', 'Icebound'],
  [Element.Void]: ['Abyssal', 'Null', 'Dark', 'Cursed'],
};

const CORE_NAMES: Record<WeaponType, string[]> = {
  [WeaponType.Pistol]: ['Striker', 'Revolver', 'Handcannon', 'Sidearm'],
  [WeaponType.SMG]: ['Spray', 'Drum', 'Sub', 'Rattler'],
  [WeaponType.Shotgun]: ['Breach', 'Scatter', 'Buck', 'Mauler'],
  [WeaponType.Sniper]: ['Longshot', 'Needle', 'Rail', 'Hawkeye'],
  [WeaponType.Launcher]: ['Boom', 'RPG', 'Tube', 'Warhead'],
  [WeaponType.Beam]: ['Laser', 'Beam', 'Ray', 'Torch'],
};

const MANUFACTURER_TITLES: Record<Manufacturer, string[]> = {
  [Manufacturer.Redline]: ['Redline', 'Crimson', 'Velocity'],
  [Manufacturer.Ironwood]: ['Ironwood', 'Hardwood', 'Stalker'],
  [Manufacturer.BlastForge]: ['BlastForge', 'Forge', 'Crater'],
  [Manufacturer.Prismatek]: ['Prismatek', 'Prisma', 'Spectra'],
  [Manufacturer.ThrowTech]: ['ThrowTech', 'Deploy', 'Drone'],
  [Manufacturer.HelixWorks]: ['HelixWorks', 'Helix', 'Modular'],
};

const SUFFIXES = ['Mk.I', 'Mk.II', 'Variant', 'Custom', 'Elite', 'Prototype', 'Blueprints', 'Spec'];

export function generateWeaponName(
  type: WeaponType,
  manufacturer: Manufacturer,
  element: Element,
  rng: () => number
): string {
  const prefix = PREFIXES[element][Math.floor(rng() * PREFIXES[element].length)];
  const core = CORE_NAMES[type][Math.floor(rng() * CORE_NAMES[type].length)];
  const mTitle = MANUFACTURER_TITLES[manufacturer][Math.floor(rng() * MANUFACTURER_TITLES[manufacturer].length)];
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return `${prefix} ${mTitle} ${core} ${suffix}`;
}
