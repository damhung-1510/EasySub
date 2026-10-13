import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
async function setup() {
  const mod = await import('../../main/videoCreation/backup').catch(
    () => ({}) as any,
  );
  assert.equal(
    typeof mod.exportProjectBackup,
    'function',
    'project backup not implemented',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-backup-'));
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  return { mod, root, store: createProjectStore(path.join(root, 'projects')) };
}
test('backup restores a separate project without resuming copied remote jobs', async () => {
  const { mod, root, store } = await setup();
  try {
    const p = await store.create({ name: 'Original', kind: 'series' });
    await mod.exportProjectBackup({
      project: p,
      root: path.join(root, 'projects'),
      destination: path.join(root, 'backup'),
    });
    const restored = await mod.importProjectBackup({
      root: path.join(root, 'projects'),
      source: path.join(root, 'backup'),
    });
    assert.notEqual(restored.id, p.id);
    assert.equal(restored.resumeRemoteJobs, false);
    assert.equal((await store.load(restored.id)).name, p.name);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('restore rejects forged asset hash before publishing a project', async () => {
  const { mod, root, store } = await setup();
  try {
    const p = await store.create({ name: 'Original', kind: 'single' });
    p.assets.push({
      id: 'asset',
      kind: 'image',
      relativePath: 'assets/a.png',
      sha256: '0'.repeat(64),
      mimeType: 'image/png',
      bytes: 3,
      createdAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, 'bad', 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'bad', 'project.json'),
      JSON.stringify(p),
    );
    await fs.writeFile(path.join(root, 'bad', 'assets', 'a.png'), 'bad');
    await assert.rejects(
      mod.importProjectBackup({
        root: path.join(root, 'projects'),
        source: path.join(root, 'bad'),
      }),
      /ASSET_HASH_MISMATCH/,
    );
    assert.equal((await store.list()).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
