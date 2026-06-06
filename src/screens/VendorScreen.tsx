import React from 'react';
import { ShoppingBag, Zap, Shield, Crosshair, FlaskConical, Star, ScanLine, ShieldCheck } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { CONSUMABLES } from '@/constants/consumables';
import { MobileCard } from '@/components/layout/MobileCard';

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();

  const handleBuy = (type: string, price: number) => {
    if (player.credits < price) return;
    player.removeCredits(price);
    player.addConsumable(type, 1);
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Consumable Vendor</div>
      <div className="text-xs text-text-muted">Stock up before boss encounters.</div>

      <div className="space-y-2">
        {Object.values(CONSUMABLES).map((c) => (
          <MobileCard key={c.id} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-surface-raised border border-border flex items-center justify-center">
                {c.category === 'survival' ? <Shield size={18} className="text-green" /> : c.category === 'offense' ? <Crosshair size={18} className="text-red" /> : <Star size={18} className="text-amber" />}
              </div>
              <div>
                <div className="text-xs font-bold text-text-primary">{c.name}</div>
                <div className="text-[10px] text-text-muted">{c.effect}</div>
                <div className="text-[10px] text-amber mt-0.5">Owned: {player.consumables?.[c.id] || 0}</div>
              </div>
            </div>
            <button
              onClick={() => handleBuy(c.id, c.basePrice)}
              disabled={player.credits < c.basePrice}
              className="px-3 py-1.5 rounded-lg bg-amber text-bg text-xs font-bold disabled:opacity-40"
            >
              {c.basePrice}cr
            </button>
          </MobileCard>
        ))}
      </div>
    </div>
  );
};
