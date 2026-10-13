import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';

async function moduleUnderTest() {
  return import('../../main/videoCreation/assembly').catch(() => ({}) as any);
}
test('timeline uses measured durations and rejects missing accepted footage', async () => {
  const api = await moduleUnderTest();
  assert.equal(
    typeof api.buildTimeline,
    'function',
    'video timeline is not implemented',
  );
  const result = api.buildTimeline([
    { shotId: 'a', path: 'a.mp4', durationMs: 1100, accepted: true },
    { shotId: 'b', path: 'b.mp4', durationMs: 2300, accepted: true },
  ]);
  assert.equal(result.durationMs, 3400);
  assert.equal(result.shots[1].startMs, 1100);
  assert.throws(
    () =>
      api.buildTimeline([
        { shotId: 'c', path: '', durationMs: 0, accepted: false },
      ]),
    /TAKE_REQUIRED/,
  );
});
test('assembly normalizes different frame rates and exports a decodable MP4', async () => {
  const api = await moduleUnderTest();
  assert.equal(
    typeof api.assembleShots,
    'function',
    'video assembly is not implemented',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-assembly-'));
  try {
    const clips: any[] = [];
    for (const [index, fps] of [24, 30].entries()) {
      const output = path.join(root, `clip-${index}.mp4`);
      const generated = spawnSync(ffmpegPath!, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${index ? 'blue' : 'red'}:s=160x90:r=${fps}:d=0.5`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        output,
      ]);
      assert.equal(
        generated.status,
        0,
        String(generated.stderr || generated.error),
      );
      clips.push({
        shotId: String(index),
        path: output,
        durationMs: 500,
        accepted: true,
      });
    }
    const result = await api.assembleShots(
      {
        shots: clips,
        outputPath: path.join(root, 'out.mp4'),
        width: 320,
        height: 180,
        fps: 24,
        audioMode: 'mute',
      },
      { signal: new AbortController().signal },
    );
    assert.ok((await fs.stat(result.path)).size > 0);
    const decode = spawnSync(ffmpegPath!, [
      '-v',
      'error',
      '-i',
      result.path,
      '-f',
      'null',
      '-',
    ]);
    assert.equal(decode.status, 0, String(decode.stderr || decode.error));
    assert.ok(result.durationMs >= 900 && result.durationMs <= 1100);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
