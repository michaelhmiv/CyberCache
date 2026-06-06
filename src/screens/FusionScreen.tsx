import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useInventoryStore, usePlayerStore } from '@/store';
import { WeaponCard } from '@/components/common/WeaponCard';
import { MobileCard } from '@/components/layout/MobileCard';

export const FusionScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const [baseItem, setBaseItem] = useState<string | null>(null);
  const [materials, setMaterials] = useState<string[]>([]);

  const weapons = inventory.getWeapons();
  const base = baseItem ? weapons.find((w) => w.id === baseItem) : undefined;

  const toggleMaterial = (id: string) => {
    setMaterials((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const canFuse = base && materials.length >= 2;
  const fuseCost = base ? base.level * 50 + materials.length * 100 : 0;

  const handleFuse = () => {
    if (!canFuse || !base || player.scrap < fuseCost) return;
    player.removeScrap(fuseCost);
    // Remove materials
    materials.forEach((id) => inventory.removeItem(id));
    // Improve roll quality
    const qualityGain = Math.min(100 - base.rollQuality, materials.length * 3 + Math.floor(Math.random() * 5));
    const updated = { ...base, rollQuality: Math.min(100, base.rollQuality + qualityGain) };
    // In real implementation we'd update the item in place; for MVP just remove old and add improved
    inventory.removeItem(base.id);
    inventory.addItem(updated as any);
    setBaseItem(null);
    setMaterials([]);
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Fusion Lab</div>
      <div className="text-xs text-text-muted">Combine duplicate or similar caches to improve roll quality.</div>

      {/* Base Selection */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-text-muted uppercase">Select Base Cache</div>
        {base ? (
          <WeaponCard weapon={base} onClick={() => setBaseItem(null)} />
        ) : (
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {weapons.slice(0, 20).map((w) => (
              <div key={w.id} onClick={() => setBaseItem(w.id)} className="cursor-pointer">
                <WeaponCard weapon={w} showDetails={false} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Materials */}
      {base && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Select Materials (2+)</div>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {weapons
              .filter((w) => w.id !== base.id && w.weaponType === base.weaponType)
              .map((w) => (
                <div
                  key={w.id}
                  onClick={() => toggleMaterial(w.id)}
                  className={`cursor-pointer rounded-lg border ${
                    materials.includes(w.id) ? 'border-amber bg-amber/10' : 'border-border'
                  }`}
                >
                  <WeaponCard weapon={w} showDetails={false} />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {base && materials.length > 0 && (
        <MobileCard className="space-y-1">
          <div className="text-xs font-bold text-amber">Fusion Preview</div>
          <div className="text-xs text-text-secondary">Roll Quality: {base.rollQuality} → {Math.min(100, base.rollQuality + materials.length * 3 + 5)}</div>
          <div className="text-xs text-text-secondary">Cost: {fuseCost} scrap</div>
          <div className="text-xs text-text-muted">{materials.length} materials selected</div>
        </MobileCard>
      )}

      <button
        onClick={handleFuse}
        disabled={!canFuse || player.scrap < fuseCost}
        className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-40"
      >
        FUSE
      </button>
    </div>
  );
};
