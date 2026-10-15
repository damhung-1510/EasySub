import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import type {
  DubbingSession,
  SessionCue,
} from '../../main/helpers/dubbing/dubbingProcessor';
import { readWavInfo } from '../../main/helpers/dubbing/audioPipeline';
import type { DubbingConfig } from '../../types/dubbing';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

// The processor pulls in Electron-backed modules; stub the ones this test never reaches.
const originalLoad = (Module as any)._load;
(Module as any)._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
  if (request.endsWith('/storeManager')) return { logMessage() {} };
  if (request.endsWith('/compose/composeQueue')) return {};
  if (request.endsWith('/ttsProviderManager'))
    return { getTtsProviderById: () => undefined };
  if (request.endsWith('/service/tts'))
    return { synthesizeSegment: async () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  previewDubMix,
} = require('../../main/helpers/dubbing/dubbingProcessor');
const RATE = 24000;

function toneWav(file: string, seconds: number, amplitude: number) {
  const samples = RATE * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    pcm.writeInt16LE(
      Math.round(32767 * amplitude * Math.sin((2 * Math.PI * 300 * i) / RATE)),
      i * 2,
    );
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

function rmsDb(file: string, fromSec: number, toSec: number): number {
  const info = readWavInfo(file);
  const buf = fs.readFileSync(file);
  const data = buf.subarray(buf.indexOf('data') + 8);
  const frame = 2 * info.channels;
  const from = Math.floor(fromSec * info.sampleRate) * frame;
  const to = Math.min(data.length, Math.floor(toSec * info.sampleRate) * frame);
  let sum = 0;
  let n = 0;
  for (let i = from; i + 1 < to; i += 2) {
    const v = data.readInt16LE(i) / 32768;
    sum += v * v;
    n += 1;
  }
  return 10 * Math.log10(sum / n);
}

function cue(
  index: number,
  startMs: number,
  wav?: string,
  ms = 2000,
): SessionCue {
  return {
    index,
    startMs,
    endMs: startMs + 3000,
    text: `line ${index}`,
    status: wav ? 'done' : 'pending',
    overlap: false,
    action: { type: 'none' },
    ...(wav ? { wavPath: wav, finalMs: ms } : {}),
  } as SessionCue;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsub-mixpreview-'));
  try {
    // 30 s video with a constant original tone (amplitude 0.3 sine at 1 kHz)
    const video = path.join(dir, 'v.mp4');
    execFileSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=30',
        '-f',
        'lavfi',
        '-i',
        'sine=f=1000:d=30,volume=2.4',
        '-shortest',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        video,
      ],
      { stdio: 'ignore' },
    );
    const lineWav = path.join(dir, 'line.wav');
    toneWav(lineWav, 2, 0.3);
    const workDir = path.join(dir, 'work');
    fs.mkdirSync(workDir);
    const session = {
      id: 's1',
      subtitlePath: path.join(dir, 'a.srt'),
      subtitleHash: 'x',
      videoPath: video,
      mediaDurationMs: 30000,
      cues: [
        cue(0, 1000, lineWav),
        cue(1, 5000, lineWav),
        cue(2, 12000, lineWav),
        cue(3, 20000), // not synthesized
      ],
      speakers: [],
      speakerVoiceMap: {},
      speakerVoiceConflicts: {},
      workDir,
      running: false,
      abort: null,
      calibration: { totalEstimatedMs: 0, totalMeasuredMs: 0 },
    } as unknown as DubbingSession;
    const config: DubbingConfig = {
      engine: { kind: 'cloud', providerId: 'p' },
      voice: 'v',
      globalSpeed: 1,
      background: 'duck',
      output: 'mixTrack',
    };

    // window 0-10 s holds two lines; the clip is 10 s long and mixes in the original
    const clip = await previewDubMix(session, config, {
      startMs: 0,
      durationMs: 10000,
    });
    assert.equal(clip.cueCount, 2);
    assert.equal(clip.withOriginal, true);
    assert.equal(clip.durationMs, 10000);
    const info = readWavInfo(clip.wavPath);
    assert.ok(
      Math.abs(info.durationMs - 10000) < 150,
      `length ${info.durationMs}`,
    );
    // original is lowered while a line plays (1-3 s) versus untouched silence gap (3.5-4.5 s)
    const duringLine = rmsDb(clip.wavPath, 1.5, 2.5);
    const alone = rmsDb(clip.wavPath, 3.6, 4.6);
    assert.ok(alone > -19 && alone < -10, `original alone, got ${alone}`);
    assert.ok(Number.isFinite(duringLine));

    // Each preview replaces the previous file, so measure right after building it.
    const lineLevel = async (extra: Partial<DubbingConfig>) => {
      const result = await previewDubMix(
        session,
        { ...config, ...extra },
        { startMs: 0, durationMs: 10000 },
      );
      return { result, db: rmsDb(result.wavPath, 1.2, 2.8) };
    };

    // stronger ducking must not leave the original louder than light ducking
    const light = await lineLevel({ duckLevel: 'light' });
    const strong = await lineLevel({ duckLevel: 'strong' });
    assert.ok(
      strong.db <= light.db + 0.2,
      `strong ${strong.db} vs light ${light.db}`,
    );

    // a +12 dB voice gain makes the line window louder; only mixTrack keeps the original
    const plain = await lineLevel({ output: 'replaceTrack' });
    const boosted = await lineLevel({
      output: 'replaceTrack',
      voiceGainDb: 12,
    });
    assert.equal(plain.result.withOriginal, false);
    assert.ok(
      boosted.db > plain.db + 6,
      `voice gain is audible: ${plain.db} -> ${boosted.db}`,
    );

    // a window that cuts into a line starts at that line
    const snapped = await previewDubMix(session, config, {
      startMs: 5500,
      durationMs: 5000,
    });
    assert.equal(snapped.startMs, 5000);

    // nothing synthesized in the window
    await assert.rejects(
      previewDubMix(session, config, { startMs: 20000, durationMs: 5000 }),
      /đã tạo|已生成/,
    );

    // only the newest preview file is kept
    const previews = fs
      .readdirSync(workDir)
      .filter((f) => f.startsWith('mix-preview-') && f.endsWith('.wav'));
    assert.equal(
      previews.length,
      1,
      `old previews are removed, found ${previews.length}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('mix preview OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
