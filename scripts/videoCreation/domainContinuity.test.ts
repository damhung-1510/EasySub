import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('canon cannot be accepted from drafts and later episodes stay out of context', async () => {
  const { acceptCanonDelta } = await import('../../main/videoCreation/canon');
  const { buildScriptContext } =
    await import('../../main/videoCreation/contextBuilder');
  const { createProjectStore, createEpisode } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'canon-')),
  );
  const p = await store.create({ name: 'Series', kind: 'series' });
  const episode = p.episodes[0];
  episode.script = { id: 's', revisionId: 'rev', createdAt: 'now', scenes: [] };
  assert.throws(
    () =>
      acceptCanonDelta(
        p,
        {
          episodeId: episode.id,
          scriptRevisionId: 'rev',
          events: [{ description: 'Won', characterIds: [] }],
        },
        p.version,
      ),
    /SCRIPT_NOT_APPROVED/,
  );
  episode.script.approvedAt = 'now';
  const next = acceptCanonDelta(
    p,
    {
      episodeId: episode.id,
      scriptRevisionId: 'rev',
      events: [{ description: 'Won', characterIds: [] }],
    },
    p.version,
  );
  next.episodes.push(createEpisode({ order: 2 }));
  next.canon.push({
    ...next.canon[0],
    id: 'future',
    episodeOrder: 5,
    effectiveFrom: 6,
  });
  assert.equal(
    buildScriptContext(next, next.episodes[1].id).canon.some(
      (e) => e.episodeOrder === 5,
    ),
    false,
  );
});
test('revision dependencies mark only affected shots and keep attempts intact', async () => {
  const { affectedShots, migrateShots } =
    await import('../../main/videoCreation/dependencies');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'deps-')),
  );
  const p = await store.create({ name: 'Film', kind: 'single' });
  const snapshot = {
    id: 'a',
    revisionId: 'a1',
    createdAt: 'now',
    briefRevisionId: 'brief',
    scriptRevisionId: 'script',
    sceneId: 'scene',
    characterBindings: [
      {
        characterId: 'person',
        characterRevisionId: 'person1',
        referenceAssetIds: [],
      },
    ],
    prompt: 'walk',
    durationMs: 6000,
    audioMode: 'narration' as const,
    aspectRatio: '16:9',
    resolution: '1080p',
  };
  p.episodes[0].shots = [
    {
      id: 'a',
      order: 0,
      snapshot,
      snapshots: [snapshot],
      attempts: [
        {
          id: 'running-attempt',
          snapshot: structuredClone(snapshot),
          snapshotHash: 'original-hash',
          providerId: 'provider',
          modelId: 'model',
          providerConfigRevisionId: 'config-rev',
          remoteJobId: 'remote-original',
          state: 'running',
          artifacts: [],
          createdAt: 'now',
          updatedAt: 'now',
        },
      ],
    },
    {
      id: 'b',
      order: 1,
      snapshot: { ...snapshot, id: 'b', characterBindings: [] },
      snapshots: [],
      attempts: [],
    },
  ];
  assert.deepEqual(
    affectedShots(p, [
      { kind: 'character', id: 'person', revisionId: 'person1' },
    ]),
    ['a'],
  );
  const next = migrateShots(p, ['a'], (s) => ({
    ...s,
    characterBindings: s.characterBindings.map((b) => ({
      ...b,
      characterRevisionId: 'person2',
    })),
  }));
  assert.equal(next.episodes[0].shots[0].stale, true);
  assert.equal(
    next.episodes[0].shots[0].attempts[0].snapshot.characterBindings[0]
      .characterRevisionId,
    'person1',
  );
  assert.equal(
    next.episodes[0].shots[0].attempts[0].remoteJobId,
    'remote-original',
  );
  assert.equal(next.episodes[0].shots[1].stale, undefined);
  assert.equal(
    p.episodes[0].shots[0].snapshot.characterBindings[0].characterRevisionId,
    'person1',
  );
});

test('approving an unchanged shot does not stale its production inputs', async () => {
  const { markChangedSnapshotsStale } =
    await import('../../main/videoCreation/dependencies');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const p = await createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'approval-')),
  ).create({ name: 'Film', kind: 'single' });
  const snapshot = {
    id: 'shot',
    revisionId: 'rev',
    createdAt: 'now',
    briefRevisionId: 'brief',
    scriptRevisionId: 'script',
    sceneId: 'scene',
    characterBindings: [],
    prompt: 'Rain',
    durationMs: 6000,
    audioMode: 'narration' as const,
    aspectRatio: '16:9',
    resolution: '1080p',
  };
  p.episodes[0].shots = [
    { id: 'shot', order: 1, snapshot, snapshots: [], attempts: [] },
  ];
  const next = structuredClone(p);
  next.episodes[0].shots[0].snapshot.approvedAt = 'now';
  markChangedSnapshotsStale(p, next);
  assert.notEqual(next.episodes[0].shots[0].stale, true);
});
