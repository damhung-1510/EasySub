import fs from 'fs/promises';
import path from 'path';
import type { ShotSnapshot, Character } from '../../types/videoProject';
import type { DubbingConfig } from '../../types/dubbing';
export interface SpeechCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
}
export function buildSpeechCues(
  shots: {
    shotId: string;
    startMs: number;
    durationMs: number;
    snapshot: Pick<ShotSnapshot, 'narration' | 'dialogues'>;
  }[],
): SpeechCue[] {
  const cues: SpeechCue[] = [];
  for (const shot of shots) {
    const segments = [
      ...(shot.snapshot.narration?.trim()
        ? [{ text: shot.snapshot.narration.trim(), speakerId: undefined }]
        : []),
      ...(shot.snapshot.dialogues || []).filter((v) => v.text.trim()),
    ];
    const weights = segments.map((v) =>
      Math.max(1, v.text.trim().split(/\s+/).length),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = shot.startMs;
    segments.forEach((segment, i) => {
      const end =
        i === segments.length - 1
          ? shot.startMs + shot.durationMs
          : cursor + Math.round((shot.durationMs * weights[i]) / total);
      cues.push({
        index: cues.length,
        startMs: cursor,
        endMs: end,
        text: segment.text,
        speakerId: segment.speakerId,
      });
      cursor = end;
    });
  }
  return cues;
}
export function validateVoiceAssignments(
  cues: Pick<SpeechCue, 'speakerId' | 'text'>[],
  characters: Character[],
  config: Pick<DubbingConfig, 'voice' | 'engine'>,
) {
  if (cues.some((c) => !c.speakerId) && !config.voice)
    throw new Error('NARRATOR_VOICE_REQUIRED');
  for (const cue of cues) {
    if (!cue.speakerId) continue;
    const c = characters.find((c) => c.id === cue.speakerId);
    const voice = c?.revisions.find(
      (r) => r.revisionId === c.currentRevisionId,
    )?.voice;
    if (!voice?.voiceId)
      throw new Error('VOICE_REQUIRED: ' + (c?.name || cue.speakerId));
    const provider =
      config.engine.kind === 'cloud'
        ? config.engine.providerId
        : 'local:' + config.engine.modelId;
    if (voice.providerId !== provider)
      throw new Error('VOICE_PROVIDER_MISMATCH: ' + c!.name);
  }
}
function time(ms: number) {
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60,
    n = Math.round(ms) % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(n).padStart(3, '0')}`;
}
export function subtitleText(cues: SpeechCue[]) {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${time(c.startMs)} --> ${time(c.endMs)}\n${c.text.replace(/\r/g, '')}\n`,
    )
    .join('\n');
}
export async function buildEpisodeAudio(input: {
  cues: SpeechCue[];
  characters: Character[];
  videoPath: string;
  directory: string;
  config: DubbingConfig;
  signal: AbortSignal;
}) {
  validateVoiceAssignments(input.cues, input.characters, input.config);
  await fs.mkdir(input.directory, { recursive: true });
  const subtitlePath = path.join(input.directory, 'speech.srt');
  await fs.writeFile(subtitlePath, subtitleText(input.cues));
  const api = await import('../helpers/dubbing/dubbingProcessor');
  const session = await api.createDubbingSession(
    subtitlePath,
    input.videoPath,
    undefined,
    input.config.language,
  );
  const speakerIds = [
    ...new Set(input.cues.map((c) => c.speakerId).filter(Boolean)),
  ];
  session.speakers = speakerIds.map((id, i) => ({
    id: i + 1,
    name: input.characters.find((c) => c.id === id)?.name || id!,
    color: '#ffffff',
    cueCount: input.cues.filter((c) => c.speakerId === id).length,
    totalDurationMs: input.cues
      .filter((c) => c.speakerId === id)
      .reduce((a, c) => a + c.endMs - c.startMs, 0),
  }));
  session.speakerVoiceMap = {};
  speakerIds.forEach((id, i) => {
    const character = input.characters.find((c) => c.id === id)!;
    const voice = character.revisions.find(
      (r) => r.revisionId === character.currentRevisionId,
    )!.voice!;
    session.speakerVoiceMap[String(i + 1)] = voice.voiceId;
  });
  session.cues.forEach((cue, i) => {
    const id = input.cues[i].speakerId;
    if (id) {
      cue.primarySpeakerId = speakerIds.indexOf(id) + 1;
      cue.speakerIds = [cue.primarySpeakerId];
    }
  });
  const cancel = () => api.cancelDubbing(session);
  input.signal.addEventListener('abort', cancel, { once: true });
  try {
    input.signal.throwIfAborted();
    await api.runDubbingBatch(session, input.config, () => {});
    input.signal.throwIfAborted();
    if (session.cues.some((c) => c.status === 'failed' || !c.wavPath))
      throw new Error('TTS_FAILED');
    if (
      session.cues.some(
        (c) =>
          c.status === 'overlong' ||
          (c.finalMs || 0) > c.endMs - c.startMs + 30,
      )
    )
      throw new Error('DIALOGUE_TOO_LONG');
    const track = await api.buildDubTrack(session, {
      config: input.config,
      overflow: 'truncate',
      overlapMode: 'mix',
      signal: input.signal,
    });
    if (track.skippedIndexes.length) throw new Error('TTS_INCOMPLETE');
    return { trackPath: track.trackPath, subtitlePath };
  } finally {
    input.signal.removeEventListener('abort', cancel);
    api.flushDubbingSession(session);
    api.disposeDubbingSession(session.id);
  }
}
