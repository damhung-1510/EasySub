import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('schema rejects malformed discovery turns and duplicate relation IDs', async () => {
  const { parseVideoProject } =
    await import('../../main/videoCreation/schemas');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const p = await createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'schema-')),
  ).create({ name: 'Film', kind: 'single' });
  assert.throws(
    () => parseVideoProject({ ...p, schemaVersion: 99 }),
    /UNSUPPORTED_SCHEMA/,
  );
  assert.throws(() =>
    parseVideoProject({
      ...p,
      discoverySessions: [{ id: 'session', apiKey: 'secret' }],
    }),
  );
  assert.throws(
    () => parseVideoProject({ ...p, episodes: [p.episodes[0], p.episodes[0]] }),
    /DUPLICATE_ID/,
  );
  assert.throws(
    () =>
      parseVideoProject({
        ...p,
        assets: [
          {
            id: 'bad',
            kind: 'image',
            relativePath: '../outside.png',
            sha256: 'a'.repeat(64),
            mimeType: 'image/png',
            bytes: 2,
            createdAt: 'now',
          },
        ],
      }),
    /UNSAFE_ASSET_PATH/,
  );
});

test('production shots require pinned approved location and style revisions', async () => {
  const { validateShot } = await import('../../main/videoCreation/schemas');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const p = await createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'world-pin-')),
  ).create({ name: 'Film', kind: 'single' });
  const shot = {
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
  const issues = validateShot(shot, p);
  assert.equal(
    issues.some((i) => i.code === 'LOCATION_REVISION_REQUIRED'),
    true,
  );
  assert.equal(
    issues.some((i) => i.code === 'STYLE_REVISION_REQUIRED'),
    true,
  );
});

test('confirmed canon events cannot be rewritten in place', async () => {
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'canon-immutable-')),
  );
  let p = await store.create({ name: 'Series', kind: 'series' });
  p = await store.update(p.id, p.version, (next) => {
    next.episodes[0].script = {
      id: 'script',
      revisionId: 'approved-script',
      createdAt: 'now',
      approvedAt: 'now',
      scenes: [],
    };
    next.canon.push({
      id: 'event',
      episodeId: next.episodes[0].id,
      episodeOrder: 1,
      effectiveFrom: 2,
      scriptRevisionId: 'approved-script',
      description: 'A promise',
      characterIds: [],
      acceptedAt: 'now',
    });
    return next;
  });
  await assert.rejects(
    store.update(p.id, p.version, (next) => {
      next.canon[0].description = 'Different story';
      return next;
    }),
    /APPROVED_REVISION_IMMUTABLE/,
  );
});
