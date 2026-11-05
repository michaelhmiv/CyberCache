/**
 * HunterMenuDemo — PROTOTYPE harness (design/hunter-menu-prototype,
 * 2026-11-04). NOT shipped UI: a fixture stage for the Hunter-menu
 * design pass, served only at /hunter-demo?variant=deck|strip|hub
 * (main.tsx branches before the real app mounts).
 *
 * It mounts the REAL ProfileScreen (with its real panels) over
 * seeded store state — a mid-game hunter: level 24, 18 of 23 skill
 * points spent with 5 unspent, a research course in progress
 * (fixture seam — production reads the Chef research state), skin
 * parts owned and worn, a death record — so the three directions
 * can be captured at phone width under real load. No Chef session:
 * service-backed panels render their real offline states.
 */
import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { usePlayerStore, useSkillStore, useInventoryStore, useSurvivalStore } from '@/store';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { xpToNextLevel } from '@/content/simulation';
import { getSkillTreeNodes } from '@/constants/skillTrees';
import { SkillTreeType } from '@/types/game';
import { SKIN_PARTS, type CosmeticsStateView } from '@/content/skins';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';
import { DropSource, Rarity } from '@/types/game';
import type { ResearchStatusLine } from '@/components/profile/HunterMenuChrome';

const FIXTURE_RESEARCH: ResearchStatusLine = { courseLabel: 'Advanced Ballistics', progress: 0.62 };

/** Fill a tree's nodes in tier order until the point budget is spent
 *  (sum of spent values = budget, so ProfileScreen's own arithmetic
 *  yields the intended unspent remainder). */
function fillTree(tree: SkillTreeType, budget: number, into: Record<string, number>) {
  const nodes = [...getSkillTreeNodes(tree)].sort((a, b) => a.tier - b.tier || a.index - b.index);
  let remaining = budget;
  for (const node of nodes) {
    if (remaining <= 0) break;
    const add = Math.min(node.maxPoints, remaining);
    if (add > 0) {
      into[node.id] = add;
      remaining -= add;
    }
  }
}

function seedFixture() {
  const level = 24;
  usePlayerStore.setState({
    name: 'Rook Sandoval',
    profileLoaded: true,
    level,
    xp: Math.floor(xpToNextLevel(level) * 0.62),
    credits: 24100,
    scrap: 31600,
    cacheKeys: 15,
    cacheKeyFragments: 2,
    legendaryCores: 3,
    cacheRankTokens: 140,
  });

  // 18 of 23 points spent (Gunslinger 8 · Demolition 5 · Scavenger
  // 5 · Fixer 0) → 5 unspent: the eye-leading fact every direction
  // must surface without a tap.
  const spent: Record<string, number> = {};
  fillTree(SkillTreeType.Gunslinger, 8, spent);
  fillTree(SkillTreeType.Demolition, 5, spent);
  fillTree(SkillTreeType.Scavenger, 5, spent);
  useSkillStore.setState({ spent });

  try {
    const weapons = [
      generateWeapon({ source: DropSource.BossDrop, level: 24, forcedRarity: Rarity.Legendary }, createTickRng('hunter-demo', 'boss-a', 1)),
      generateWeapon({ source: DropSource.BossDrop, level: 22, forcedRarity: Rarity.Legendary }, createTickRng('hunter-demo', 'boss-b', 2)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 26, forcedRarity: Rarity.Epic }, createTickRng('hunter-demo', 'roam-a', 3)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 21, forcedRarity: Rarity.Rare }, createTickRng('hunter-demo', 'roam-b', 4)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 19, forcedRarity: Rarity.Rare }, createTickRng('hunter-demo', 'roam-c', 5)),
      generateWeapon({ source: DropSource.RoamingDrop, level: 18, forcedRarity: Rarity.Uncommon }, createTickRng('hunter-demo', 'roam-d', 6)),
    ];
    useInventoryStore.setState({ items: weapons });
  } catch (error) {
    console.warn('[hunter-demo] weapon fixture failed, continuing without inventory', error);
  }

  // Wardrobe: five parts owned (Bulwark + Dreadplate mix), three worn.
  const picks = ['bulwark-head', 'bulwark-torso', 'bulwark-back', 'dread-head', 'dread-torso']
    .map((id) => SKIN_PARTS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const parts = picks.map((def, i) => ({
    id: `fx-part-${i + 1}`,
    partId: def.id,
    slot: def.slot,
    setId: def.setId,
    tier: def.tier,
    name: def.name,
    quality: 82 - i * 7,
    tintPaletteId: null,
    runtimeState: 'owned',
  }));
  const view: CosmeticsStateView = {
    selection: {
      equipped: { head: 'fx-part-1', torso: 'fx-part-2', back: 'fx-part-3' },
      headVariant: 'visor',
    },
    selectionExists: true,
    parts,
    wearableVariantIds: ['visor'],
  };
  useCosmeticsStore.setState({ view, loadState: 'ready' });

  const now = Date.now();
  useSurvivalStore.setState({
    deathLog: [
      { monsterId: 'dune_tyrant', monsterName: 'Dune Tyrant', areaId: 'dustwaste', at: now - 2 * 86400000 },
      { monsterId: 'rust_prophet', monsterName: 'Rust Prophet', areaId: 'scrapyard', at: now - 5 * 86400000 },
      { monsterId: 'choir_of_teeth', monsterName: 'Choir of Teeth', areaId: 'sunken_relay', at: now - 9 * 86400000 },
    ],
  });
}

const VARIANTS = ['deck', 'strip', 'hub'] as const;
type Variant = (typeof VARIANTS)[number];

const DemoStage: React.FC = () => {
  const { loading } = useAuth();
  const [variant, setVariant] = useState<Variant>(() => {
    const v = new URLSearchParams(window.location.search).get('variant');
    return (VARIANTS as readonly string[]).includes(v ?? '') ? (v as Variant) : 'hub';
  });
  const [seeded, setSeeded] = useState(false);

  // The AuthProvider's boot resets every runtime store to initial
  // state (its signed-out path) — seeding before that reset lands
  // gets wiped. Seed only once auth has settled, then mount the
  // screen: panels that self-load (Wardrobe) see loadState 'ready'
  // and keep the fixture.
  useEffect(() => {
    if (loading || seeded) return;
    const t = setTimeout(() => {
      seedFixture();
      setSeeded(true);
    }, 350);
    return () => clearTimeout(t);
  }, [loading, seeded]);

  return (
      <div className="flex h-dvh flex-col bg-bg" data-testid={`hunter-demo-${variant}`}>
        {/* Capture switcher — scaffolding, not design. */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-2 py-1">
          {VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`demo-switch-${v}`}
              onClick={() => setVariant(v)}
              className={`px-2 py-1 text-[11px] font-black uppercase ${variant === v ? 'bg-amber text-bg' : 'text-text-muted'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {seeded && (
            <ProfileScreen
              key={variant}
              menuVariant={variant}
              fixtureResearch={FIXTURE_RESEARCH}
              onNavigate={() => {}}
            />
          )}
        </div>
        <BottomNav activeTab="hunter" onChange={() => {}} />
      </div>
  );
};

export const HunterMenuDemo: React.FC = () => (
  <AuthProvider>
    <DemoStage />
  </AuthProvider>
);
