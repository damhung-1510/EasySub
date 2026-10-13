import { spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { path as installerBin } from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import { randomUUID } from 'crypto';
import ffmpegStatic from 'ffmpeg-static';

export interface AssemblyShot {
  shotId: string;
  path: string;
  durationMs: number;
  accepted: boolean;
}
export interface AssemblyInput {
  shots: AssemblyShot[];
  outputPath: string;
  width?: number;
  height?: number;
  fps?: number;
  audioMode: 'native' | 'mute';
}
export interface AssemblyContext {
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}
const preferredBin = ffmpegStatic!.replace('app.asar', 'app.asar.unpacked');
const bin = existsSync(preferredBin)
  ? preferredBin
  : installerBin.replace('app.asar', 'app.asar.unpacked');
export function buildTimeline(shots: AssemblyShot[]) {
  if (!shots.length) throw new Error('TAKE_REQUIRED');
  let startMs = 0;
  const timeline = shots.map((shot) => {
    if (
      !shot.accepted ||
      !shot.path ||
      !Number.isFinite(shot.durationMs) ||
      shot.durationMs <= 0
    )
      throw new Error('TAKE_REQUIRED');
    const result = { ...shot, startMs };
    startMs += shot.durationMs;
    return result;
  });
  return { shots: timeline, durationMs: startMs };
}
export function runFfmpeg(
  args: string[],
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error('CANCELLED'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk) => {
      tail = (tail + chunk.toString()).slice(-12000);
    });
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new Error('CANCELLED'));
      else if (code === 0) resolve(tail);
      else reject(new Error(`FFMPEG_FAILED: ${tail}`));
    });
  });
}
export async function inspectMedia(
  file: string,
  signal = new AbortController().signal,
) {
  // ffmpeg -i exits 1 even for valid input; use an output null probe to validate decode and metadata.
  const stderr = await runFfmpeg(
    ['-hide_banner', '-i', file, '-t', '0.01', '-f', 'null', '-'],
    signal,
  );
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) throw new Error('INVALID_MEDIA_DURATION');
  const durationMs =
    (+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000 +
    Number(match[4].padEnd(3, '0').slice(0, 3));
  const video =
    stderr.split('\n').find((line) => /Stream.*Video:/.test(line)) || '';
  const dimensions = video.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const fps = video.match(/([\d.]+) fps/);
  return {
    durationMs,
    width: dimensions ? +dimensions[1] : undefined,
    height: dimensions ? +dimensions[2] : undefined,
    fps: fps ? +fps[1] : undefined,
    hasAudio: /Stream.*Audio:/.test(stderr),
  };
}
export async function assembleShots(
  input: AssemblyInput,
  ctx: AssemblyContext,
) {
  buildTimeline(input.shots);
  const width = input.width ?? 1920,
    height = input.height ?? 1080,
    fps = input.fps ?? 24;
  if (
    ![width, height, fps].every((n) => Number.isFinite(n) && n > 0) ||
    width % 2 ||
    height % 2 ||
    width > 4096 ||
    height > 4096 ||
    fps > 60
  )
    throw new Error('INVALID_OUTPUT_SIZE');
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const working = await fs.mkdtemp(
    path.join(path.dirname(input.outputPath), '.assembly-'),
  );
  const staged = path.join(
    path.dirname(input.outputPath),
    `.${randomUUID()}.mp4`,
  );
  try {
    const files: string[] = [];
    for (let i = 0; i < input.shots.length; i++) {
      const shot = input.shots[i];
      const info = await inspectMedia(shot.path, ctx.signal);
      const out = path.join(working, `${i}.mp4`);
      const args = ['-y', '-hide_banner', '-i', shot.path];
      if (input.audioMode === 'native' && !info.hasAudio)
        args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      args.push(
        '-map',
        '0:v:0',
        '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
      );
      if (input.audioMode === 'native')
        args.push(
          '-map',
          info.hasAudio ? '0:a:0' : '1:a:0',
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-t',
          String(info.durationMs / 1000),
        );
      else args.push('-an');
      args.push(out);
      await runFfmpeg(args, ctx.signal);
      files.push(out);
      ctx.onProgress?.(Math.round(((i + 1) / (input.shots.length + 1)) * 100));
    }
    // Controlled filenames are relative and never contain arbitrary input in concat syntax.
    await fs.writeFile(
      path.join(working, 'concat.txt'),
      files.map((_, i) => `file '${i}.mp4'`).join('\n'),
    );
    await runFfmpeg(
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '1',
        '-i',
        path.join(working, 'concat.txt'),
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        staged,
      ],
      ctx.signal,
    );
    const metadata = await inspectMedia(staged, ctx.signal);
    await fs.rename(staged, input.outputPath);
    ctx.onProgress?.(100);
    return { path: input.outputPath, ...metadata };
  } finally {
    await fs.rm(working, { recursive: true, force: true });
    await fs.rm(staged, { force: true });
  }
}
