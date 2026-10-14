import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createJobRunner } from '../../main/videoCreation/jobRunner';
import { createJobStore } from '../../main/videoCreation/jobStore';
import { createBudgetLedger } from '../../main/videoCreation/budgetLedger';
import {
  ProviderError,
  type VideoAdapter,
  type ProviderConfig,
  type VideoRequest,
} from '../../types/videoProvider';
const config: ProviderConfig = {
  id: 'provider',
  version: 1,
  revisionId: 'revision',
  name: 'video',
  kind: 'video',
  protocol: 'veo-gemini',
  modelId: 'veo-3.1-generate-preview',
  baseUrl: 'https://api.test',
  authMode: 'none',
  timeoutMs: 1000,
  concurrency: 1,
  createdAt: 'today',
  updatedAt: 'today',
};
const request: VideoRequest = {
  requestId: 'one',
  fingerprint: 'fp',
  prompt: 'a person',
  modelId: config.modelId,
  durationMs: 8000,
  aspectRatio: '16:9',
  resolution: '720p',
  references: [],
  audioMode: 'native',
};
const approval = {
  id: 'approval',
  fingerprint: 'fp',
  providerId: 'provider',
  modelId: config.modelId,
  currency: 'USD',
  capMinor: 200,
  expiresAt: Date.now() + 60000,
};
function adapter(overrides: Partial<VideoAdapter>): VideoAdapter {
  return {
    capabilities: () => ({
      text: true,
      image: true,
      references: true,
      maxReferences: 3,
      durationsMs: [8000],
      aspectRatios: ['16:9'],
      resolutions: ['720p'],
      audio: true,
      seed: true,
      cancel: false,
      concurrency: 1,
    }),
    quote: async () => ({
      currency: 'USD',
      maxMinor: 100,
      confidence: 'upperBound',
      capturedAt: 'today',
      components: [],
    }),
    submit: async () => ({ id: 'remote', state: 'queued' }),
    poll: async () => ({ id: 'remote', state: 'running' }),
    download: async () => {
      throw Error('unused');
    },
    ...overrides,
  };
}
test('unknown POST preserves reservation and restart never submits again', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  let submits = 0;
  const api = adapter({
    submit: async () => {
      submits++;
      throw new ProviderError('TIMEOUT', 'uncertain', 'unknown');
    },
  });
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  const [id] = await runner.start({
    projectId: 'project',
    provider: config,
    approval,
    requests: [request],
  });
  assert.equal((await store.get(id)).state, 'unknown');
  assert.equal((await ledger.list())[0].state, 'reserved');
  await createJobRunner({
    store: createJobStore(root),
    ledger: createBudgetLedger(root),
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  }).resume();
  assert.equal(submits, 1);
});
test('known HTTP 429 failure exposes quota diagnosis and releases reservation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () =>
      adapter({
        submit: async () => {
          throw new ProviderError('RATE_LIMIT', 'Provider returned HTTP 429');
        },
      }),
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  const [id] = await runner.start({
    projectId: 'project',
    provider: config,
    approval,
    requests: [request],
  });
  const job = await store.get(id);
  assert.equal(job.state, 'failed');
  assert.equal(job.error?.code, 'RATE_LIMIT');
  assert.match(job.error?.message || '', /HTTP 429/);
  assert.equal((await ledger.list())[0].state, 'released');
  await runner.shutdown();
});
test('crash submitting state becomes unknown; queued known IDs resume reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  let submits = 0,
    polls = 0;
  const api = adapter({
    submit: async () => {
      submits++;
      return { id: 'remote', state: 'queued' };
    },
    poll: async (id) => {
      polls++;
      return { id, state: 'running' };
    },
  });
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  const [id] = await runner.start({
    projectId: 'project',
    provider: config,
    approval,
    requests: [request],
  });
  await runner.shutdown();
  const next = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  await next.resume();
  assert.equal(submits, 1);
  assert.ok(polls >= 1);
  assert.equal((await store.get(id)).remoteJobId, 'remote');
  await next.shutdown();
});
test('per-account queue never exceeds configured concurrency and holds unknown slot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  let submits = 0;
  const store = createJobStore(root);
  const api = adapter({
    submit: async () => {
      submits++;
      return { id: 'remote', state: 'queued' };
    },
  });
  const runner = createJobRunner({
    store,
    ledger: createBudgetLedger(root),
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  const ids = await runner.start({
    projectId: 'project',
    provider: config,
    approval,
    requests: [request, { ...request, requestId: 'two' }],
  });
  assert.equal(ids.length, 2);
  assert.equal(submits, 1);
  assert.equal((await store.get(ids[1])).state, 'ready');
  await runner.shutdown();
});
test('rejected batches cannot leave ready work to submit later; unknown caps split across shots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  let submits = 0;
  const api = adapter({
    submit: async () => {
      submits++;
      return { id: 'remote', state: 'queued' };
    },
  });
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  await assert.rejects(
    runner.start({
      projectId: 'project',
      provider: config,
      approval: { ...approval, capMinor: 100 },
      requests: [request, { ...request, requestId: 'two' }],
    }),
    /BUDGET_EXCEEDED/,
  );
  assert.equal((await store.list()).length, 0);
  assert.equal(submits, 0);
  const unknown = adapter({
    quote: async () => ({
      currency: 'USD',
      confidence: 'unknown',
      capturedAt: 'today',
      components: [],
    }),
    submit: async () => {
      submits++;
      return { id: 'remote', state: 'queued' };
    },
  });
  const next = createJobRunner({
    store,
    ledger,
    getAdapter: () => unknown,
    downloadDestination: () => path.join(root, 'clip.mp4'),
  });
  const ids = await next.start({
    projectId: 'project',
    provider: config,
    approval: { ...approval, unknownCeilingMinor: 200 },
    requests: [request, { ...request, requestId: 'two' }],
  });
  assert.equal(ids.length, 2);
  assert.deepEqual(
    (await ledger.list()).map((r) => r.reservedMinor),
    [100, 100],
  );
  await next.shutdown();
  await runner.shutdown();
});
test('persisted submitting attempt reconciles instead of resubmitting after a crash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  let submits = 0;
  const now = new Date().toISOString();
  const reserved = await ledger.reserve(
    'project',
    approval,
    {
      currency: 'USD',
      confidence: 'upperBound',
      maxMinor: 100,
      capturedAt: now,
      components: [],
    },
    'crash-request',
  );
  await store.create({
    id: 'crashed',
    projectId: 'project',
    provider: config,
    request: { ...request, requestId: 'crash-request' },
    approval,
    reservationId: reserved.id,
    state: 'submitting',
    createdAt: now,
    updatedAt: now,
  });
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () =>
      adapter({
        submit: async () => {
          submits++;
          return { id: 'duplicate', state: 'queued' };
        },
      }),
    downloadDestination: () => path.join(root, 'video.mp4'),
  });
  await runner.resume();
  assert.equal((await store.get('crashed')).state, 'unknown');
  assert.equal(submits, 0);
  assert.equal((await ledger.list())[0].state, 'reserved');
  await runner.shutdown();
});
test('completed footage is decoded locally and settles cost without re-submission', async () => {
  const { execFileSync } = await import('node:child_process');
  const { resolveMediaFfmpeg } =
    await import('../../main/videoCreation/mediaProbe');
  const { createFakeVideoAdapter } =
    await import('../../main/videoCreation/providers/fakeVideo');
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const fixture = path.join(root, 'fixture.mp4');
  execFileSync(resolveMediaFfmpeg(), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=64x64:r=24',
    '-t',
    '0.5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    fixture,
  ]);
  const api = createFakeVideoAdapter({ fixturePath: fixture });
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'assets', 'clip.mp4'),
  });
  const [id] = await runner.start({
    projectId: 'project',
    provider: config,
    approval,
    requests: [{ ...request, audioMode: 'narration' }],
  });
  await runner.pollStatus(id);
  await runner.pollStatus(id);
  const job = await store.get(id);
  assert.equal(job.state, 'review');
  assert.equal(job.artifact?.width, 64);
  assert.equal(job.artifact?.durationMs, 500);
  assert.equal(api.submitCalls, 1);
  assert.equal((await ledger.list())[0].state, 'settled');
  assert.ok((await readFile(path.join(root, 'assets', 'clip.mp4'))).length > 0);
  await runner.shutdown();
});
test('queue approvals expire before submit and immutable input changes are rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  const now = new Date().toISOString();
  const reservation = await ledger.reserve(
    'project',
    approval,
    {
      currency: 'USD',
      confidence: 'upperBound',
      maxMinor: 100,
      capturedAt: now,
      components: [],
    },
    'waiting',
  );
  await store.create({
    id: 'waiting',
    projectId: 'project',
    provider: config,
    request: { ...request, requestId: 'waiting' },
    approval: { ...approval, expiresAt: Date.now() - 1 },
    reservationId: reservation.id,
    state: 'ready',
    createdAt: now,
    updatedAt: now,
  });
  await assert.rejects(
    store.update('waiting', (job) => ({
      ...job,
      request: { ...job.request, prompt: 'different' },
    })),
    /IMMUTABLE_JOB_INPUT/,
  );
  let submits = 0;
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () =>
      adapter({
        submit: async () => {
          submits++;
          return { id: 'remote', state: 'queued' };
        },
      }),
    downloadDestination: () => path.join(root, 'video.mp4'),
  });
  await runner.resume();
  assert.equal(submits, 0);
  assert.equal((await store.get('waiting')).state, 'cancelled');
  assert.equal((await ledger.list())[0].state, 'released');
  await runner.shutdown();
});
test('accepted custom submission with missing output stays unknown and retains its reservation', async () => {
  const { createCustomAdapter } =
    await import('../../main/videoCreation/providers/customProfile');
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-jobs-'));
  const store = createJobStore(root);
  const ledger = createBudgetLedger(root);
  let submits = 0;
  const profile = {
    id: 'custom-profile',
    revision: 1,
    submit: {
      method: 'POST' as const,
      path: 'tasks',
      body: { prompt: '{{prompt}}' },
    },
    poll: { method: 'GET' as const, path: 'tasks/{{remoteJobId}}' },
    mapping: {
      jobId: 'id',
      status: 'status',
      resultUrl: 'output.url',
      states: {
        queued: 'queued' as const,
        done: 'completed' as const,
        error: 'failed' as const,
      },
    },
  };
  const custom = {
    ...config,
    protocol: 'custom-async-json' as const,
    profile,
    capabilities: adapter({}).capabilities(),
    pricing: {
      currency: 'USD',
      minorPerSecond: 1,
      source: 'test fixture',
      capturedAt: new Date().toISOString(),
    },
  };
  const api = createCustomAdapter(custom, profile, {
    json: async (_path, method) => {
      if (method === 'POST') {
        submits++;
        return { id: 'accepted-remote', status: 'done' };
      }
      return { id: 'accepted-remote', status: 'queued' };
    },
    bytes: async () => {
      throw Error('unused');
    },
  });
  const runner = createJobRunner({
    store,
    ledger,
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'video.mp4'),
  });
  const [id] = await runner.start({
    projectId: 'project',
    provider: custom,
    approval,
    requests: [request],
  });
  assert.equal((await store.get(id)).state, 'unknown');
  assert.equal((await store.get(id)).remoteJobId, 'accepted-remote');
  assert.equal((await ledger.list())[0].state, 'reserved');
  await runner.shutdown();
  const restored = createJobRunner({
    store: createJobStore(root),
    ledger: createBudgetLedger(root),
    getAdapter: () => api,
    downloadDestination: () => path.join(root, 'video.mp4'),
  });
  await restored.resume();
  assert.equal(submits, 1);
  await restored.shutdown();
});
