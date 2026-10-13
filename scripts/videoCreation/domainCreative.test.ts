import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('discovery asks one unanswered question and AI suggestions stay unconfirmed', async () => {
  const { createDiscoveryWorkflow } =
    await import('../../main/videoCreation/discovery/workflow');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'discovery-')),
  );
  const p = await store.create({ name: 'Film', kind: 'single' });
  const workflow = createDiscoveryWorkflow({
    store,
    llm: {
      complete: async () => ({
        text: JSON.stringify({
          summary: 'Understood',
          decisions: [{ field: 'premise', value: 'A courier saves a city' }],
          question: {
            targetField: 'language',
            text: 'Language?',
            rationale: 'voice',
          },
        }),
      }),
    },
  });
  const session = await workflow.startDiscovery(
    {
      projectId: p.id,
      episodeId: p.episodes[0].id,
      inputText: 'Vietnamese film',
      facts: { language: 'vi' },
    },
    new AbortController().signal,
  );
  assert.equal(session.turns[0].questions.length, 1);
  assert.notEqual(session.currentQuestion?.targetField, 'language');
  const updated = await workflow.answerDiscovery(
    session.id,
    { text: 'Kids', facts: { audience: 'children', ending: 'hopeful' } },
    session.version,
    new AbortController().signal,
  );
  assert.equal(updated.questions.length, 1);
  const suggestions = createDiscoveryWorkflow({
    store,
    llm: {
      complete: async () => ({
        text: JSON.stringify({
          objective: 'Entertainment',
          audience: 'children',
          premise: 'Courier saves city',
          conflict: 'storm',
          characters: 'courier',
          relationships: 'friend',
          world: 'city',
          locations: 'streets',
          language: 'vi',
          dialogueTone: 'gentle',
          ending: 'hopeful',
          style: 'cartoon',
          targetDurationMs: 60000,
          audioMode: 'narration',
          assumptions: [],
          unresolvedIssues: [],
        }),
      }),
    },
  });
  const brief = await suggestions.suggestRemaining(
    session.id,
    new AbortController().signal,
  );
  const latest = await store.load(p.id);
  const saved = latest.discoverySessions.find((s) => s.id === session.id)!;
  assert.equal(
    saved.decisions.find((d) => d.field === 'conflict')?.source,
    'suggested',
  );
  assert.equal(
    saved.decisions.find((d) => d.field === 'conflict')?.confirmed,
    false,
  );
  assert.equal(brief.ending, 'hopeful');
});
test('structured requests repair twice then fail without pretending success', async () => {
  const { requestStructured } =
    await import('../../main/videoCreation/llmAdapter');
  const { z } = await import('zod');
  let calls = 0;
  await assert.rejects(
    requestStructured(
      {
        complete: async () => {
          calls++;
          return { text: 'invalid' };
        },
      },
      'instructions',
      {},
      z.object({ ok: z.boolean() }),
      new AbortController().signal,
    ),
    /STRUCTURED_OUTPUT_INVALID/,
  );
  assert.equal(calls, 3);
});
test('cast linkage requires explicit choice and retains stable speaker ID', async () => {
  const { applyCharacterLinks, proposeCharacterLinks } =
    await import('../../main/videoCreation/characterResolver');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'cast-')),
  );
  let p = await store.create({ name: 'series', kind: 'series' });
  p = applyCharacterLinks(p, [
    {
      candidateId: 'candidate',
      action: 'new',
      name: 'Mai',
      description: 'Courier',
    },
  ]);
  assert.equal(
    proposeCharacterLinks(
      [
        {
          id: 'next',
          name: 'Mai',
          aliases: [],
          description: 'Another person',
          sourceSceneIds: [],
          inferred: true,
        },
      ],
      p,
    )[0].needsConfirmation,
    true,
  );
  const id = p.characters[0].id;
  p = applyCharacterLinks(p, [
    {
      candidateId: 'next',
      action: 'link',
      characterId: id,
      name: 'Mai renamed',
    },
  ]);
  assert.equal(p.characters[0].id, id);
  assert.equal(p.characters.length, 1);
});

test('cancellation stops repairs and does not corrupt original imported text', async () => {
  const { requestStructured } =
    await import('../../main/videoCreation/llmAdapter');
  const { importScriptText, runScriptStep } =
    await import('../../main/videoCreation/scriptWorkflow');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const { z } = await import('zod');
  const p = await createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'import-')),
  ).create({ name: 'Imported film', kind: 'single' });
  const imported = importScriptText(
    p,
    p.episodes[0].id,
    'Original narration and dialogue.',
  );
  assert.throws(
    () => importScriptText(imported, p.episodes[0].id, 'Rewrite'),
    /ORIGINAL_SCRIPT_IMMUTABLE/,
  );
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    requestStructured(
      {
        complete: async () => {
          calls++;
          controller.abort();
          return { text: 'broken' };
        },
      },
      'sys',
      {},
      z.object({ ok: z.boolean() }),
      controller.signal,
    ),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    runScriptStep(
      {
        step: 'import-analysis',
        project: imported,
        episodeId: p.episodes[0].id,
      },
      { llm: { complete: async () => ({ text: 'invalid' }) } },
      new AbortController().signal,
    ),
    /STRUCTURED_OUTPUT_INVALID/,
  );
  assert.equal(
    imported.episodes[0].originalScriptText,
    'Original narration and dialogue.',
  );
  assert.equal(imported.episodes[0].script, undefined);
});

test('discovery extracts cited facts without promoting uncited ideas and resumes after restart', async () => {
  const { createDiscoveryWorkflow } =
    await import('../../main/videoCreation/discovery/workflow');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const root = await mkdtemp(path.join(os.tmpdir(), 'discovery-evidence-'));
  const store = createProjectStore(root);
  const p = await store.create({ name: 'Evidence', kind: 'single' });
  const llm = {
    complete: async () => ({
      text: JSON.stringify({
        summary: 'A Vietnamese story',
        decisions: [
          {
            field: 'language',
            value: 'vi',
            source: 'user',
            evidence: 'tiếng Việt',
          },
          {
            field: 'ending',
            value: 'happy',
            source: 'user',
            evidence: 'imagined ending',
          },
        ],
        question: {
          targetField: 'language',
          text: 'Language?',
          rationale: 'speech',
        },
      }),
    }),
  };
  const session = await createDiscoveryWorkflow({ store, llm }).startDiscovery(
    {
      projectId: p.id,
      episodeId: p.episodes[0].id,
      inputText: 'Phim tiếng Việt',
    },
    new AbortController().signal,
  );
  assert.equal(
    session.decisions.find((d) => d.field === 'language')?.confirmed,
    true,
  );
  assert.equal(
    session.decisions.find((d) => d.field === 'ending')?.confirmed,
    false,
  );
  assert.notEqual(session.currentQuestion?.targetField, 'language');
  const restarted = await createProjectStore(root).load(p.id);
  assert.equal(
    restarted.discoverySessions[0].decisions[0].sourceTurnId,
    session.decisions[0].sourceTurnId,
  );
});
