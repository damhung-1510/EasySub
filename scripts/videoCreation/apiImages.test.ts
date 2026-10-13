import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateCharacterReference } from '../../main/videoCreation/imageWorkflow';
import { createAssetStore } from '../../main/videoCreation/assetStore';
import { resolveMediaFfmpeg } from '../../main/videoCreation/mediaProbe';
import { createBudgetLedger } from '../../main/videoCreation/budgetLedger';
import type { ImageAdapter } from '../../types/videoProvider';
test('additional views require an approved portrait and preserve its reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-image-'));
  const file = path.join(root, 'portrait.png');
  execFileSync(resolveMediaFfmpeg(), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64',
    '-frames:v',
    '1',
    file,
  ]);
  const assets = createAssetStore(path.join(root, 'projects'));
  const portrait = await assets.importReference(
    'project',
    file,
    new AbortController().signal,
  );
  portrait.approvedAt = new Date().toISOString();
  let calls = 0;
  const adapter: ImageAdapter = {
    capabilities: () => ({ references: true, maxReferences: 3 }),
    quote: async () => ({
      currency: 'USD',
      maxMinor: 10,
      confidence: 'upperBound',
      capturedAt: 'now',
      components: [],
    }),
    generate: async (req) => {
      calls++;
      assert.equal(req.references[0].assetId, portrait.id);
      return { bytes: await readFile(file), mimeType: 'image/png' };
    },
  };
  const input = {
    projectId: 'project',
    characterId: 'character',
    characterRevisionId: 'revision',
    view: 'profile' as const,
    prompt: 'Side view of the same person',
    requestId: 'image-request',
    providerId: 'image-provider',
    modelId: 'gemini-2.5-flash-image',
    fingerprint: 'image-fp',
    portrait,
    approval: {
      id: 'image-approval',
      fingerprint: 'image-fp',
      providerId: 'image-provider',
      modelId: 'gemini-2.5-flash-image',
      currency: 'USD',
      capMinor: 100,
      expiresAt: Date.now() + 60000,
    },
  };
  const deps = {
    adapter,
    assets,
    ledger: createBudgetLedger(root),
    tempRoot: root,
  };
  await assert.rejects(
    generateCharacterReference(
      { ...input, portrait: { ...portrait, approvedAt: undefined } },
      deps,
      new AbortController().signal,
    ),
    /APPROVED_PORTRAIT_REQUIRED/,
  );
  assert.equal(calls, 0);
  const candidate = await generateCharacterReference(
    input,
    deps,
    new AbortController().signal,
  );
  assert.equal(candidate.asset.approvedAt, undefined);
  assert.equal(calls, 1);
});
