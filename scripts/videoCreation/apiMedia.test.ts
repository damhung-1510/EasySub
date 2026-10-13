import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createAssetStore } from '../../main/videoCreation/assetStore';
import {
  validateMedia,
  resolveMediaFfmpeg,
} from '../../main/videoCreation/mediaProbe';
test('real images decode, deduplicate and survive deleted originals; invalid media fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-media-'));
  const source = path.join(root, 'portrait.png');
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
    source,
  ]);
  const store = createAssetStore(path.join(root, 'projects'));
  const a = await store.importReference(
    'project',
    source,
    new AbortController().signal,
  );
  const b = await store.importReference(
    'project',
    source,
    new AbortController().signal,
  );
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.width, 64);
  await unlink(source);
  assert.ok(
    (await readFile(store.resolve('project', a.relativePath))).length > 0,
  );
  const fake = path.join(root, 'fake.png');
  await writeFile(fake, 'not a picture');
  await assert.rejects(
    store.importReference('project', fake, new AbortController().signal),
    /INVALID_IMAGE/,
  );
  assert.throws(
    () => store.resolve('project', '../escape'),
    /ASSET_PATH_ESCAPE/,
  );
});
test('probe validates a real MP4 without ffprobe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-media-'));
  const file = path.join(root, 'clip.mp4');
  execFileSync(resolveMediaFfmpeg(), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=64x64:r=24',
    '-t',
    '0.5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
  const info = await validateMedia(file, 'video');
  assert.equal(info.width, 64);
  assert.ok(info.durationMs >= 450);
  assert.equal(info.mimeType, 'video/mp4');
});
test('asset resolution rejects symlink escapes before writing into a project', async () => {
  const { mkdir, symlink } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-media-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'video-outside-'));
  const projects = path.join(root, 'projects');
  await mkdir(projects);
  await symlink(outside, path.join(projects, 'project'));
  const store = createAssetStore(projects);
  assert.throws(
    () => store.resolve('project', 'assets/portrait.png'),
    /ASSET_PATH_ESCAPE/,
  );
});
