import { randomUUID } from 'node:crypto';
import type { CostApproval, CostQuote } from '../../types/videoProvider';
export interface CostAuthorizationInput {
  fingerprint: string;
  providerId: string;
  modelId: string;
  currency: string;
  capMinor: number;
  expiresAt?: number;
  unknownCeilingMinor?: number;
}
export function authorizeRequest(input: CostAuthorizationInput): CostApproval {
  if (
    !input.fingerprint ||
    !input.providerId ||
    !input.modelId ||
    !/^[A-Z]{3}$/.test(input.currency) ||
    !Number.isSafeInteger(input.capMinor) ||
    input.capMinor < 0 ||
    (input.unknownCeilingMinor !== undefined &&
      (!Number.isSafeInteger(input.unknownCeilingMinor) ||
        input.unknownCeilingMinor < 0))
  )
    throw Error('INVALID_COST_APPROVAL');
  const expiresAt = input.expiresAt || Date.now() + 3600000;
  if (expiresAt <= Date.now()) throw Error('APPROVAL_EXPIRED');
  return { ...input, id: randomUUID(), expiresAt };
}
export function validateCostApproval(
  approval: CostApproval,
  input: { fingerprint: string; providerId: string; modelId: string },
  quote: CostQuote,
): number {
  if (
    !approval.id ||
    !Number.isSafeInteger(approval.capMinor) ||
    approval.capMinor < 0 ||
    !Number.isFinite(approval.expiresAt) ||
    !/^[A-Z]{3}$/.test(approval.currency)
  )
    throw Error('INVALID_COST_APPROVAL');
  if (approval.expiresAt <= Date.now()) throw Error('APPROVAL_EXPIRED');
  if (
    approval.fingerprint !== input.fingerprint ||
    approval.providerId !== input.providerId ||
    approval.modelId !== input.modelId
  )
    throw Error('APPROVAL_MISMATCH');
  if (approval.currency !== quote.currency) throw Error('CURRENCY_MISMATCH');
  const amount =
    quote.confidence === 'unknown'
      ? approval.unknownCeilingMinor
      : quote.maxMinor;
  if (amount === undefined) throw Error('COST_CEILING_REQUIRED');
  if (!Number.isSafeInteger(amount) || amount < 0) throw Error('INVALID_COST');
  return amount;
}
