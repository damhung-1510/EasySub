import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CostApproval,
  CostQuote,
  Reservation,
  Money,
} from '../../types/videoProvider';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import { validateCostApproval } from './costApproval';
export function createBudgetLedger(root: string) {
  const file = path.join(root, 'ledger.json');
  let tail = Promise.resolve();
  async function read(): Promise<Reservation[]> {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(data)) throw Error('INVALID_LEDGER');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  function write<T>(action: (entries: Reservation[]) => T): Promise<T> {
    const operation = tail.then(async () => {
      const entries = await read();
      const result = action(entries);
      await fs.mkdir(root, { recursive: true });
      await atomicReplaceTextFile(file, JSON.stringify(entries));
      return structuredClone(result);
    });
    tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  return {
    async list(projectId?: string) {
      await tail;
      return (await read()).filter(
        (e) => !projectId || e.projectId === projectId,
      );
    },
    reserve(
      projectId: string,
      approval: CostApproval,
      quote: CostQuote,
      requestId: string,
      input = {
        fingerprint: approval.fingerprint,
        providerId: approval.providerId,
        modelId: approval.modelId,
      },
      category?: Reservation['category'],
    ) {
      return write((entries) => {
        const existing = entries.find((e) => e.requestId === requestId);
        if (existing) throw Error('REQUEST_ALREADY_RESERVED');
        const amount = validateCostApproval(approval, input, quote);
        const spent = entries
          .filter((e) => e.approvalId === approval.id && e.state !== 'released')
          .reduce((sum, e) => sum + (e.actualMinor ?? e.reservedMinor), 0);
        if (spent + amount > approval.capMinor) throw Error('BUDGET_EXCEEDED');
        const reservation: Reservation = {
          id: randomUUID(),
          projectId,
          approvalId: approval.id,
          requestId,
          currency: quote.currency,
          reservedMinor: amount,
          state: 'reserved',
          category,
        };
        entries.push(reservation);
        return reservation;
      });
    },
    settle(id: string, actual?: Money) {
      return write((entries) => {
        const entry = entries.find((e) => e.id === id);
        if (!entry) throw Error('RESERVATION_NOT_FOUND');
        if (entry.state === 'released') throw Error('RESERVATION_RELEASED');
        if (actual) {
          if (actual.currency !== entry.currency)
            throw Error('CURRENCY_MISMATCH');
          if (!Number.isSafeInteger(actual.minor) || actual.minor < 0)
            throw Error('INVALID_COST');
          entry.actualMinor = actual.minor;
          entry.state = 'settled';
        }
        return entry;
      });
    },
    release(id: string, evidence: 'not-submitted' | 'vendor-refund') {
      return write((entries) => {
        if (!['not-submitted', 'vendor-refund'].includes(evidence))
          throw Error('RECONCILIATION_EVIDENCE_REQUIRED');
        const entry = entries.find((e) => e.id === id);
        if (!entry) throw Error('RESERVATION_NOT_FOUND');
        entry.state = 'released';
        return entry;
      });
    },
  };
}
export type BudgetLedger = ReturnType<typeof createBudgetLedger>;
