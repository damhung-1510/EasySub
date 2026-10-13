import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { existsSync } from 'node:fs';
export interface MediaInfo {
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  fps?: number;
  hasAudio: boolean;
}
const execute = promisify(execFile);
export function resolveMediaFfmpeg(): string {
  for (const candidate of [ffmpegStatic, ffmpegInstaller.path]) {
    if (candidate) {
      const resolved = candidate.replace('app.asar', 'app.asar.unpacked');
      if (existsSync(resolved)) return resolved;
    }
  }
  throw Error('FFMPEG_UNAVAILABLE');
}
export async function validateMedia(
  file: string,
  kind: 'image' | 'video',
  signal?: AbortSignal,
): Promise<MediaInfo> {
  signal?.throwIfAborted();
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0)
    throw Error(kind === 'image' ? 'INVALID_IMAGE' : 'INVALID_VIDEO');
  if (kind === 'image' && stat.size > 20 * 1024 * 1024)
    throw Error('IMAGE_TOO_LARGE');
  const handle = await fs.open(file, 'r');
  const header = Buffer.alloc(32);
  try {
    await handle.read(header, 0, 32, 0);
  } finally {
    await handle.close();
  }
  let mimeType = '';
  if (
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mimeType = 'image/png';
  else if (header[0] === 255 && header[1] === 216 && header[2] === 255)
    mimeType = 'image/jpeg';
  else if (
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP'
  )
    mimeType = 'image/webp';
  else if (header.toString('ascii', 4, 8) === 'ftyp') mimeType = 'video/mp4';
  if (
    (kind === 'image' && !mimeType.startsWith('image/')) ||
    (kind === 'video' && mimeType !== 'video/mp4')
  )
    throw Error(kind === 'image' ? 'INVALID_IMAGE' : 'INVALID_VIDEO');
  const binary = resolveMediaFfmpeg();
  let diagnostic = '';
  try {
    const result = await execute(binary, ['-hide_banner', '-i', file], {
      signal,
      maxBuffer: 1024 * 1024,
    });
    diagnostic = result.stderr;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw Error('FFMPEG_UNAVAILABLE');
    if (signal?.aborted) signal.throwIfAborted();
    diagnostic = String((error as { stderr?: string }).stderr || '');
  }
  const dimension = diagnostic.match(/Video:.*?\b(\d{1,6})x(\d{1,6})\b/);
  if (!dimension)
    throw Error(kind === 'image' ? 'INVALID_IMAGE' : 'INVALID_VIDEO');
  const width = Number(dimension[1]),
    height = Number(dimension[2]);
  if (width * height > 40_000_000) throw Error('IMAGE_PIXEL_LIMIT');
  const duration = diagnostic.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationMs = duration
    ? Math.round(
        (Number(duration[1]) * 3600 +
          Number(duration[2]) * 60 +
          Number(duration[3])) *
          1000,
      )
    : 0;
  if (kind === 'video' && durationMs <= 0)
    throw Error('INVALID_VIDEO_DURATION');
  try {
    await execute(
      binary,
      [
        '-v',
        'error',
        '-xerror',
        '-i',
        file,
        '-map',
        '0:v:0',
        '-f',
        'null',
        '-',
      ],
      { signal, maxBuffer: 1024 * 1024 },
    );
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    throw Error(kind === 'image' ? 'INVALID_IMAGE' : 'INVALID_VIDEO');
  }
  const fps = diagnostic.match(/(\d+(?:\.\d+)?) fps/);
  return {
    mimeType,
    bytes: stat.size,
    width,
    height,
    durationMs,
    fps: fps ? Number(fps[1]) : undefined,
    hasAudio: /Audio:/.test(diagnostic),
  };
}
