import React, { useEffect, useState } from 'react';
import { BarChart3, Crosshair, Hammer, Map, Shield, Swords, Trophy, Zap } from 'lucide-react';
import { SkillTreeScreen } from './SkillTreeScreen';
import { useBossStore, useInventoryStore, usePlayerStore, useSkillStore } from '@/store';
import { getMyMasterySummary, type MasterySummaryRow } from '@/lib/supabase/masteryService';

type MasteryTab = 'overview' | 'skills';
type CategoryId = 'combat' | 'weapons' | 'inventory' | 'locations' | 'economy' | 'services';

const masteryCategories: { id: CategoryId; label: string; desc: string; icon: React.ElementType; color: string }[] = [
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

const TrackRow: React.FC<{ track: MasterySummaryRow }> = ({ track }) => {
  const xp = toNumber(track.mastery_xp);
  const rank = toNumber(track.rank);
  const rankText = rank > 0 ? `#${rank.toLocaleString()}` : 'Unranked';
  return (
    <div className="bl-card p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs font-bold text-text-primary">{track.label}</div>
        <div className="text-[10px] font-black text-amber">{rankText}</div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
        <span>Lv. {Math.max(1, toNumber(track.mastery_level))}</span>
        <span>{xp.toLocaleString()} XP</span>
      </div>
    </div>
  );
};

// Constellation visualization: 6 categories arranged on a circular orbit with
// their tracks as satellite dots. Each category's node size scales with its
// total XP so the strongest category visually dominates.
const ConstellationMap: React.FC<{
  tracks: MasterySummaryRow[];
  categories: typeof masteryCategories;
}> = ({ tracks, categories }) => {
  const size = 320;
  const center = size / 2;
  const orbitRadius = size * 0.36;
  const categoryData = categories.map((cat) => {
    const categoryTracks = tracks.filter((t) => t.category === cat.id);
    const totalXp = categoryTracks.reduce((s, t) => s + toNumber(t.mastery_xp), 0);
    return { cat, categoryTracks, totalXp };
  });
  const maxXp = Math.max(1, ...categoryData.map((c) => c.totalXp));

  return (
    <div className="bl-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Constellation</div>
        <div className="text-[9px] uppercase tracking-widest text-text-muted">size = XP</div>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full" style={{ maxHeight: 360 }}>
        <defs>
          <radialGradient id="orbit-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF9000" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#FF9000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={center} cy={center} r={orbitRadius} fill="url(#orbit-fill)" stroke="#FF900033" strokeDasharray="4 4" />
        {categoryData.map(({ cat, categoryTracks, totalXp }, i) => {
          const angle = (i / categoryData.length) * Math.PI * 2 - Math.PI / 2;
          const cx = center + Math.cos(angle) * orbitRadius;
          const cy = center + Math.sin(angle) * orbitRadius;
          const r = 8 + (totalXp / maxXp) * 16;
          return (
            <g key={cat.id}>
              <circle cx={cx} cy={cy} r={r} fill={cat.color} fillOpacity="0.18" stroke={cat.color} strokeWidth="2" />
              <text x={cx} y={cy + 4} textAnchor="middle" className="fill-text-primary" style={{ fontSize: 9, fontWeight: 900 }}>
                {cat.label.slice(0, 4).toUpperCase()}
              </text>
              {categoryTracks.slice(0, 4).map((track, ti) => {
                const ta = angle + (ti - 1.5) * 0.4;
                const tr = orbitRadius + (ti - 1.5) * 18;
                const tx = center + Math.cos(ta) * tr;
                const ty = center + Math.sin(ta) * tr;
                return <circle key={track.mastery_id} cx={tx} cy={ty} r={2.5} fill={cat.color} fillOpacity={Math.min(1, 0.4 + toNumber(track.mastery_xp) / 1000)} />;
              })}
            </g>
          );
        })}
        <text x={center} y={center - 4} textAnchor="middle" className="fill-amber" style={{ fontSize: 10, fontWeight: 900 }}>CYBER</text>
        <text x={center} y={center + 10} textAnchor="middle" className="fill-amber" style={{ fontSize: 10, fontWeight: 900 }}>CACHE</text>
      </svg>
    </div>
  );
};

const ASCENSION_TIERS = [
  { min: 0, label: 'Dormant', tone: '#6B7280' },
  { min: 1, label: 'Active', tone: '#7CFC00' },
  { min: 100, label: 'Pulsar', tone: '#5AA7FF' },
  { min: 1000, label: 'Nova', tone: '#FF9000' },
] as const;

const ascensionTier = (xp: number) => {
  let tier = ASCENSION_TIERS[0];
  for (const t of ASCENSION_TIERS) {
    if (xp >= t.min) tier = t;
  }
  return tier;
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
  const categoryData = masteryCategories.map((cat) => {
    const categoryTracks = tracks.filter((track) => track.category === cat.id);
    const totalXp = categoryTracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0);
    const highestLevel = Math.max(1, ...categoryTracks.map((track) => toNumber(track.mastery_level)));
    return { cat, categoryTracks, totalXp, highestLevel };
  });

  const masteryScore = tracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0) || localScore;
  const rankedTracks = [...tracks].filter((track) => toNumber(track.rank) > 0).sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  const bestRank = rankedTracks[0]?.rank;
  const highestTrack = [...tracks].sort((a, b) => toNumber(b.mastery_xp) - toNumber(a.mastery_xp))[0];

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="space-y-3 p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="bl-title text-3xl leading-none text-text-primary">Mastery Board</div>
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
            <Trophy size={14} /> Overview
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

          <ConstellationMap tracks={tracks} categories={masteryCategories} />

          <div className="grid grid-cols-3 gap-2">
            {categoryData.map(({ cat, totalXp, highestLevel }) => {
              const Icon = cat.icon;
              const tier = ascensionTier(totalXp);
              return (
                <div key={cat.id} className="bl-card p-2" style={{ borderLeftColor: cat.color, borderLeftWidth: 4 }}>
                  <div className="flex items-center gap-1.5">
                    <div className="bl-icon-plate flex h-7 w-7 shrink-0 items-center justify-center" style={{ backgroundColor: `${cat.color}18` }}>
                      <Icon size={12} style={{ color: cat.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-black uppercase tracking-wide text-text-primary">{cat.label}</div>
                      <div className="text-[8px] text-text-muted">Lv. {highestLevel}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tier.tone }} />
                    <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: tier.tone }}>{tier.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bl-card space-y-2 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-text-primary">Top Tracks</div>
            <div className="space-y-2">
              {[...tracks]
                .sort((a, b) => toNumber(b.mastery_xp) - toNumber(a.mastery_xp))
                .slice(0, 5)
                .map((track) => <TrackRow key={track.mastery_id} track={track} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
