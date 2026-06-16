import React, { useState } from 'react';
import { AlertTriangle, Crosshair, PackagePlus, Radio, Shield, Star } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { VENDOR_CONSUMABLES } from '@/constants/consumables';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/supabase/verifiedOps';

const FAMILY_ICONS = {
  survival: Shield,
  ammo: Crosshair,
  ordnance: PackagePlus,
  tactical: Radio,
  economy: Star,
  corrupted: AlertTriangle,
};

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const handleBuy = async (type: string, price: number, name: string) => {
    if (player.credits < price) {
      setNotice('Not enough credits.');
      return;
    }
    setBuyingId(type);
    setNotice(null);
    try {
      await verifiedOps.vendorBuy(type, 1);
      setNotice(`${name} added to inventory.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Purchase failed.');
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Consumable Vendor</div>
          <div className="text-xs text-text-muted">Buy common boss-prep tools. Advanced ammo and payloads are crafted in the Workshop.</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-text-muted uppercase">Credits</div>
          <div className="text-sm font-black text-amber">{player.credits.toLocaleString()}</div>
        </div>
      </div>

      {notice && <div className="text-xs text-text-secondary">{notice}</div>}

      <div className="space-y-2">
        {VENDOR_CONSUMABLES.map((c) => {
          const Icon = FAMILY_ICONS[c.family];
          const owned = player.getConsumableCount(c.id);
          const buying = buyingId === c.id;
          return (
            <MobileCard key={c.id} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="bl-well w-10 h-10 flex items-center justify-center shrink-0">
                    <Icon size={18} className={c.family === 'corrupted' ? 'text-red' : c.family === 'economy' ? 'text-amber' : c.family === 'survival' ? 'text-green' : 'text-red'} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text-primary truncate">{c.name}</div>
                    <div className="text-[10px] text-amber">{c.tacticalRole}</div>
                    <div className="text-[10px] text-text-muted">{c.shortDescription}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-text-muted">Owned</div>
                  <div className="text-sm font-black text-text-primary">{owned}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {c.allowedSlots.map((slot) => (
                  <span key={slot} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted">{slot}</span>
                ))}
                {c.counterTags.map((tag) => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded border border-amber/30 bg-amber/10 text-amber font-bold">{tag}</span>
                ))}
              </div>

              <button
                onClick={() => handleBuy(c.id, c.basePrice, c.name)}
                disabled={player.credits < c.basePrice || Boolean(buyingId)}
                className="w-full py-2 rounded-xl bl-primary text-xs font-black disabled:opacity-40"
              >
                {buying ? 'Buying…' : `Buy 1 • ${c.basePrice.toLocaleString()}cr`}
              </button>
            </MobileCard>
          );
        })}
      </div>
    </div>
  );
};
