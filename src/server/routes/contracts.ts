/**
 * Contracts board routes (contracts slice, migration 0042).
 *
 *   GET  /api/contracts/me      — issue-on-first-read, then the board
 *   POST /api/contracts/claim   — claim one completed contract
 *   POST /api/contracts/reroll  — reroll one open contract
 *
 * The board is a Dashboard card, not a destination: the GET issues
 * both sets lazily (cc_issue_contracts — seeded: the daily board is
 * global per level band, the weekly set is per-player; baselines
 * freeze at issuance), reads the facts, and renders the content
 * module's board view. Claim and reroll are thin doors onto the SQL
 * ops: the claim re-evaluates progress inside its transaction and
 * pays the frozen reward exactly once (the full-set bonus rides the
 * same transaction); the reroll is the skip (1 free per set, then
 * scrap, destroyed).
 *
 * Trust model (the #207 pattern): identity comes from the JWT only.
 * Bodies carry a nonce and an instance id — nothing else is read:
 * there is no field for progress, targets, rewards, band, or period,
 * so there is nothing to forge. Guests see the board and accrue
 * progress; claims refuse server-side until the account is verified
 * (Q6) — the view's canClaim flag is display, the SQL is the gate.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, ContractsFacts, Json } from '../gameplay/store';
import {
  contractBoardView,
  resolveContractLevers,
  type ContractBoardView,
  type ContractLeverValues,
} from '../../content/contracts';
import { REGION_1_BOSSES } from '../../constants/bosses';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type ContractsConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The contracts lever set from the live accessor (defaults when unwired). */
export async function contractsLevers(config: ContractsConfig): Promise<ContractLeverValues> {
  if (!config.economyConfig) return resolveContractLevers();
  const values = await config.economyConfig.snapshot();
  return resolveContractLevers(values);
}

/** The board view from a gameplay-store facts read. */
export function contractsBoardFromFacts(
  facts: ContractsFacts,
  levers: ContractLeverValues,
): ContractBoardView {
  return contractBoardView(
    {
      canClaim: facts.account_type !== 'guest',
      daily: facts.daily,
      weekly: facts.weekly,
    },
    levers,
    new Date(),
    (bossId) => REGION_1_BOSSES.find((b) => b.id === bossId)?.name,
  );
}

const REFUSAL_MARKERS = [
  'Contract not complete',
  'Contract already claimed',
  'Contract already rerolled',
  'Contract was rerolled',
  'Claimed contracts cannot be rerolled',
  'Contract complete — claim it or let it expire',
  'Contract expired',
  'verified account',
  'Insufficient scrap',
  'No replacement contract available',
];

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Profile not found') || message.includes('Contract not found')) {
    res.status(404).json({ error: fallback, detail: message });
    return;
  }
  if (REFUSAL_MARKERS.some((marker) => message.includes(marker))) {
    res.status(409).json({ error: fallback, detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

async function boardResponse(
  store: ChefGameplayStore,
  config: ContractsConfig,
  playerId: string,
): Promise<{ facts: ContractsFacts; board: ContractBoardView } | null> {
  const facts = await store.getContractsFacts(playerId);
  if (!facts) return null;
  return { facts, board: contractsBoardFromFacts(facts, await contractsLevers(config)) };
}

export function createGetContractsHandler(store: ChefGameplayStore, config: ContractsConfig) {
  return async function handleGetContracts(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      // Issue-on-first-read: both sets materialize lazily; an
      // already-issued period is a no-op summary.
      try {
        await store.issueContracts(playerId, 'daily');
        await store.issueContracts(playerId, 'weekly');
      } catch (err) {
        sendStoreError(res, 'Contracts board failed to issue', err);
        return;
      }
      const assembled = await boardResponse(store, config, playerId);
      if (!assembled) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, contracts: assembled.board, profile: null });
    } catch (err) {
      sendRouteError(res, 'Contracts board failed', err);
    }
  };
}

interface ContractOpBody {
  playerId?: string;
  jwt?: string;
  nonce?: string;
  instanceId?: unknown;
}

function opNonce(body: ContractOpBody, playerId: string, label: string): string {
  return typeof body.nonce === 'string' && body.nonce.trim().length >= 8
    ? body.nonce
    : `contracts-${label}:${playerId}:${Date.now()}`;
}

export function createClaimContractHandler(store: ChefGameplayStore, config: ContractsConfig) {
  return async function handleClaimContract(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as ContractOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.instanceId !== 'string' || body.instanceId.length === 0) {
        res.status(400).json({ error: 'A contract instance id is required' });
        return;
      }
      let applied: Json;
      try {
        applied = await store.claimContractReward(
          playerId, opNonce(body, playerId, 'claim'), body.instanceId);
      } catch (err) {
        sendStoreError(res, 'Contract claim failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const assembled = await boardResponse(store, config, playerId);
      res.json({
        verified: true,
        claimed: {
          instanceId: record.instance_id ?? body.instanceId,
          templateId: record.template_id ?? null,
          creditsAwarded: record.credits_awarded ?? 0,
          fragmentsAwarded: record.fragments_awarded ?? 0,
          setBonus: record.set_bonus ?? null,
        },
        contracts: assembled?.board ?? null,
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Contract claim failed', err);
    }
  };
}

export function createRerollContractHandler(store: ChefGameplayStore, config: ContractsConfig) {
  return async function handleRerollContract(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as ContractOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.instanceId !== 'string' || body.instanceId.length === 0) {
        res.status(400).json({ error: 'A contract instance id is required' });
        return;
      }
      let applied: Json;
      try {
        applied = await store.rerollContract(
          playerId, opNonce(body, playerId, 'reroll'), body.instanceId);
      } catch (err) {
        sendStoreError(res, 'Contract reroll failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const assembled = await boardResponse(store, config, playerId);
      res.json({
        verified: true,
        rerolled: {
          instanceId: record.instance_id ?? null,
          replacedInstanceId: record.replaced_instance_id ?? body.instanceId,
          templateId: record.template_id ?? null,
          scrapCharged: record.scrap_charged ?? 0,
          freeReroll: record.free_reroll === true,
        },
        contracts: assembled?.board ?? null,
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Contract reroll failed', err);
    }
  };
}
