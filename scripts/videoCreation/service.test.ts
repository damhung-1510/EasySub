import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFakeVideoAdapter } from '../../main/videoCreation/providers/fakeVideo';

async function setup() {
  const mod = await import('../../main/videoCreation/service').catch(
    () => ({}) as any,
  );
  assert.equal(
    typeof mod.createVideoCreationService,
    'function',
    'video service not implemented',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-service-'));
  const service = await mod.createVideoCreationService({
    root,
    llm: async () => {
      throw new Error('unexpected request');
    },
    listLlmProviders: () => [],
  });
  return { service, root };
}
test('project and episode commands persist and reject stale writes', async () => {
  const { service, root } = await setup();
  try {
    const p = await service.command({
      command: 'create',
      payload: {
        name: 'Series',
        kind: 'series',
        idea: 'A robot learns to cook',
      },
    });
    assert.equal(p.episodes.length, 1);
    const next = await service.command({
      command: 'addEpisode',
      payload: {
        projectId: p.id,
        expectedVersion: p.version,
        name: 'Episode 2',
      },
    });
    assert.equal(next.episodes.length, 2);
    assert.equal(
      (await service.command({ command: 'load', payload: { projectId: p.id } }))
        .episodes[1].name,
      'Episode 2',
    );
    await assert.rejects(
      service.command({
        command: 'update',
        payload: {
          projectId: p.id,
          expectedVersion: p.version,
          patch: { name: 'stale' },
        },
      }),
      /VERSION_CONFLICT/,
    );
    await assert.rejects(
      service.command({
        command: 'startDiscovery',
        payload: {
          projectId: p.id,
          episodeId: p.episodes[0].id,
          llmProviderId: 'missing',
        },
      }),
      /COST_AUTHORIZATION_REQUIRED/,
    );
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('service rejects unknown commands and unapproved video production', async () => {
  const { service, root } = await setup();
  try {
    await assert.rejects(
      service.command({ command: 'runShell', payload: {} }),
      /INVALID_COMMAND/,
    );
    const p = await service.command({
      command: 'create',
      payload: { name: 'Single', kind: 'single' },
    });
    await assert.rejects(
      service.command({
        command: 'quote',
        payload: {
          projectId: p.id,
          episodeId: p.episodes[0].id,
          videoProviderId: 'missing',
        },
      }),
      /BRIEF_REQUIRED|SCRIPT_REQUIRED/,
    );
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prompt-only video test prepares a reviewable shot and quote without a writing API', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-prompt-shot-'));
  const fake = createFakeVideoAdapter({
    fixturePath: path.join(root, 'unused.mp4'),
  });
  let llmCalls = 0;
  const service = await (
    await import('../../main/videoCreation/service')
  ).createVideoCreationService({
    root,
    llm: () => {
      llmCalls++;
      throw new Error('WRITING_API_UNEXPECTED');
    },
    listLlmProviders: () => [],
    providerSettings: {
      get: async () => ({
        id: 'fake-video',
        kind: 'video',
        revisionId: 'fixture-revision',
        modelId: 'fixture-model',
        pricing: { currency: 'USD' },
      }),
    },
    getVideoAdapter: async () => fake,
  });
  try {
    let project = await service.command({
      command: 'create',
      payload: { name: 'Video test', kind: 'single' },
    });
    const capabilities = await service.command({
      command: 'videoCapabilities',
      payload: { videoProviderId: 'fake-video' },
    });
    assert.ok(capabilities.durationsMs.includes(4000));
    const episodeId = project.episodes[0].id;
    const prepare = (prompt: string, durationMs = 4000) =>
      service.command({
        command: 'preparePromptShot',
        payload: {
          projectId: project.id,
          episodeId,
          expectedVersion: project.version,
          videoProviderId: 'fake-video',
          prompt,
          durationMs,
          aspectRatio: '16:9',
          resolution: '720p',
        },
      });
    await assert.rejects(prepare('A sunrise', 1234), /UNSUPPORTED_DURATION/);
    project = await prepare('A sunrise over the ocean');
    assert.equal(project.episodes[0].shots.length, 1);
    assert.equal(project.episodes[0].shots[0].snapshot.approvedAt, undefined);
    assert.equal(llmCalls, 0);
    await assert.rejects(
      service.command({
        command: 'quote',
        payload: {
          projectId: project.id,
          episodeId,
          videoProviderId: 'fake-video',
        },
      }),
      /SHOT_APPROVAL_REQUIRED/,
    );
    await assert.rejects(prepare('Another prompt'), /EPISODE_ALREADY_PREPARED/);
    project = await service.command({
      command: 'approveShots',
      payload: {
        projectId: project.id,
        episodeId,
        expectedVersion: project.version,
      },
    });
    const quote = await service.command({
      command: 'quote',
      payload: {
        projectId: project.id,
        episodeId,
        videoProviderId: 'fake-video',
      },
    });
    assert.equal(quote.shotCount, 1);
    assert.equal(fake.submitCalls, 0);
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('editing a confirmed character creates a draft revision that can be approved again', async () => {
  const { service, root } = await setup();
  try {
    const created = await service.command({
      command: 'create',
      payload: { name: 'Series cast', kind: 'series' },
    });
    const seeded = await service.store.update(
      created.id,
      created.version,
      (p) => {
        p.assets.push({
          id: 'portrait',
          kind: 'image',
          relativePath: 'assets/portrait.png',
          sha256: 'a'.repeat(64),
          mimeType: 'image/png',
          bytes: 100,
          createdAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
        });
        p.characters.push({
          id: 'hero',
          name: 'Hero',
          aliases: [],
          revisions: [
            {
              revisionId: 'hero-rev-1',
              createdAt: new Date().toISOString(),
              approvedAt: new Date().toISOString(),
              identity: { description: 'Blue coat' },
              referenceAssetIds: ['portrait'],
            },
          ],
          currentRevisionId: 'hero-rev-1',
          variants: [],
          confirmed: true,
        });
        return p;
      },
    );
    const edited = structuredClone(seeded.characters[0]);
    edited.revisions[0].identity.description = 'Red coat';
    const draft = await service.command({
      command: 'update',
      payload: {
        projectId: created.id,
        expectedVersion: seeded.version,
        patch: { characters: [edited] },
      },
    });
    const character = draft.characters[0];
    assert.equal(character.confirmed, false);
    assert.equal(character.revisions[0].identity.description, 'Blue coat');
    assert.notEqual(character.currentRevisionId, 'hero-rev-1');
    assert.deepEqual(
      character.revisions.find(
        (r: any) => r.revisionId === character.currentRevisionId,
      ).referenceAssetIds,
      [],
    );
    assert.equal(
      character.revisions.find(
        (r: any) => r.revisionId === character.currentRevisionId,
      ).approvedAt,
      undefined,
    );
    const approved = await service.command({
      command: 'linkEntities',
      payload: {
        projectId: created.id,
        episodeId: created.episodes[0].id,
        expectedVersion: draft.version,
        characterId: 'hero',
        confirmed: true,
      },
    });
    assert.equal(approved.characters[0].confirmed, true);
    assert.ok(
      approved.characters[0].revisions.find(
        (r: any) => r.revisionId === approved.characters[0].currentRevisionId,
      ).approvedAt,
    );
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
