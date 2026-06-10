/**
 * Chef API Routes
 *
 * Mounted at /api/* — the authoritative gameplay endpoints.
 * These are NOT called by the browser directly. They're called
 * by the Express server's internal router, which proxies claims
 * from the client's Supabase RPC calls through the Chef.
 *
 * Actually — the Chef runs IN the Express process. The client
 * still calls Supabase RPCs, but the RPCs can delegate to the
 * Chef for item generation. Or, the client calls /api/claim
 * directly instead of the Supabase RPC.
 *
 * Current design: the Chef is the authoritative processor.
 * The client calls /api/claim, the Chef does all the work,
 * writes results to Supabase, and returns the canonical state.
 */

import { Express, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processRoamingClaim, type ClaimRequest } from '../chef';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const key = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) {
      throw new Error('[chef] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

/**
 * POST /api/claim
 *
 * Process a roaming tick claim. The Chef:
 *   1. Validates the request
 *   2. Processes all ticks (probabilities, item generation, rewards)
 *   3. Writes results to Supabase via RPC
 *   4. Returns the canonical result to the client
 */
async function handleClaim(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ClaimRequest & { jwt?: string };

    // Validate
    if (!body.playerId || !body.areaId || !body.ticks || body.tickCount == null) {
      res.status(400).json({ error: 'Missing required fields: playerId, areaId, ticks, tickCount' });
      return;
    }

    const supabase = getSupabase();

    // If JWT provided, set auth context for RLS
    if (body.jwt) {
      await supabase.auth.setSession({
        access_token: body.jwt,
        refresh_token: '',
      });
    }

    // 1. Validate tick_count — replay protection
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('last_claimed_tick')
      .eq('id', body.playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read profile', detail: profileError.message });
      return;
    }

    if (profile && body.tickCount <= profile.last_claimed_tick) {
      res.status(409).json({
        error: 'tick_count already claimed',
        lastClaimedTick: profile.last_claimed_tick,
      });
      return;
    }

    // 2. Process the claim with the Chef
    const result = processRoamingClaim(body, supabase);

    // 3. Persist to Supabase
    //    Call the Chef-specific RPC that stores pre-computed values
    //    without re-rolling probabilities.

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'cc_apply_chef_rewards',
      {
        _player_id: body.playerId,
        _credits: result.rewards.creditsAwarded,
        _scrap: result.rewards.scrapAwarded,
        _xp: result.rewards.xpAwarded,
        _fragments: result.rewards.cacheFragmentsAwarded,
        _materials: result.rewards.materials,
        _essences: result.rewards.essences,
        _kills: result.rewards.killsRecorded,
        _tick_count: body.tickCount,
        _area_id: body.areaId,
      }
    );

    if (rpcError) {
      res.status(500).json({ error: 'Failed to apply rewards', detail: rpcError.message });
      return;
    }

    // 4. Store generated items via RPC (service_role only)
    if (result.items.length > 0) {
      const { error: storeError } = await supabase.rpc(
        'cc_store_chef_items',
        {
          _player_id: body.playerId,
          _items: result.items,
        }
      );

      if (storeError) {
        console.error('[chef] Failed to store items:', storeError.message);
        // Non-fatal — profile rewards already applied
      }
    }

    // 5. Return the complete canonical result
    res.json({
      ...result,
      profile: rpcResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] claim error:', message);
    res.status(500).json({ error: 'Chef processing failed', detail: message });
  }
}

async function handleVerifyBoss(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as {
      playerId: string;
      bossId: string;
      damageDealt: number;
      damageTaken: number;
      medkitsConsumed: number;
      fightDurationMs: number;
      loadoutDps: number;
      victory: boolean;
      jwt?: string;
    };

    if (!body.playerId || !body.bossId) {
      res.status(400).json({ error: 'Missing required fields: playerId, bossId' });
      return;
    }

    const supabase = getSupabase();
    if (body.jwt) {
      await supabase.auth.setSession({
        access_token: body.jwt,
        refresh_token: '',
      });
    }

    // Read boss definition from constants (imported at file scope)
    const { REGION_1_BOSSES } = await import('../../constants/bosses');
    const boss = REGION_1_BOSSES.find((b) => b.id === body.bossId);
    if (!boss) {
      res.status(400).json({ error: 'Unknown boss', bossId: body.bossId });
      return;
    }

    // Plausibility checks
    const seconds = body.fightDurationMs / 1000;
    const maxPossibleDamage = body.loadoutDps * seconds * 1.2; // 20% tolerance
    const reasons: string[] = [];

    if (body.damageDealt > maxPossibleDamage) {
      reasons.push(`Damage ${body.damageDealt} exceeds max possible ${Math.round(maxPossibleDamage)}`);
    }

    if (body.victory && body.damageDealt < boss.health) {
      reasons.push(`Victory claimed but damage ${body.damageDealt} < boss health ${boss.health}`);
    }

    // Medkit check: at `autoEatThreshold` (default 0.3), medkits fire.
    // Boss DPS * seconds gives max damage possible with 0 medkits consumed.
    // If no medkits consumed but player survived > HP threshold, it's plausible.
    if (body.medkitsConsumed === 0 && seconds > 10 && boss.dps * seconds > 1000) {
      // Boss would have killed in 10+ seconds at its DPS — medkits should have fired
      // This is a soft check; we don't reject on this alone
    }

    if (reasons.length > 0) {
      // Increment pity on rejection (counts as a failed attempt)
      await supabase.rpc('cc_increment_pity', {
        _player_id: body.playerId,
        _boss_id: body.bossId,
      });

      res.status(422).json({
        verified: false,
        victory: false,
        reason: reasons.join('; '),
        pityIncremented: true,
      });
      return;
    }

    // Plausible — record the result
    if (body.victory) {
      await supabase.rpc('cc_record_boss_victory', {
        _player_id: body.playerId,
        _boss_id: body.bossId,
        _damage_dealt: Math.round(body.damageDealt),
        _medkits_consumed: body.medkitsConsumed,
        _duration_ms: body.fightDurationMs,
      });

      res.json({
        verified: true,
        victory: true,
        pityIncremented: false,
      });
    } else {
      await supabase.rpc('cc_increment_pity', {
        _player_id: body.playerId,
        _boss_id: body.bossId,
      });

      res.json({
        verified: true,
        victory: false,
        pityIncremented: true,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] boss verify error:', message);
    res.status(500).json({ error: 'Boss verification failed', detail: message });
  }
}

async function handleSalvage(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { playerId: string; itemId: string; jwt?: string };
    if (!body.playerId || !body.itemId) {
      res.status(400).json({ error: 'Missing playerId or itemId' });
      return;
    }

    const supabase = getSupabase();
    if (body.jwt) {
      await supabase.auth.setSession({ access_token: body.jwt, refresh_token: '' });
    }

    // Read the item from the player's inventory
    const { data: item, error: itemError } = await supabase
      .from('player_items')
      .select('*')
      .eq('id', body.itemId)
      .eq('owner_id', body.playerId)
      .single();

    if (itemError || !item) {
      res.status(404).json({ error: 'Item not found in your inventory' });
      return;
    }

    // Calculate salvage yield
    const { calculateSalvageYield } = await import('../../constants/salvageRules');
    const yield_ = calculateSalvageYield(item);

    // Delete the item
    const { error: deleteError } = await supabase
      .from('player_items')
      .delete()
      .eq('id', body.itemId)
      .eq('owner_id', body.playerId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to remove item', detail: deleteError.message });
      return;
    }

    // Award resources via RPC
    const { error: rpcError } = await supabase.rpc('cc_apply_chef_rewards', {
      _player_id: body.playerId,
      _scrap: yield_.scrapValue,
      _materials: yield_.materials,
      _essences: yield_.essences,
      _credits: 0,
      _xp: 0,
      _fragments: 0,
      _kills: 0,
      _tick_count: 0,
      _area_id: 'salvage',
    });

    if (rpcError) {
      console.error('[chef] salvage reward apply failed:', rpcError.message);
    }

    res.json({
      salvaged: true,
      itemId: body.itemId,
      scrapValue: yield_.scrapValue,
      materials: yield_.materials,
      essences: yield_.essences,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] salvage error:', message);
    res.status(500).json({ error: 'Salvage failed', detail: message });
  }
}

export function mountChefRoutes(app: Express): void {
  app.post('/api/claim', handleClaim);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });

  app.post('/api/verify-boss', handleVerifyBoss);

  app.post('/api/salvage', handleSalvage);

  console.log('[chef] routes mounted: POST /api/claim, GET /api/health, POST /api/verify-boss, POST /api/salvage');
}
