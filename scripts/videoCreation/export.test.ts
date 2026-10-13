import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { path as ffmpeg } from '@ffmpeg-installer/ffmpeg';
test('native export creates local artifact and subtitle file from accepted shots', async () => {
  const api = await import('../../main/videoCreation/exportRunner').catch(
    () => ({}) as any,
  );
  assert.equal(typeof api.exportEpisode, 'function', 'video export missing');
  const { createProjectStore } =
    await import('../../main/videoCreation/projectStore');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-export-'));
  try {
    const project = await createProjectStore(root).create({
      name: 'Export',
      kind: 'single',
      audioMode: 'native',
    });
    const episode = project.episodes[0];
    const dir = path.join(root, project.id, 'assets');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'take.mp4');
    const generated = spawnSync(ffmpeg, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:r=24:d=0.5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    assert.equal(generated.status, 0, String(generated.stderr));
    const snapshot: any = {
      revisionId: 'shot-rev',
      durationMs: 500,
      audioMode: 'native',
      characterBindings: [],
      dialogues: [],
      narration: 'Hello',
    };
    episode.shots = [
      {
        id: 'shot',
        order: 1,
        snapshot,
        snapshots: [],
        selectedAttemptId: 'take',
        attempts: [
          {
            id: 'take',
            state: 'accepted',
            snapshot,
            artifacts: [
              { id: 'asset', kind: 'video', relativePath: 'assets/take.mp4' },
            ],
          },
        ],
      },
    ] as any;
    const result = await api.exportEpisode({
      root,
      project,
      episodeId: episode.id,
      options: { nativeAudioReviewed: true, width: 320, height: 180 },
      signal: new AbortController().signal,
    });
    assert.ok((await fs.stat(result.path)).size > 0);
    assert.match(await fs.readFile(result.subtitlePath, 'utf8'), /Hello/);
    assert.ok(result.asset.sha256.length === 64);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
