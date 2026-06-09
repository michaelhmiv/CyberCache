import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Crosshair, Hammer, Map, Shield, Swords, Trophy, Zap } from 'lucide-react';
import { SkillTreeScreen } from './SkillTreeScreen';
import { useBossStore, useInventoryStore, usePlayerStore, useSkillStore } from '@/store';
import { getMyMasterySummary, type MasterySummaryRow } from '@/lib/supabase/masteryService';

type MasteryTab = 'overview' | 'skills';
type CategoryId = 'combat' | 'weapons' | 'inventory' | 'locations' | 'economy' | 'services';

interface MasteryCategory {
  id: CategoryId;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const masteryCategories: MasteryCategory[] = [
  { id: 'combat', label: 'Combat', desc: 'Roaming, boss attempts, risk stance wins', icon: Crosshair, color: '#FF4B5C' },
  { id: 'weapons', label: 'Weapons', desc: 'Pistols, SMGs, shotguns, ordnance, elements', icon: Swords, color: '#FF9000' },
  { id: 'inventory', label: 'Inventory', desc: 'Scrapping, repairs, crafting, cache opens', icon: Shield, color: '#FFEA3A' },
  { id: 'locations', label: 'Locations', desc: 'Region activity and local mastery', icon: Map, color: '#7CFC00' },
  { id: 'economy', label: 'Economy', desc: 'Net worth, trades, listings, services', icon: BarChart3, color: '#06B6D4' },
  { id: 'services', label: 'Services', desc: 'Repair jobs, reputation, fulfilled work', icon: Hammer, color: '#A855F7' },
];

const categoryIds = new Set<CategoryId>(masteryCategories.map((category) => category.id));

const staticTracks: MasterySummaryRow[] = [
  { mastery_id: 'combat.boss_defeats', category: 'combat', label: 'Boss Defeats', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'combat.boss_attempts', category: 'combat', label: 'Boss Attempts', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'inventory.cache_draws', category: 'inventory', label: 'Cache Draws', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'inventory.recycle', category: 'inventory', label: 'Recycling', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'economy.vendor_buys', category: 'economy', label: 'Vendor Supply', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'economy.market_listings', category: 'economy', label: 'Market Listings', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'locations.dustwaste', category: 'locations', label: 'Dustwaste Mastery', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'services.repair', category: 'services', label: 'Repair Services', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'weapons.pistol', category: 'weapons', label: 'Pistol Mastery', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'weapons.smg', category: 'weapons', label: 'SMG Mastery', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'weapons.shotgun', category: 'weapons', label: 'Shotgun Mastery', mastery_xp: 0, mastery_level: 1, rank: 0 },
  { mastery_id: 'weapons.ordnance', category: 'weapons', label: 'Ordnance Mastery', mastery_xp: 0, mastery_level: 1, rank: 0 },
];

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeTrack(track: MasterySummaryRow): MasterySummaryRow {
  const category = categoryIds.has(track.category as CategoryId) ? track.category : 'combat';
  return {
    mastery_id: typeof track.mastery_id === 'string' && track.mastery_id.length > 0 ? track.mastery_id : 'unknown',
    category,
    label: typeof track.label === 'string' && track.label.length > 0 ? track.label : 'Unknown Mastery',
    mastery_xp: toNumber(track.mastery_xp),
    mastery_level: Math.max(1, Math.trunc(toNumber(track.mastery_level))),
    rank: Math.max(0, Math.trunc(toNumber(track.rank))),
  };
}

const RankTile: React.FC<{ label: string; value: string | number; sub: string }> = ({ label, value, sub }) => (
  <div className="bl-card p-3">
    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</div>
    <div className="truncate text-xl font-black text-text-primary">{value}</div>
    <div className="truncate text-[9px] text-text-muted">{sub}</div>
  </div>
);

/**
 * Constellation node: a single mastery track shown as a star in a
 * skill-tree-like graph. The node is one of three ascension tiers
 * (Pulsar, Nova, Constellation) and the size scales with mastery level.
 * Lines connect nodes within the same category, giving the visual a
 * "constellation" feel instead of a flat list.
 */
type AscTier = 0 | 1 | 2 | 3;
const tierMeta: Record<AscTier, { label: string; ring: number; glow: number }> = {
  0: { label: 'Dormant', ring: 0, glow: 4 },
  1: { label: 'Active', ring: 1, glow: 8 },
  2: { label: 'Pulsar', ring: 2, glow: 14 },
  3: { label: 'Nova', ring: 3, glow: 20 },
};
const tierFromXp = (xp: number): AscTier => (xp >= 5000 ? 3 : xp >= 2000 ? 2 : xp >= 500 ? 1 : 0);

const ConstellationNode: React.FC<{ track: MasterySummaryRow; x: number; y: number; color: string; onClick?: () => void }> = ({ track, x, y, color, onClick }) => {
  const xp = toNumber(track.mastery_xp);
  const tier = tierFromXp(xp);
  const meta = tierMeta[tier];
  const radius = 12 + meta.ring * 4;
  return (
    <g className="cursor-pointer" onClick={onClick}>
      <title>{`${track.label} · ${meta.label} · Lv ${Math.max(1, toNumber(track.mastery_level))} · ${xp.toLocaleString()} XP`}</title>
      <circle cx={x} cy={y} r={radius + 4} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.25} />
      <circle cx={x} cy={y} r={radius + 2} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45} />
      <circle cx={x} cy={y} r={radius} fill="#0b0d10" stroke={color} strokeWidth={2.5} />
      <circle cx={x} cy={y} r={radius * 0.55} fill={color} fillOpacity={0.25} />
      <circle cx={x} cy={y} r={radius * 0.35} fill={color} filter={`url(#constellation-glow)`} opacity={0.85} />
      <text x={x} y={y + radius + 12} textAnchor="middle" className="fill-text-primary" fontSize={9} fontWeight={800} style={{ textTransform: 'uppercase' }}>{track.label.replace(' Mastery', '')}</text>
    </g>
  );
};

