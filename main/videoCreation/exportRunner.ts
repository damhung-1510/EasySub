import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { VideoProject, MediaAsset } from '../../types/videoProject';
import type { DubbingConfig } from '../../types/dubbing';
import {
  assembleShots,
  buildTimeline,
  inspectMedia,
  runFfmpeg,
} from './assembly';
import {
  buildSpeechCues,
  subtitleText,
  buildEpisodeAudio,
  validateVoiceAssignments,
} from './audioBridge';
import { assertDubbingConfig } from '../../types/dubbing';
export async function exportEpisode(input: {
  root: string;
  project: VideoProject;
  episodeId: string;
  options: Record<string, unknown>;
  signal: AbortSignal;
  onProgress?: (n: number) => void;
}) {
  const { project, options, signal } = input;
  const episode = project.episodes.find((e) => e.id === input.episodeId);
  if (!episode) throw new Error('EPISODE_NOT_FOUND');
  const accepted = episode.shots
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((shot) => {
      const attempt = shot.attempts.find(
        (a) => a.id === shot.selectedAttemptId,
      );
      if (
        shot.stale ||
        !attempt ||
        attempt.state !== 'accepted' ||
        (attempt.snapshot.revisionId !== shot.snapshot.revisionId &&
          shot.keepOldDecision?.attemptId !== attempt.id)
      )
        throw new Error('TAKE_REQUIRED');
      const asset = attempt.artifacts.find((a) => a.kind === 'video');
      if (!asset) throw new Error('TAKE_REQUIRED');
      if (
        path.isAbsolute(asset.relativePath) ||
        asset.relativePath.split('/').includes('..')
      )
        throw new Error('INVALID_ASSET_PATH');
      return {
        shot: { ...shot, snapshot: attempt.snapshot },
        asset,
        file: path.join(input.root, project.id, asset.relativePath),
      };
    });
  const native = episode.audioMode === 'native';
  if (native && options.nativeAudioReviewed !== true)
    throw new Error('NATIVE_AUDIO_REVIEW_REQUIRED');
  if (!native && options.audioAuthorized !== true)
    throw new Error('COST_AUTHORIZATION_REQUIRED');
  const directory = await fs.mkdtemp(
    path.join(input.root, project.id, '.export-'),
  );
  const final = path.join(
    input.root,
    project.id,
    'assets',
    `export-${randomUUID()}.mp4`,
  );
  await fs.mkdir(path.dirname(final), { recursive: true });
  try {
    const media = [];
    for (const item of accepted) {
      const info = await inspectMedia(item.file, signal);
      media.push({
        shotId: item.shot.id,
        path: item.file,
        durationMs: info.durationMs,
        accepted: true,
      });
    }
    const timeline = buildTimeline(media);
    const cues = buildSpeechCues(
      timeline.shots.map((s, i) => ({
        ...s,
        snapshot: accepted[i].shot.snapshot,
      })),
    );
    const config = options.dubbingConfig as DubbingConfig;
    // Resolve each role's voice from the pinned character revision used to generate its shots.
    const pinnedCharacters = structuredClone(project.characters);
    for (const c of pinnedCharacters) {
      const bindings = accepted
        .flatMap((a) => a.shot.snapshot.characterBindings)
        .filter((b) => b.characterId === c.id);
      const revisions = [
        ...new Set(bindings.map((b) => b.characterRevisionId)),
      ];
      if (revisions.length > 1) {
        const voices = revisions.map((id) =>
          JSON.stringify(c.revisions.find((r) => r.revisionId === id)?.voice),
        );
        if (new Set(voices).size > 1) throw new Error('MIXED_VOICE_REVISIONS');
      }
      if (revisions[0]) c.currentRevisionId = revisions[0];
    }
    if (!native) {
      assertDubbingConfig(config);
      validateVoiceAssignments(cues, pinnedCharacters, config);
    }
    const subtitlePath = path.join(
      path.dirname(final),
      path.basename(final, '.mp4') + '.srt',
    );
    await fs.writeFile(subtitlePath, subtitleText(cues));
    const assembly = await assembleShots(
      {
        shots: media,
        outputPath: path.join(directory, 'assembly.mp4'),
        width: typeof options.width === 'number' ? options.width : 1920,
        height: typeof options.height === 'number' ? options.height : 1080,
        fps: 24,
        audioMode: native ? 'native' : 'mute',
      },
      { signal, onProgress: (n) => input.onProgress?.(n * 0.65) },
    );
    let trackPath: string | undefined;
    if (!native && cues.length) {
      const audio = await buildEpisodeAudio({
        cues,
        characters: pinnedCharacters,
        videoPath: assembly.path,
        directory: path.join(directory, 'audio'),
        config,
        signal,
      });
      trackPath = audio.trackPath;
    }
    const args = ['-y', '-i', assembly.path];
    if (trackPath) args.push('-i', trackPath);
    if (cues.length) args.push('-i', subtitlePath);
    args.push('-map', '0:v:0');
    if (trackPath) args.push('-map', '1:a:0');
    else if (native) args.push('-map', '0:a:0?');
    if (cues.length)
      args.push('-map', `${trackPath ? 2 : 1}:s:0`, '-c:s', 'mov_text');
    args.push(
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-t',
      String(timeline.durationMs / 1000),
      '-movflags',
      '+faststart',
      path.join(directory, 'final.mp4'),
    );
    await runFfmpeg(args, signal);
    const info = await inspectMedia(path.join(directory, 'final.mp4'), signal);
    await fs.rename(path.join(directory, 'final.mp4'), final);
    const bytes = await fs.readFile(final);
    const asset: MediaAsset = {
      id: randomUUID(),
      kind: 'video',
      relativePath: path
        .relative(path.join(input.root, project.id), final)
        .split(path.sep)
        .join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      mimeType: 'video/mp4',
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      createdAt: new Date().toISOString(),
    };
    const subtitleBytes = await fs.readFile(subtitlePath);
    const subtitleAsset: MediaAsset = {
      id: randomUUID(),
      kind: 'subtitle',
      relativePath: path
        .relative(path.join(input.root, project.id), subtitlePath)
        .split(path.sep)
        .join('/'),
      sha256: createHash('sha256').update(subtitleBytes).digest('hex'),
      bytes: subtitleBytes.length,
      mimeType: 'application/x-subrip',
      createdAt: new Date().toISOString(),
    };
    if (
      typeof options.outputPath === 'string' &&
      options.outputPath !== final
    ) {
      const staged = path.join(
        path.dirname(options.outputPath),
        `.${randomUUID()}.mp4`,
      );
      try {
        await fs.copyFile(final, staged);
        signal.throwIfAborted();
        await fs.rename(staged, options.outputPath);
      } finally {
        await fs.rm(staged, { force: true });
      }
    }
    input.onProgress?.(100);
    return {
      path: typeof options.outputPath === 'string' ? options.outputPath : final,
      localPath: final,
      subtitlePath,
      durationMs: info.durationMs,
      asset,
      subtitleAsset,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
