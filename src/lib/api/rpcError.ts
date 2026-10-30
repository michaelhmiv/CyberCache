export type RpcErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

export function formatRpcError(error: unknown): string {
  if (typeof error === 'string') return error;
  const e = error as RpcErrorLike;
  if (e?.message) return e.message;
  if (e?.details) return e.details;
  return 'Unable to update loadout.';
}