/**
 * The constellation visualization: one central node per category, satellite
 * tracks branching out, lines connecting same-category nodes. Sized to the
 * 320x280 area; nodes are positioned on a soft circle so the visual reads
 * as a star map, not a grid.
 */
const ConstellationMap: React.FC<{ tracks: MasterySummaryRow[]; categories: MasteryCategory[] }> = ({ tracks, categories }) => {
  const W = 360;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2;
  const orbitR = 110;
  // For each category, position one "category node" at the angle on the orbit
  // and place its track-nodes around the category node on a smaller orbit.
  const layout = useMemo(() => {
    const layoutMap = new Map<string, { x: number; y: number; categoryNodeX: number; categoryNodeY: number }>();
    const totalCats = categories.length;
    categories.forEach((cat, catIdx) => {
      const catAngle = (catIdx / totalCats) * Math.PI * 2 - Math.PI / 2;
      const catX = cx + orbitR * Math.cos(catAngle);
      const catY = cy + orbitR * Math.sin(catAngle);
      const catTracks = tracks.filter((track) => track.category === cat.id);
      const subOrbit = 36 + Math.min(catTracks.length, 5) * 4;
      catTracks.forEach((track, trackIdx) => {
        const subAngle = (trackIdx / Math.max(1, catTracks.length)) * Math.PI * 2;
        const x = catX + subOrbit * Math.cos(subAngle);
        const y = catY + subOrbit * Math.sin(subAngle);
        layoutMap.set(track.mastery_id, { x, y, categoryNodeX: catX, categoryNodeY: catY });
      });
    });
    return layoutMap;
    // cx, cy, orbitR are module-constants used in the layout math. Adding
    // them as deps would re-run the memo on every render even when the
    // underlying tracks haven't changed, so they're intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, categories]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Mastery constellation map">
      <defs>
        <filter id="constellation-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <radialGradient id="constellation-bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#1a1d24" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0b0d10" stopOpacity="0.0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#constellation-bg)" />
      {/* faint orbit ring */}
      <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke="#2a2f3a" strokeWidth={1} strokeDasharray="2 4" />
      {/* connecting lines: center → category, category → track */}
      {categories.map((cat) => {
        const catAngle = (categories.indexOf(cat) / categories.length) * Math.PI * 2 - Math.PI / 2;
        const catX = cx + orbitR * Math.cos(catAngle);
        const catY = cy + orbitR * Math.sin(catAngle);
        return <line key={`c-line-${cat.id}`} x1={cx} y1={cy} x2={catX} y2={catY} stroke={cat.color} strokeWidth={1} strokeOpacity={0.45} strokeDasharray="2 3" />;
      })}
      {tracks.map((track) => {
        const pos = layout.get(track.mastery_id);
        if (!pos) return null;
        const cat = categories.find((c) => c.id === track.category);
        return <line key={`t-line-${track.mastery_id}`} x1={pos.categoryNodeX} y1={pos.categoryNodeY} x2={pos.x} y2={pos.y} stroke={cat?.color ?? '#666'} strokeWidth={1} strokeOpacity={0.5} />;
      })}
      {/* category nodes (larger, more solid) */}
      {categories.map((cat) => {
        const catAngle = (categories.indexOf(cat) / categories.length) * Math.PI * 2 - Math.PI / 2;
        const catX = cx + orbitR * Math.cos(catAngle);
        const catY = cy + orbitR * Math.sin(catAngle);
        const Icon = cat.icon;
        return (
          <g key={`cat-${cat.id}`}>
            <circle cx={catX} cy={catY} r={22} fill="#0b0d10" stroke={cat.color} strokeWidth={3} />
            <foreignObject x={catX - 10} y={catY - 10} width={20} height={20}>
              <Icon size={20} color={cat.color} />
            </foreignObject>
            <text x={catX} y={catY + 38} textAnchor="middle" className="fill-text-primary" fontSize={10} fontWeight={900} style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{cat.label}</text>
          </g>
        );
      })}
      {/* track nodes (satellites) */}
      {tracks.map((track) => {
        const pos = layout.get(track.mastery_id);
        const cat = categories.find((c) => c.id === track.category);
        if (!pos || !cat) return null;
        return <ConstellationNode key={track.mastery_id} track={track} x={pos.x} y={pos.y} color={cat.color} />;
      })}
    </svg>
  );
};

export const MasteryScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MasteryTab>('overview');
  const [serverTracks, setServerTracks] = useState<MasterySummaryRow[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const skills = useSkillStore();
  const boss = useBossStore();

  useEffect(() => {
    let cancelled = false;
    getMyMasterySummary()
      .then((rows) => {
        if (cancelled) return;
        setServerTracks(rows.map(normalizeTrack));
        setLoadState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState('offline');
      });
    return () => { cancelled = true; };
  }, []);

  const spentSkillPoints = typeof skills.getTotalSpent === 'function' ? toNumber(skills.getTotalSpent()) : 0;
  const playerLevel = Math.max(1, toNumber(player.level));
  const inventoryCount = safeArray(inventory.items).length;
  const defeatedBossCount = safeArray(boss.defeatedBossIds).length;
  const availableSkillPoints = Math.max(0, playerLevel - 1 - spentSkillPoints);
  const localScore = playerLevel * 100 + inventoryCount * 5 + defeatedBossCount * 50 + spentSkillPoints * 25;

  const mergedTracks = new Map<string, MasterySummaryRow>();
  staticTracks.forEach((track) => mergedTracks.set(track.mastery_id, track));
  serverTracks.forEach((track) => {
    const normalized = normalizeTrack(track);
    mergedTracks.set(normalized.mastery_id, normalized);
  });
  const tracks = Array.from(mergedTracks.values());

  const masteryScore = tracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0) || localScore;
  const rankedTracks = [...tracks].filter((track) => toNumber(track.rank) > 0).sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  const bestRank = rankedTracks[0]?.rank;
  const highestTrack = [...tracks].sort((a, b) => toNumber(b.mastery_xp) - toNumber(a.mastery_xp))[0];
  const novaCount = tracks.filter((t) => tierFromXp(toNumber(t.mastery_xp)) === 3).length;
  const pulsarCount = tracks.filter((t) => tierFromXp(toNumber(t.mastery_xp)) === 2).length;
  const activeCount = tracks.filter((t) => tierFromXp(toNumber(t.mastery_xp)) === 1).length;

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="space-y-3 p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="bl-title text-3xl leading-none text-text-primary">Mastery Constellation</div>
            <div className="text-xs text-text-muted mt-1">Skill trees, action mastery, ranks, and build identity.</div>
          </div>
          <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
            <Trophy size={22} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RankTile label="Score" value={masteryScore.toLocaleString()} sub={loadState === 'ready' ? 'server tracked' : 'local/session'} />
          <RankTile label="Best Rank" value={bestRank ? `#${toNumber(bestRank).toLocaleString()}` : '—'} sub={highestTrack?.label ?? 'no track yet'} />
          <RankTile label="Skill Pts" value={availableSkillPoints} sub={`${spentSkillPoints} spent`} />
        </div>

        <div className="bl-tab-strip grid grid-cols-2 gap-1.5 p-1.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-black ${activeTab === 'overview' ? 'bl-primary' : 'bl-secondary text-text-muted'}`}
          >
            <Trophy size={14} /> Constellation
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-black ${activeTab === 'skills' ? 'bl-primary' : 'bl-secondary text-text-muted'}`}
          >
            <Zap size={14} /> Skill Trees
          </button>
        </div>
      </div>

      {activeTab === 'skills' ? (
        <SkillTreeScreen />
      ) : (
        <div className="space-y-4 px-4">
          {loadState === 'offline' && (
            <div className="bl-card p-3 text-xs text-amber">
              Server mastery data is not available in this environment. Local/session progress is shown until migrations are applied.
            </div>
          )}

          {/* The constellation: replaces the previous "Ranked Tracks" list. */}
          <div className="bl-card p-2">
            <ConstellationMap tracks={tracks} categories={masteryCategories} />
          </div>

          {/* Ascension summary — quick read of how many tracks are at each tier. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bl-card p-2 text-center">
              <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">Active</div>
              <div className="text-xl font-black text-amber">{activeCount}</div>
            </div>
            <div className="bl-card p-2 text-center" style={{ borderColor: '#7CFC00' }}>
              <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">Pulsar</div>
              <div className="text-xl font-black" style={{ color: '#7CFC00' }}>{pulsarCount}</div>
            </div>
            <div className="bl-card p-2 text-center" style={{ borderColor: '#A855F7' }}>
              <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">Nova</div>
              <div className="text-xl font-black" style={{ color: '#A855F7' }}>{novaCount}</div>
            </div>
          </div>

          {/* Category breakdown — replaces the previous 2x3 tiered card grid. */}
          <div className="bl-card space-y-1 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-text-primary">Category Map</div>
            {masteryCategories.map((category) => {
              const Icon = category.icon;
              const categoryTracks = tracks.filter((track) => track.category === category.id);
              const totalXp = categoryTracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0);
              return (
                <div key={category.id} className="flex items-center gap-2 border-l-4 pl-2 py-1" style={{ borderLeftColor: category.color }}>
                  <Icon size={14} style={{ color: category.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-black uppercase text-text-primary">{category.label}</div>
                    <div className="truncate text-[9px] text-text-muted">{categoryTracks.length} tracks</div>
                  </div>
                  <div className="text-[10px] font-black text-amber">{totalXp.toLocaleString()} XP</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
