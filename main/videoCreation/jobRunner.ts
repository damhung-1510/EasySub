import { isDeepStrictEqual } from 'node:util';
import type { ShotSnapshot } from '../../types/videoProject';
import { validateCostApproval } from './costApproval';
import { randomUUID } from 'node:crypto';
import type {
  ProviderConfig,
  VideoRequest,
  CostApproval,
  VideoAdapter,
  RemoteJob,
  CancelResult,
} from '../../types/videoProvider';
import { ProviderError } from '../../types/videoProvider';
import type { JobStore, StoredVideoJob } from './jobStore';
import type { BudgetLedger } from './budgetLedger';
import { isActiveJob, transitionJob } from './jobState';
export interface ApprovedBatch {
  projectId: string;
  episodeId?: string;
  provider: ProviderConfig;
  approval: CostApproval;
  requests: VideoRequest[];
  shotIds?: string[];
  snapshots?: ShotSnapshot[];
  fingerprint?: string;
}
export interface JobRunnerDeps {
  store: JobStore;
  ledger: BudgetLedger;
  getAdapter: (config: ProviderConfig) => VideoAdapter | Promise<VideoAdapter>;
  downloadDestination: (job: StoredVideoJob) => string;
  resolveReferences?: (
    request: VideoRequest,
    job: StoredVideoJob,
  ) => Promise<VideoRequest>;
  onChanged?: (job: StoredVideoJob) => Promise<void> | void;
  pollIntervalMs?: number;
}
export type ReconcileDecision =
  { remoteJobId: string } | { notSubmitted: true; acknowledged: true };
