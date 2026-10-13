import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { path as ffmpeg } from '@ffmpeg-installer/ffmpeg';
import { createVideoCreationService } from '../../main/videoCreation/service';
import { createJobRunner } from '../../main/videoCreation/jobRunner';
import { createJobStore } from '../../main/videoCreation/jobStore';
import { createBudgetLedger } from '../../main/videoCreation/budgetLedger';
import { createFakeVideoAdapter } from '../../main/videoCreation/providers/fakeVideo';
import { exportEpisode } from '../../main/videoCreation/exportRunner';
import type { ProviderConfig } from '../../types/videoProvider';

test('offline series flow: reference, storyboard, approved job, take and MP4 export', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-acceptance-'));
  const projects = path.join(root, 'projects');
  const now = new Date().toISOString();
  const fixture = path.join(root, 'fixture.mp4');
  const image = path.join(root, 'portrait.png');
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=160x90:r=24:d=0.5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    fixture,
  ]);
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=64x64',
    '-frames:v',
    '1',
    image,
  ]);
  const config: ProviderConfig = {
    id: 'fake-video',
    version: 1,
    revisionId: 'fake-config-revision',
    name: 'Offline fixture',
    kind: 'video',
    protocol: 'custom-async-json',
    modelId: 'fake-model',
    baseUrl: 'https://fixture.invalid',
    authMode: 'none',
    timeoutMs: 1000,
    concurrency: 1,
    createdAt: now,
    updatedAt: now,
  };
  const fake = createFakeVideoAdapter({
    fixturePath: fixture,
    capabilities: { durationsMs: [500], resolutions: ['720p'], audio: true },
  });
  const jobStore = createJobStore(path.join(root, 'jobs'));
  const ledger = createBudgetLedger(path.join(root, 'ledger'));
  const runner = createJobRunner({
    store: jobStore,
    ledger,
    getAdapter: () => fake,
    downloadDestination: (job) =>
      path.join(projects, job.projectId, 'assets', job.id + '.mp4'),
    pollIntervalMs: 10000,
  });
  const storyboard = {
    shots: [
      {
        sceneId: 'scene-1',
        characterIds: ['hero'],
        durationMs: 500,
        purpose: 'Introduce the hero',
        action: 'Hero looks up',
        camera: 'wide',
        lighting: 'daylight',
        environment: 'room',
        continuityIn: '',
        continuityOut: '',
        prompt: 'A hero in a blue coat looks up',
        dialogueIds: [],
        narration: '',
      },
    ],
  };
  const service = await createVideoCreationService({
    root: projects,
    llm: (_provider, boundary) => ({
      complete: async (request) => {
        await boundary.beforeRequest?.(request);
        return { text: JSON.stringify(storyboard) };
      },
    }),
    listLlmProviders: () => [
      { id: 'writer', name: 'Writer', modelId: 'fixture' },
    ],
    providerSettings: { get: async () => config },
    getVideoAdapter: async () => fake,
    jobStore,
    ledger,
    jobRunner: runner,
    exportEpisode: (project, episodeId, options, signal) =>
      exportEpisode({ root: projects, project, episodeId, options, signal }),
  });
  try {
    let project = await service.command({
      command: 'create',
      payload: {
        name: 'Series',
        kind: 'series',
        audioMode: 'native',
        idea: 'A hero enters a room',
      },
    });
    const episodeId = project.episodes[0].id;
    project = await service.command({
      command: 'importReference',
      payload: { projectId: project.id, episodeId, sourcePath: image },
    });
    const assetId = project.assets[0].id;
    project = await service.store.update(
      project.id,
      project.version,
      (draft) => {
        draft.characters.push({
          id: 'hero',
          name: 'Hero',
          aliases: [],
          currentRevisionId: 'hero-r1',
          revisions: [
            {
              revisionId: 'hero-r1',
              createdAt: now,
              approvedAt: now,
              identity: { description: 'Blue coat' },
              referenceAssetIds: [],
            },
          ],
          variants: [],
          confirmed: true,
        });
        return draft;
      },
    );
    project = await service.command({
      command: 'approveReference',
      payload: {
        projectId: project.id,
        episodeId,
        expectedVersion: project.version,
        characterId: 'hero',
        assetId,
      },
    });
    const brief = {
      revisionId: 'brief-r1',
      createdAt: now,
      approvedAt: now,
      objective: 'Enter',
      audience: 'General',
      premise: 'Hero enters',
      conflict: 'Fear',
      characters: 'Hero',
      relationships: 'None',
      world: 'Modern',
      locations: 'Room',
      language: 'vi',
      dialogueTone: 'Calm',
      ending: 'Hero stays',
      style: 'cinematic',
      targetDurationMs: 500,
      audioMode: 'native' as const,
      assumptions: [],
      unresolvedIssues: [],
    };
    project = await service.store.update(
      project.id,
      project.version,
      (draft) => {
        draft.confirmedBriefRevisions.push(brief);
        const episode = draft.episodes[0];
        episode.brief = brief;
        episode.script = {
          id: 'script-1',
          revisionId: 'script-r1',
          createdAt: now,
          approvedAt: now,
          scenes: [
            {
              id: 'scene-1',
              location: 'room',
              locationId: 'room',
              time: 'day',
              characterIds: ['hero'],
              action: 'Hero looks up',
              dialogues: [],
              narration: '',
              sound: '',
              durationMs: 500,
            },
          ],
        };
        draft.locations.push({
          id: 'room',
          revisionId: 'room-r1',
          createdAt: now,
          approvedAt: now,
          name: 'room',
          description: 'room',
        });
        draft.styles.push({
          id: 'style',
          revisionId: 'style-r1',
          createdAt: now,
          approvedAt: now,
          name: 'cinematic',
          description: 'cinematic',
        });
        return draft;
      },
    );
    project = await service.command({
      command: 'buildStoryboard',
      payload: {
        projectId: project.id,
        episodeId,
        llmProviderId: 'writer',
        videoProviderId: config.id,
        authorized: true,
        capMinor: 100,
        maxRequests: 2,
        currency: 'USD',
      },
    });
    assert.equal(project.episodes[0].shots.length, 1);
    assert.equal(
      project.episodes[0].shots[0].snapshot.characterBindings[0].characterId,
      'hero',
    );
    assert.equal(
      (
        await service.command({
          command: 'creativeUsage',
          payload: {
            projectId: project.id,
            episodeId,
            llmProviderId: 'writer',
          },
        })
      ).requests,
      1,
    );
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
        videoProviderId: config.id,
      },
    });
    const approved = await service.command({
      command: 'approveCost',
      payload: {
        quoteId: quote.quoteId,
        currency: 'USD',
        capMinor: 1,
      },
    });
    project = await service.command({
      command: 'startBatch',
      payload: {
        projectId: project.id,
        episodeId,
        quoteId: quote.quoteId,
        approvalId: approved.approvalId,
      },
    });
    for (
      let n = 0;
      n < 5 && project.episodes[0].shots[0].attempts[0].state !== 'review';
      n++
    )
      project = await service.command({
        command: 'pollStatus',
        payload: { projectId: project.id },
      });
    const shot = project.episodes[0].shots[0];
    assert.equal(shot.attempts[0].state, 'review');
    project = await service.command({
      command: 'selectTake',
      payload: {
        projectId: project.id,
        episodeId,
        expectedVersion: project.version,
        shotId: shot.id,
        attemptId: shot.attempts[0].id,
      },
    });
    const exported = await service.command({
      command: 'export',
      payload: {
        projectId: project.id,
        episodeId,
        nativeAudioReviewed: true,
        width: 320,
        height: 180,
      },
    });
    assert.ok((await fs.stat(exported.path)).size > 0);
    project = await service.command({
      command: 'load',
      payload: { projectId: project.id },
    });
    assert.equal(project.episodes[0].status, 'exported');
    assert.ok(project.assets.some((asset) => asset.kind === 'video'));
    assert.ok(project.assets.some((asset) => asset.kind === 'subtitle'));
    const backupPath = path.join(root, 'backup');
    await service.command({
      command: 'backup',
      payload: {
        projectId: project.id,
        episodeId,
        destinationPath: backupPath,
      },
    });
    const restored = await service.command({
      command: 'importBackup',
      payload: {
        sourcePath: backupPath,
      },
    });
    assert.notEqual(restored.id, project.id);
    assert.equal(restored.characters[0].id, 'hero');
    assert.ok(restored.assets.some((asset: any) => asset.kind === 'subtitle'));
    const oldRevision = project.characters[0].currentRevisionId;
    const revised = structuredClone(project.characters[0]);
    revised.revisions.find((r) => r.revisionId === oldRevision)!.voice = {
      providerId: 'offline-tts',
      voiceId: 'hero-voice',
      language: 'vi',
    };
    project = await service.command({
      command: 'update',
      payload: {
        projectId: project.id,
        expectedVersion: project.version,
        patch: { characters: [revised] },
      },
    });
    project = await service.command({
      command: 'linkEntities',
      payload: {
        projectId: project.id,
        episodeId,
        expectedVersion: project.version,
        characterId: 'hero',
        confirmed: true,
      },
    });
    await assert.rejects(
      service.command({
        command: 'approveShots',
        payload: {
          projectId: project.id,
          episodeId,
          expectedVersion: project.version,
        },
      }),
      /CHARACTER_BINDING_OUTDATED/,
    );
    await assert.rejects(
      service.command({
        command: 'selectTake',
        payload: {
          projectId: project.id,
          episodeId,
          expectedVersion: project.version,
          shotId: shot.id,
          attemptId: shot.attempts[0].id,
        },
      }),
      /STALE_TAKE/,
    );
    project = await service.command({
      command: 'refreshShotBindings',
      payload: {
        projectId: project.id,
        episodeId,
        expectedVersion: project.version,
      },
    });
    const refreshed = project.episodes[0].shots[0];
    assert.equal(
      refreshed.snapshot.characterBindings[0].characterRevisionId,
      project.characters[0].currentRevisionId,
    );
    assert.notEqual(project.characters[0].currentRevisionId, oldRevision);
    assert.equal(refreshed.selectedAttemptId, undefined);
    assert.equal(refreshed.attempts.length, 1);
    assert.equal(refreshed.stale, true);
    const second = await service.command({
      command: 'addEpisode',
      payload: {
        projectId: project.id,
        expectedVersion: project.version,
        name: 'Episode 2',
      },
    });
    assert.equal(second.episodes.length, 2);
    assert.equal(second.characters[0].id, 'hero');
    assert.equal(fake.submitCalls, 1);
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
