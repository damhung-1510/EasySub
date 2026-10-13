import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('project store preserves drafts, serializes concurrent CAS and recovers last good state', async () => {
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  assert.equal(typeof createProjectStore, 'function');
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-domain-'));
  const store = createProjectStore(root);
  const project = await store.create({ name: 'Story', kind: 'series' });
  const writes = await Promise.allSettled([
    store.update(project.id, 1, (p) => ({ ...p, name: 'A' })),
    store.update(project.id, 1, (p) => ({ ...p, name: 'B' })),
  ]);
  assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await createProjectStore(root).load(project.id)).version, 2);
  const manifest = path.join(root, project.id, 'project.json');
  await writeFile(manifest, '{broken');
  assert.equal((await store.load(project.id)).version, 1);
  assert.equal(await readFile(manifest, 'utf8'), '{broken');
});

test('approved snapshots cannot be edited or removed', async () => {
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const store = createProjectStore(
    await mkdtemp(path.join(os.tmpdir(), 'video-approved-')),
  );
  let p = await store.create({ name: 'Film', kind: 'single' });
  p = await store.update(p.id, p.version, (draft) => {
    draft.episodes[0].script = {
      id: 'script',
      revisionId: 'rev',
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      scenes: [],
    };
    return draft;
  });
  await assert.rejects(
    store.update(p.id, p.version, (draft) => {
      draft.episodes[0].script!.scenes.push({
        id: 's',
        location: 'Room',
        time: 'Day',
        characterIds: [],
        action: 'changed',
        dialogues: [],
        narration: '',
        sound: '',
        durationMs: 1000,
      });
      return draft;
    }),
    /APPROVED_REVISION_IMMUTABLE/,
  );
});

test('an atomic manifest failure leaves the committed project intact', async () => {
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const { atomicReplaceTextFile } =
    await import('../../main/helpers/atomicFile');
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-atomic-'));
  let fail = false;
  const store = createProjectStore(root, {
    write: async (target, content) => {
      if (fail && target.endsWith('/project.json'))
        throw new Error('injected rename failure');
      await atomicReplaceTextFile(target, content);
    },
  });
  const p = await store.create({ name: 'Keep me', kind: 'single' });
  const before = await readFile(path.join(root, p.id, 'project.json'), 'utf8');
  fail = true;
  await assert.rejects(
    store.update(p.id, 1, (draft) => ({ ...draft, name: 'Lost change' })),
    /rename failure/,
  );
  assert.equal(
    await readFile(path.join(root, p.id, 'project.json'), 'utf8'),
    before,
  );
  assert.equal((await store.load(p.id)).name, 'Keep me');
});