export function createJobRunner(deps: JobRunnerDeps) {
  const controller = new AbortController();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const polling = new Map<string, Promise<void>>();
  let stopped = false;
  let pumpTail = Promise.resolve();
  const transientCounts = new Map<string, number>();
  const account = (job: StoredVideoJob) =>
    job.provider.accountId ||
    new URL(job.provider.baseUrl).origin + ':' + job.provider.id;
  async function update(
    id: string,
    mutate: (job: StoredVideoJob) => StoredVideoJob,
  ) {
    const result = await deps.store.update(id, mutate);
    await deps.onChanged?.(result);
    return result;
  }
  async function state(
    id: string,
    next: StoredVideoJob['state'],
    extra: Partial<StoredVideoJob> = {},
  ) {
    return update(id, (j) => ({
      ...j,
      ...extra,
      state: transitionJob(j.state, next),
    }));
  }
  function schedule(id: string, retryAfterMs?: number) {
    if (stopped || timers.has(id)) return;
    const attempts = transientCounts.get(id) || 0;
    const delay = Math.max(
      retryAfterMs || 0,
      Math.min(
        60000,
        (deps.pollIntervalMs || 3000) * 2 ** Math.min(attempts, 5),
      ) *
        (0.9 + Math.random() * 0.2),
    );
    const timer = setTimeout(() => {
      timers.delete(id);
      void poll(id).catch(() => {});
    }, delay);
    timer.unref?.();
    timers.set(id, timer);
  }
  async function processRemote(
    job: StoredVideoJob,
    remote: RemoteJob,
    adapter: VideoAdapter,
  ) {
    if (remote.state === 'failed' || remote.state === 'cancelled') {
      await state(job.id, remote.state, { error: remote.error });
      if (job.reservationId && remote.actualCost)
        await deps.ledger.settle(job.reservationId, remote.actualCost);
      void pump().catch(() => {});
      return;
    }
    if (remote.state === 'completed') {
      if (job.state !== 'downloading') job = await state(job.id, 'downloading');
      if (job.localCancelled) {
        if (job.reservationId)
          await deps.ledger.settle(job.reservationId, remote.actualCost);
        await state(job.id, 'review', { localCancelled: true });
        void pump().catch(() => {});
        return;
      }
      try {
        const artifact = await adapter.download(
          remote,
          deps.downloadDestination(job),
          controller.signal,
        );
        if (job.reservationId)
          await deps.ledger.settle(job.reservationId, remote.actualCost);
        await state(job.id, 'review', { artifact, error: undefined });
        void pump().catch(() => {});
      } catch (error) {
        if (stopped) return;
        await update(job.id, (j) => ({
          ...j,
          error: {
            code: 'DOWNLOAD_FAILED',
            message:
              'Result download failed; polling will refresh its download URL',
          },
        }));
        schedule(job.id);
      }
      return;
    }
    await state(job.id, remote.state);
    transientCounts.delete(job.id);
    schedule(job.id, remote.retryAfterMs);
  }
  async function pollImpl(id: string) {
    if (stopped) return;
    const job = await deps.store.get(id);
    if (
      !job.remoteJobId ||
      !['queued', 'running', 'downloading'].includes(job.state)
    )
      return;
    try {
      const adapter = await deps.getAdapter(job.provider);
      const remote = await adapter.poll(job.remoteJobId, controller.signal);
      await processRemote(job, remote, adapter);
    } catch (error) {
      if (stopped) return;
      if (error instanceof ProviderError && error.retryable) {
        transientCounts.set(id, (transientCounts.get(id) || 0) + 1);
        schedule(id, error.retryAfterMs);
        return;
      }
      await update(id, (j) => ({
        ...j,
        error: {
          code: error instanceof ProviderError ? error.code : 'POLL_FAILED',
          message:
            'Provider status could not be read; the remote job ID is preserved',
        },
      }));
    }
  }
  function poll(id: string) {
    const running = polling.get(id);
    if (running) return running;
    const operation = pollImpl(id).finally(() => polling.delete(id));
    polling.set(id, operation);
    return operation;
  }
  function pump(): Promise<void> {
    if (stopped) return Promise.resolve();
    const operation = pumpTail.then(async () => {
      const jobs = await deps.store.list();
      for (const queued of jobs.filter((j) => j.state === 'ready')) {
        if (stopped) return;
        if (queued.approval.expiresAt <= Date.now()) {
          await state(queued.id, 'cancelled', {
            error: {
              code: 'APPROVAL_EXPIRED',
              message: 'Budget approval expired before submission',
            },
          });
          if (queued.reservationId)
            await deps.ledger.release(queued.reservationId, 'not-submitted');
          continue;
        }
        const active = (await deps.store.list()).filter(
          (j) => account(j) === account(queued) && isActiveJob(j.state),
        );
        const accountLimit = Math.min(
          ...jobs
            .filter(
              (j) =>
                account(j) === account(queued) &&
                [
                  'draft',
                  'ready',
                  'submitting',
                  'queued',
                  'running',
                  'downloading',
                  'unknown',
                ].includes(j.state),
            )
            .map((j) => j.provider.concurrency),
        );
        if (active.length >= accountLimit) continue;
        const adapter = await deps.getAdapter(queued.provider);
        let resolved = queued.request;
        try {
          resolved = deps.resolveReferences
            ? await deps.resolveReferences(queued.request, queued)
            : queued.request;
          if (
            resolved.fingerprint !== queued.request.fingerprint ||
            resolved.references.length !== queued.request.references.length ||
            !isDeepStrictEqual(
              {
                ...resolved,
                references: resolved.references.map(
                  ({ dataBase64: _, ...reference }) => reference,
                ),
              },
              queued.request,
            )
          )
            throw new ProviderError(
              'IMMUTABLE_JOB_INPUT',
              'Reference resolution changed the request',
            );
        } catch (error) {
          await state(queued.id, 'cancelled', {
            error: {
              code: 'REFERENCE_LOAD_FAILED',
              message: 'Approved reference bytes could not be loaded',
            },
          });
          if (queued.reservationId)
            await deps.ledger.release(queued.reservationId, 'not-submitted');
          continue;
        }
        await state(queued.id, 'submitting');
        try {
          const remote = await adapter.submit(resolved, controller.signal);
          await state(
            queued.id,
            remote.state === 'completed' ? 'downloading' : remote.state,
            { remoteJobId: remote.id },
          );
          if (remote.state === 'completed') {
            const job = await deps.store.get(queued.id);
            await processRemote(job, remote, adapter);
          } else if (remote.state === 'queued' || remote.state === 'running')
            schedule(queued.id);
          else if (queued.reservationId && remote.actualCost)
            await deps.ledger.settle(queued.reservationId, remote.actualCost);
        } catch (error) {
          const unknown =
            stopped ||
            !(error instanceof ProviderError) ||
            error.outcome === 'unknown';
          await state(queued.id, unknown ? 'unknown' : 'failed', {
            ...(error instanceof ProviderError && error.remoteJobId
              ? { remoteJobId: error.remoteJobId }
              : {}),
            error: {
              code:
                error instanceof ProviderError ? error.code : 'SUBMIT_UNKNOWN',
              message: unknown
                ? 'Submission may have been accepted; reconcile before retrying'
                : error instanceof ProviderError && error.code === 'RATE_LIMIT'
                  ? 'Provider returned HTTP 429: rate limit or quota exhausted'
                  : error instanceof ProviderError &&
                      error.code === 'AUTH_FAILED'
                    ? 'Provider rejected the configured API credentials (HTTP 401/403)'
                    : 'Provider rejected the request',
            },
          });
          if (!unknown && queued.reservationId)
            await deps.ledger.release(queued.reservationId, 'not-submitted');
        }
      }
    });
    pumpTail = operation.catch(() => {});
    return operation;
  }
  return {
    async start(batch: ApprovedBatch) {
      if (stopped) throw Error('RUNNER_STOPPED');
      if (!batch.requests.length) throw Error('EMPTY_BATCH');
      const adapter = await deps.getAdapter(batch.provider);
      const requestIds = new Set<string>();
      const jobs: StoredVideoJob[] = [];
      const reservations: string[] = [];
      const quotes = [];
      for (const request of batch.requests) {
        if (requestIds.has(request.requestId))
          throw Error('DUPLICATE_REQUEST_ID');
        requestIds.add(request.requestId);
        const fingerprint = batch.fingerprint || request.fingerprint;
        if (
          fingerprint !== batch.approval.fingerprint ||
          batch.provider.id !== batch.approval.providerId ||
          batch.provider.modelId !== batch.approval.modelId
        )
          throw Error('APPROVAL_MISMATCH');
        quotes.push(await adapter.quote(request, controller.signal));
      }
      const ceiling = batch.approval.unknownCeilingMinor;
      const perApprovals = quotes.map((quote, index) =>
        quote.confidence === 'unknown' && ceiling !== undefined
          ? {
              ...batch.approval,
              unknownCeilingMinor:
                Math.floor(ceiling / batch.requests.length) +
                (index === batch.requests.length - 1
                  ? ceiling % batch.requests.length
                  : 0),
            }
          : batch.approval,
      );
      const total = quotes.reduce(
        (sum, quote, index) =>
          sum +
          validateCostApproval(
            perApprovals[index],
            {
              fingerprint:
                batch.fingerprint || batch.requests[index].fingerprint,
              providerId: batch.provider.id,
              modelId: batch.provider.modelId,
            },
            quote,
          ),
        0,
      );
      if (total > batch.approval.capMinor) throw Error('BUDGET_EXCEEDED');
      try {
        for (let index = 0; index < batch.requests.length; index++) {
          const request = batch.requests[index];
          const fingerprint = batch.fingerprint || request.fingerprint;
          const reservation = await deps.ledger.reserve(
            batch.projectId,
            perApprovals[index],
            quotes[index],
            request.requestId,
            {
              fingerprint,
              providerId: batch.provider.id,
              modelId: batch.provider.modelId,
            },
            'video',
          );
          reservations.push(reservation.id);
          const now = new Date().toISOString();
          const job: StoredVideoJob = {
            id: randomUUID(),
            projectId: batch.projectId,
            episodeId: batch.episodeId,
            shotId: batch.shotIds?.[index],
            snapshot: batch.snapshots?.[index]
              ? structuredClone(batch.snapshots[index])
              : undefined,
            provider: structuredClone(batch.provider),
            request: structuredClone(request),
            approval: structuredClone(perApprovals[index]),
            state: 'draft',
            reservationId: reservation.id,
            createdAt: now,
            updatedAt: now,
          };
          jobs.push(await deps.store.create(job));
        }
      } catch (error) {
        for (const job of jobs)
          await state(job.id, 'cancelled', {
            error: {
              code: 'BATCH_NOT_STARTED',
              message: 'Batch preparation failed before submission',
            },
          });
        for (const id of reservations)
          await deps.ledger.release(id, 'not-submitted');
        throw error;
      }
      for (const job of jobs) await state(job.id, 'ready');
      await pump();
      return jobs.map((j) => j.id);
    },
    async resume() {
      for (const job of await deps.store.list()) {
        if (job.state === 'draft') {
          await state(job.id, 'cancelled', {
            error: {
              code: 'BATCH_INTERRUPTED',
              message: 'Application stopped before this batch was submitted',
            },
          });
          if (job.reservationId)
            await deps.ledger.release(job.reservationId, 'not-submitted');
        } else if (job.state === 'submitting')
          await state(job.id, 'unknown', {
            error: {
              code: 'SUBMIT_INTERRUPTED',
              message:
                'Application stopped during submission; reconcile before retrying',
            },
          });
        else if (
          job.remoteJobId &&
          ['queued', 'running', 'downloading'].includes(job.state)
        )
          await poll(job.id);
      }
      await pump();
    },
    async pollStatus(id?: string) {
      if (id) await poll(id);
      else for (const job of await deps.store.list()) await poll(job.id);
      return deps.store.list();
    },
    async cancel(id: string): Promise<CancelResult> {
      const job = await deps.store.get(id);
      if (job.state === 'ready') {
        await state(id, 'cancelled', { localCancelled: true });
        if (job.reservationId)
          await deps.ledger.release(job.reservationId, 'not-submitted');
        return { supported: true, cancelled: true };
      }
      if (job.state === 'unknown') throw Error('RECONCILIATION_REQUIRED');
      if (!job.remoteJobId) return { supported: false, cancelled: false };
      await update(id, (j) => ({ ...j, localCancelled: true }));
      const adapter = await deps.getAdapter(job.provider);
      const result = adapter.cancel
        ? await adapter.cancel(job.remoteJobId, controller.signal)
        : { supported: false, cancelled: false };
      if (result.cancelled) await state(id, 'cancelled');
      return result;
    },
    async reconcile(id: string, decision: ReconcileDecision) {
      const job = await deps.store.get(id);
      if (job.state !== 'unknown') throw Error('JOB_NOT_UNKNOWN');
      if ('remoteJobId' in decision) {
        if (!decision.remoteJobId) throw Error('INVALID_REMOTE_ID');
        await state(id, 'queued', {
          remoteJobId: decision.remoteJobId,
          error: undefined,
        });
        await poll(id);
      } else {
        if (!decision.acknowledged)
          throw Error('RECONCILIATION_EVIDENCE_REQUIRED');
        await state(id, 'failed', {
          error: {
            code: 'NOT_SUBMITTED',
            message: 'User confirmed the provider did not accept this request',
          },
        });
        if (job.reservationId)
          await deps.ledger.release(job.reservationId, 'not-submitted');
        await pump();
      }
    },
    async shutdown() {
      stopped = true;
      controller.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await pumpTail;
      await Promise.allSettled([...polling.values()]);
    },
  };
}
export type JobRunner = ReturnType<typeof createJobRunner>;
