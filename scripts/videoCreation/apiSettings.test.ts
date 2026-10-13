import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProviderSettings } from '../../main/videoCreation/providerSettings';
import { createBudgetLedger } from '../../main/videoCreation/budgetLedger';
import { validateProviderProfile } from '../../main/videoCreation/providers/profileValidation';
const codec = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw Error('unavailable');
  },
  decryptString: () => {
    throw Error('unavailable');
  },
};
export const draft = {
  name: 'Test',
  kind: 'video' as const,
  protocol: 'veo-gemini' as const,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelId: 'veo-3.1-generate-preview',
  authMode: 'header' as const,
  authHeader: 'x-goog-api-key',
  timeoutMs: 30000,
  concurrency: 1,
};
test('session-only credentials never persist; config revisions survive edit and deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-settings-'));
  const store = createProviderSettings(root, codec);
  const saved = await store.save(draft, 'topsecret');
  assert.equal(saved.hasCredential, true);
  assert.equal(JSON.stringify(saved).includes('topsecret'), false);
  const edited = await store.save({
    ...draft,
    id: saved.id,
    name: 'Edited',
    expectedVersion: saved.version,
  });
  assert.equal((await store.get(saved.id, saved.revisionId)).name, 'Test');
  await store.delete(saved.id);
  assert.equal((await store.list()).length, 0);
  assert.equal(await store.getSecret(saved.id), 'topsecret');
  assert.equal((await store.get(saved.id, edited.revisionId)).name, 'Edited');
  for (const file of await readdir(root))
    assert.equal(
      (await readFile(path.join(root, file), 'utf8')).includes('topsecret'),
      false,
    );
  assert.equal(
    (await createProviderSettings(root, codec).get(saved.id, edited.revisionId))
      .hasCredential,
    false,
  );
});
test('settings reject unsafe URLs, stale version and secret-bearing configuration', async () => {
  const store = createProviderSettings(
    await mkdtemp(path.join(os.tmpdir(), 'video-settings-')),
    codec,
  );
  await assert.rejects(
    store.save({ ...draft, baseUrl: 'http://example.com' }),
    /HTTPS_REQUIRED/,
  );
  await assert.rejects(
    store.save({ ...draft, apiKey: 'secret' } as never),
    /SECRET_IN_CONFIG/,
  );
  const config = await store.save(draft);
  await assert.rejects(
    store.save({ ...draft, id: config.id, expectedVersion: 99 }),
    /VERSION_CONFLICT/,
  );
});
test('serialized reservations enforce caps, uniqueness and currencies through restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-ledger-'));
  const ledger = createBudgetLedger(root);
  const approval = {
    id: 'approval',
    fingerprint: 'fp',
    providerId: 'provider',
    modelId: 'model',
    currency: 'USD',
    capMinor: 1000,
    expiresAt: Date.now() + 60000,
  };
  const quote = {
    currency: 'USD',
    maxMinor: 600,
    confidence: 'upperBound' as const,
    capturedAt: new Date().toISOString(),
    components: [],
  };
  const results = await Promise.allSettled([
    ledger.reserve('project', approval, quote, 'request-a'),
    ledger.reserve('project', approval, quote, 'request-b'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await createBudgetLedger(root).list('project')).length, 1);
  await assert.rejects(
    ledger.reserve(
      'project',
      approval,
      { ...quote, currency: 'VND' },
      'request-c',
    ),
    /CURRENCY_MISMATCH/,
  );
  await assert.rejects(
    ledger.reserve(
      'project',
      approval,
      { ...quote, confidence: 'unknown', maxMinor: undefined },
      'request-d',
    ),
    /COST_CEILING_REQUIRED/,
  );
});
test('declarative profile rejects executable placeholders and unsafe endpoint paths', () => {
  const profile = {
    id: 'custom',
    revision: 1,
    submit: { method: 'POST', path: 'tasks', body: { prompt: '{{prompt}}' } },
    poll: { method: 'GET', path: 'tasks/{{remoteJobId}}' },
    mapping: {
      jobId: 'id',
      status: 'status',
      resultUrl: 'result.url',
      states: {
        queued: 'queued',
        running: 'running',
        done: 'completed',
        failed: 'failed',
      },
    },
  };
  assert.equal(validateProviderProfile(profile).id, 'custom');
  assert.throws(
    () =>
      validateProviderProfile({
        ...profile,
        submit: { ...profile.submit, path: 'https://evil.test' },
      }),
    /INVALID_PROFILE/,
  );
  assert.throws(
    () =>
      validateProviderProfile({
        ...profile,
        submit: { ...profile.submit, body: { code: '{{process.exit()}}' } },
      }),
    /INVALID_PROFILE/,
  );
});
test('encrypted credentials remain pinned when an instance key changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-settings-'));
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('cipher:' + s).reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString().slice(7),
  };
  const store = createProviderSettings(root, secure);
  const first = await store.save(draft, 'old-key');
  const second = await store.save(
    { ...draft, id: first.id, expectedVersion: first.version },
    'new-key',
  );
  assert.equal(await store.getSecret(first.id, first.revisionId), 'old-key');
  assert.equal(await store.getSecret(first.id, second.revisionId), 'new-key');
  assert.equal(
    (await createProviderSettings(root, secure).get(second.id)).hasCredential,
    true,
  );
  assert.equal(
    (await readFile(path.join(root, 'credentials.json'), 'utf8')).includes(
      'old-key',
    ),
    false,
  );
});
