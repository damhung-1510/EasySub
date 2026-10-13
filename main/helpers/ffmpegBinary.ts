import { existsSync } from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import installer from '@ffmpeg-installer/ffmpeg';
/** Prefer the app's static build; development installations may only contain the installer binary. */
export function resolveFfmpegBinary(): string {
  for (const file of [ffmpegStatic, installer.path]) {
    const candidate = file?.replace('app.asar', 'app.asar.unpacked');
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('FFMPEG_UNAVAILABLE');
}
