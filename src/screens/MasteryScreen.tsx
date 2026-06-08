import React, { useEffect, useMemo, useState } from 'react';
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
  <div className="rounded-xl border border-border bg-surface-raised p-3">
    <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    <div className="text-lg font-black text-text-primary">{value}</div>
    <div className="text-[10px] text-text-muted">{sub}</div>
  </div>
);

const TrackRow: React.FC<{ track: MasterySummaryRow }> = ({ track }) => {
  const xp = toNumber(track.mastery_xp);
  const rank = toNumber(track.rank);
  const rankText = rank > 0 ? `#${rank.toLocaleString()}` : 'Unranked';
  return (
    <div className="rounded-lg bg-surface border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-text-primary truncate">{track.label}</div>
        <div className="text-[10px] text-amber font-black">{rankText}</div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-muted mt-1">
        <span>Lv. {Math.max(1, toNumber(track.mastery_level))}</span>
        <span>{xp.toLocaleString()} XP</span>
      </div>
    </div>
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

  const tracks = useMemo(() => {
    const merged = new Map<string, MasterySummaryRow>();
    staticTracks.forEach((track) => merged.set(track.mastery_id, track));
    serverTracks.forEach((track) => {
      const normalized = normalizeTrack(track);
      merged.set(normalized.mastery_id, normalized);
    });
    return Array.from(merged.values());
  }, [serverTracks]);

  const masteryScore = tracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0) || localScore;
  const rankedTracks = [...tracks].filter((track) => toNumber(track.rank) > 0).sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  const bestRank = rankedTracks[0]?.rank;
  const highestTrack = [...tracks].sort((a, b) => toNumber(b.mastery_xp) - toNumber(a.mastery_xp))[0];

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="p-4 pb-0 space-y-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Mastery</div>
          <div className="text-xs text-text-muted mt-1">
            Account-wide progression, skill trees, action mastery, and competitive ranks.
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RankTile label="Score" value={masteryScore.toLocaleString()} sub={loadState === 'ready' ? 'server tracked' : 'local/session'} />
          <RankTile label="Best Rank" value={bestRank ? `#${toNumber(bestRank).toLocaleString()}` : '—'} sub={highestTrack?.label ?? 'no track yet'} />
          <RankTile label="Skill Pts" value={availableSkillPoints} sub={`${spentSkillPoints} spent`} />
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-raised p-1.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`rounded-lg py-2 flex items-center justify-center gap-1 text-xs font-black transition-colors ${activeTab === 'overview' ? 'bg-amber text-bg' : 'text-text-muted'}`}
          >
            <Trophy size={14} /> Overview
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`rounded-lg py-2 flex items-center justify-center gap-1 text-xs font-black transition-colors ${activeTab === 'skills' ? 'bg-amber text-bg' : 'text-text-muted'}`}
          >
            <Zap size={14} /> Skill Trees
          </button>
        </div>
      </div>

      {activeTab === 'skills' ? (
        <SkillTreeScreen />
      ) : (
        <div className="px-4 space-y-4">
          {loadState === 'offline' && (
            <div className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-xs text-amber">
              Server mastery data is not available in this environment. Local/session progress is shown until migrations are applied.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {masteryCategories.map((category) => {
              const Icon = category.icon;
              const categoryTracks = tracks.filter((track) => track.category === category.id);
              const totalXp = categoryTracks.reduce((sum, track) => sum + toNumber(track.mastery_xp), 0);
              const highestLevel = Math.max(1, ...categoryTracks.map((track) => toNumber(track.mastery_level)));
              return (
                <div
                  key={category.id}
                  className="text-left rounded-xl border-2 border-border bg-surface p-3"
                  style={{ borderLeftColor: category.color, borderLeftWidth: 5 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="bl-well w-9 h-9 flex items-center justify-center" style={{ backgroundColor: `${category.color}18` }}>
                      <Icon size={18} style={{ color: category.color }} />
                    </div>
                    <span className="text-[10px] text-amber font-black">Lv. {highestLevel}</span>
                  </div>
                  <div className="text-sm font-black text-text-primary mt-2">{category.label}</div>
                  <div className="text-[10px] text-text-muted leading-snug">{category.desc}</div>
                  <div className="text-[10px] text-text-secondary mt-2">{totalXp.toLocaleString()} XP · {categoryTracks.length} tracks</div>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised p-3 space-y-2">
            <div className="text-xs font-black text-text-primary">Ranked Tracks</div>
            <div className="space-y-2">
              {[...tracks]
                .sort((a, b) => toNumber(b.mastery_xp) - toNumber(a.mastery_xp))
                .slice(0, 8)
                .map((track) => <TrackRow key={track.mastery_id} track={track} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
