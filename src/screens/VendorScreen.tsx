import React from 'react';
import { Shield, Crosshair, Star } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { CONSUMABLES } from '@/constants/consumables';
import { MobileCard } from '@/components/layout/MobileCard';

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();

  // Only show vendor-appropriate items (not workshop-crafted ammo/consumables)
  const VENDOR_IDS = [
    'MedKit', 'Grenade', 'AmmoPack', 'ShieldCell',
    'ElementalCoating', 'LuckBooster', 'BossScanner', 'InsuranceToken',
  ];
  const vendorItems = Object.values(CONSUMABLES).filter((c) => VENDOR_IDS.includes(c.id));

  const handleBuy = (type: string, price: number) => {
    if (player.credits < price) return;
    player.removeCredits(price);
    player.addConsumable(type, 1);
  };

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="bl-title text-3xl leading-none text-text-primary">Consumable Vendor</div>
      <div className="text-xs text-text-muted">Stock up before boss encounters. Crafted ammo and advanced consumables are made in the Workshop.</div>

      <div className="space-y-2">
        {vendorItems.map((c) => (
          <MobileCard key={c.id} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bl-well w-10 h-10 flex items-center justify-center shrink-0">
                {c.category === 'survival' ? <Shield size={18} className="text-green" /> : c.category === 'offense' ? <Crosshair size={18} className="text-red" /> : <Star size={18} className="text-amber" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text-primary truncate">{c.name}</div>
                <div className="text-[10px] text-text-muted">{c.effect}</div>
                <div className="text-[10px] text-amber mt-0.5">Owned: {player.consumables?.[c.id] || 0}</div>
              </div>
            </div>
            <button
              onClick={() => handleBuy(c.id, c.basePrice)}
              disabled={player.credits < c.basePrice}
              className="px-3 py-1.5 rounded-xl bl-primary text-xs font-bold disabled:opacity-40"
            >
              {c.basePrice}cr
            </button>
          </MobileCard>
        ))}
      </div>
    </div>
  );
};
