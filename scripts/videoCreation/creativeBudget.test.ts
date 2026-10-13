import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCreativeBudgetStore } from '../../main/videoCreation/creativeBudget';

test('creative budget accumulates requests across commands and service restarts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-budget-'));
  const input = {
    projectId: 'project',
    episodeId: 'episode',
    providerId: 'writer',
    currency: 'USD',
    capMinor: 500,
    maxRequests: 2,
  };
  try {
    const first = createCreativeBudgetStore(root);
    const original = await first.authorize(input);
    assert.equal(
      (await first.nextRequest('project', 'episode', 'writer')).number,
      1,
    );
    const restarted = createCreativeBudgetStore(root);
    assert.equal(
      (await restarted.authorize(input)).approval.id,
      original.approval.id,
    );
    assert.equal(
      (await restarted.nextRequest('project', 'episode', 'writer')).number,
      2,
    );
    await assert.rejects(
      restarted.nextRequest('project', 'episode', 'writer'),
      /LLM_REQUEST_LIMIT/,
    );
    await assert.rejects(
      restarted.authorize({ ...input, capMinor: 1000 }),
      /CREATIVE_BUDGET_CHANGE_REQUIRES_NEW_SESSION/,
    );
    const renewed = await restarted.authorize({
      ...input,
      capMinor: 1000,
      newSession: true,
    });
    assert.notEqual(renewed.approval.id, original.approval.id);
    assert.equal(
      (await restarted.usage('project', 'episode', 'writer'))?.requests,
      0,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('creative budget serializes concurrent requests against one limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-budget-'));
  try {
    const budget = createCreativeBudgetStore(root);
    await assert.rejects(
      budget.authorize({
        projectId: 'p',
        episodeId: 'e',
        providerId: 'llm',
        currency: 'USD',
        capMinor: 0,
        maxRequests: 1,
      }),
      /INVALID_CREATIVE_BUDGET/,
    );
    await budget.authorize({
      projectId: 'p',
      episodeId: 'e',
      providerId: 'llm',
      currency: 'USD',
      capMinor: 100,
      maxRequests: 1,
    });
    const results = await Promise.allSettled([
      budget.nextRequest('p', 'e', 'llm'),
      budget.nextRequest('p', 'e', 'llm'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
