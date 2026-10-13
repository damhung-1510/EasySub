import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('compiler pins two references, enforces capabilities and produces stable fingerprint', async () => {
  const { compileVideoRequest } =
    await import('../../main/videoCreation/promptCompiler');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'compile-')),
  );
  const p = await store.create({ name: 'Film', kind: 'single' });
  const now = new Date().toISOString();
  p.locations.push({
    id: 'location',
    revisionId: 'location-rev',
    createdAt: now,
    approvedAt: now,
    name: 'room',
    description: 'room',
  });
  p.styles.push({
    id: 'style',
    revisionId: 'style-rev',
    createdAt: now,
    approvedAt: now,
    name: 'cinematic',
    description: 'cinematic',
  });
  for (const id of ['one', 'two']) {
    p.assets.push({
      id,
      kind: 'image',
      relativePath: `assets/${id}.png`,
      sha256: 'a'.repeat(64),
      mimeType: 'image/png',
      bytes: 100,
      createdAt: now,
      approvedAt: now,
    });
    p.characters.push({
      id,
      name: id,
      aliases: [],
      revisions: [
        {
          revisionId: id + '-rev',
          createdAt: now,
          approvedAt: now,
          identity: { description: id + ' person' },
          referenceAssetIds: [id],
        },
      ],
      currentRevisionId: id + '-rev',
      variants: [],
      confirmed: true,
    });
  }
  p.confirmedBriefRevisions.push({
    revisionId: 'brief',
    createdAt: now,
    approvedAt: now,
    objective: 'a',
    audience: 'a',
    premise: 'a',
    conflict: 'a',
    characters: 'a',
    relationships: 'a',
    world: 'a',
    locations: 'a',
    language: 'vi',
    dialogueTone: 'a',
    ending: 'a',
    style: 'a',
    targetDurationMs: 6000,
    audioMode: 'narration',
    assumptions: [],
    unresolvedIssues: [],
  });
  p.episodes[0].script = {
    id: 'script',
    revisionId: 'script-rev',
    createdAt: now,
    approvedAt: now,
    scenes: [
      {
        id: 'scene',
        location: 'room',
        locationId: 'location',
        time: 'day',
        characterIds: ['one', 'two'],
        action: 'walk',
        dialogues: [],
        narration: '',
        sound: '',
        durationMs: 6000,
      },
    ],
  };
  const shot = {
    id: 'shot',
    revisionId: 'shot-rev',
    createdAt: now,
    briefRevisionId: 'brief',
    scriptRevisionId: 'script-rev',
    sceneId: 'scene',
    characterBindings: p.characters.map((c) => ({
      characterId: c.id,
      characterRevisionId: c.currentRevisionId,
      referenceAssetIds: [c.id],
    })),
    locationRevisionId: 'location-rev',
    styleRevisionId: 'style-rev',
    prompt: 'Two friends walk',
    durationMs: 6000,
    audioMode: 'narration' as const,
    aspectRatio: '16:9',
    resolution: '1080p',
  };
  const caps = {
    text: true,
    image: true,
    references: true,
    maxReferences: 2,
    durationsMs: [6000],
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    audio: true,
    seed: false,
    cancel: false,
    concurrency: 1,
  };
  const request = compileVideoRequest(shot, p, caps, { modelId: 'veo-3.1' });
  assert.equal(request.references.length, 2);
  p.characters[0].name = 'Renamed for the next episode';
  assert.equal(
    compileVideoRequest(shot, p, caps, { modelId: 'veo-3.1' }).fingerprint,
    request.fingerprint,
  );

  assert.throws(
    () =>
      compileVideoRequest(
        shot,
        p,
        { ...caps, maxReferences: 1 },
        { modelId: 'veo-3.1' },
      ),
    /REFERENCE_LIMIT/,
  );
  assert.equal(
    request.fingerprint,
    compileVideoRequest(shot, p, caps, {
      modelId: 'veo-3.1',
      requestId: 'retry',
    }).fingerprint,
  );
  assert.throws(
    () =>
      compileVideoRequest({ ...shot, durationMs: 5000 }, p, caps, {
        modelId: 'veo-3.1',
      }),
    /UNSUPPORTED_DURATION/,
  );
});

test('storyboard preserves complete narration and uses model duration and resolution', async () => {
  const { buildStoryboard } =
    await import('../../main/videoCreation/storyboardWorkflow');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const p = await createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'storyboard-')),
  ).create({ name: 'Narration', kind: 'single' });
  const now = new Date().toISOString();
  const e = p.episodes[0];
  p.locations.push({
    id: 'forest-location',
    revisionId: 'forest-rev',
    createdAt: now,
    approvedAt: now,
    name: 'forest',
    description: 'forest',
  });
  p.styles.push({
    id: 'style',
    revisionId: 'style-rev',
    createdAt: now,
    approvedAt: now,
    name: e.style,
    description: e.style,
  });
  const brief = {
    revisionId: 'brief',
    createdAt: now,
    approvedAt: now,
    objective: 'tell story',
    audience: 'all',
    premise: 'rain',
    conflict: 'storm',
    characters: 'none',
    relationships: 'none',
    world: 'forest',
    locations: 'forest',
    language: 'vi',
    dialogueTone: 'quiet',
    ending: 'sun',
    style: 'film',
    targetDurationMs: 6000,
    audioMode: 'narration' as const,
    assumptions: [],
    unresolvedIssues: [],
  };
  e.brief = brief;
  p.confirmedBriefRevisions.push(brief);
  e.script = {
    id: 'script',
    revisionId: 'script-rev',
    createdAt: now,
    approvedAt: now,
    scenes: [
      {
        id: 'scene',
        location: 'forest',
        locationId: 'forest-location',
        time: 'day',
        characterIds: [],
        action: 'Rain falls',
        dialogues: [],
        narration: 'Rain passes and the forest awakens.',
        sound: 'rain',
        durationMs: 6000,
      },
    ],
  };
  const caps = {
    text: true,
    image: false,
    references: false,
    maxReferences: 0,
    durationsMs: [6000],
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    audio: false,
    seed: false,
    cancel: false,
    concurrency: 1,
  };
  const output = {
    shots: [
      {
        sceneId: 'scene',
        characterIds: [],
        durationMs: 6000,
        purpose: 'opening',
        action: 'Rain falls',
        camera: 'wide',
        lighting: 'day',
        environment: 'forest',
        continuityIn: 'rain',
        continuityOut: 'sun',
        prompt: 'Rain',
        narration: 'Rain passes.',
      },
    ],
  };
  await assert.rejects(
    buildStoryboard(
      { project: p, episodeId: e.id, capabilities: caps },
      { llm: { complete: async () => ({ text: JSON.stringify(output) }) } },
      new AbortController().signal,
    ),
    /NARRATION_CHANGED/,
  );
  output.shots[0].narration = e.script.scenes[0].narration;
  const drafts = await buildStoryboard(
    { project: p, episodeId: e.id, capabilities: caps },
    { llm: { complete: async () => ({ text: JSON.stringify(output) }) } },
    new AbortController().signal,
  );
  assert.equal(drafts[0].snapshot.resolution, '720p');
  assert.equal(drafts[0].snapshot.durationMs, 6000);
});
