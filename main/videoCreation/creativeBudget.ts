import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import type { CostApproval } from '../../types/videoProvider';

interface CreativeAuthorization {
  projectId: string;
  episodeId: string;
  providerId: string;
  approval: CostApproval;
  maxRequests: number;
  requests: number;
}

const queues = new Map<string, Promise<unknown>>();

export function createCreativeBudgetStore(root: string) {
  const file = path.join(root, 'creative-authorizations.json');
  const keyOf = (projectId: string, episodeId: string, providerId: string) =>
    JSON.stringify([projectId, episodeId, providerId]);
  async function read(): Promise<Record<string, CreativeAuthorization>> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('INVALID_CREATIVE_BUDGET');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async function write<T>(
    fn: (data: Record<string, CreativeAuthorization>) => T,
  ) {
    const previous = queues.get(file) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const data = await read();
        const result = fn(data);
        await fs.mkdir(root, { recursive: true });
        await atomicReplaceTextFile(file, JSON.stringify(data));
        return structuredClone(result);
      });
    queues.set(file, operation);
    try {
      return await operation;
    } finally {
      if (queues.get(file) === operation) queues.delete(file);
    }
  }
  return {
    async usage(projectId: string, episodeId: string, providerId: string) {
      const record = (await read())[keyOf(projectId, episodeId, providerId)];
      if (!record) return null;
      return {
        requests: record.requests,
        maxRequests: record.maxRequests,
        capMinor: record.approval.capMinor,
        currency: record.approval.currency,
        expiresAt: record.approval.expiresAt,
      };
    },
    async authorize(input: {
      projectId: string;
      episodeId: string;
      providerId: string;
      currency: string;
      capMinor: number;
      maxRequests: number;
      newSession?: boolean;
    }) {
      if (
        !/^[A-Z]{3}$/.test(input.currency) ||
        !Number.isSafeInteger(input.capMinor) ||
        input.capMinor < input.maxRequests ||
        !Number.isSafeInteger(input.maxRequests) ||
        input.maxRequests < 1 ||
        input.maxRequests > 12
      )
        throw new Error('INVALID_CREATIVE_BUDGET');
      const key = keyOf(input.projectId, input.episodeId, input.providerId);
      return write((data) => {
        const previous = data[key];
        if (previous && !input.newSession) {
          if (previous.approval.expiresAt <= Date.now())
            throw new Error('CREATIVE_BUDGET_EXPIRED');
          if (
            previous.approval.currency !== input.currency ||
            previous.approval.capMinor !== input.capMinor ||
            previous.maxRequests !== input.maxRequests
          )
            throw new Error('CREATIVE_BUDGET_CHANGE_REQUIRES_NEW_SESSION');
          return previous;
        }
        const approval: CostApproval = {
          id: randomUUID(),
          fingerprint: randomUUID(),
          providerId: input.providerId,
          modelId: input.providerId,
          currency: input.currency,
          capMinor: input.capMinor,
          unknownCeilingMinor: Math.floor(input.capMinor / input.maxRequests),
          expiresAt: Date.now() + 3600000,
        };
        const next: CreativeAuthorization = {
          projectId: input.projectId,
          episodeId: input.episodeId,
          providerId: input.providerId,
          approval,
          maxRequests: input.maxRequests,
          requests: 0,
        };
        data[key] = next;
        return next;
      });
    },
    async nextRequest(
      projectId: string,
      episodeId: string,
      providerId: string,
    ) {
      const key = keyOf(projectId, episodeId, providerId);
      return write((data) => {
        const record = data[key];
        if (!record) throw new Error('COST_AUTHORIZATION_REQUIRED');
        if (record.approval.expiresAt <= Date.now())
          throw new Error('CREATIVE_BUDGET_EXPIRED');
        if (record.requests >= record.maxRequests)
          throw new Error('LLM_REQUEST_LIMIT');
        record.requests += 1;
        return { approval: record.approval, number: record.requests };
      });
    },
  };
}
