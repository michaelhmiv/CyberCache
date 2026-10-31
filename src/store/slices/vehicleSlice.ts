import { create } from 'zustand';
import type { Vehicle } from '@/types/items';
import type { ChefVehicleStatus } from '@/lib/chef/chefClient';

/**
 * Vehicles (0021) — client display state for the garage.
 *
 * Vehicles are NOT GearItem: they never enter the inventory store
 * (combat/gear engines read GearItem and must never price a vehicle
 * as a relic). Server item rows with kind 'vehicle' route here from
 * the sync paths (verifiedStateSync / runtimeStateService), and the
 * equipped id rides the loadout's 'vehicle' slot. Condition lives on
 * the item row server-side; the adapter carries it onto the display
 * object.
 */
export interface VehicleDisplay extends Vehicle {
  conditionCurrent: number;
  conditionMax: number;
}

export interface VehicleState {
  vehicles: VehicleDisplay[];
  /** The most recent claim/settlement's vehicle block (roaming status line). */
  lastClaimStatus: ChefVehicleStatus | null;
  setVehicles: (vehicles: VehicleDisplay[]) => void;
  upsertVehicle: (vehicle: VehicleDisplay) => void;
  removeVehicle: (id: string) => void;
  setLastClaimStatus: (status: ChefVehicleStatus | null) => void;
  getById: (id: string | null | undefined) => VehicleDisplay | undefined;
}

export const useVehicleStore = create<VehicleState>()((set, get) => ({
  vehicles: [],
  lastClaimStatus: null,

  setVehicles: (vehicles) => set({ vehicles }),
  upsertVehicle: (vehicle) =>
    set((state) => {
      const index = state.vehicles.findIndex((v) => v.id === vehicle.id);
      if (index === -1) return { vehicles: [vehicle, ...state.vehicles] };
      const next = [...state.vehicles];
      next[index] = vehicle;
      return { vehicles: next };
    }),
  removeVehicle: (id) => set((state) => ({ vehicles: state.vehicles.filter((v) => v.id !== id) })),
  setLastClaimStatus: (status) => set({ lastClaimStatus: status }),
  getById: (id) => (id ? get().vehicles.find((v) => v.id === id) : undefined),
}));
