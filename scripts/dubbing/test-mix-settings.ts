import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyVoiceMixSettings,
  buildVoiceMixFilters,
  readWavInfo,
} from '../../main/helpers/dubbing/audioPipeline';
import {
  DUBBING_DUCK_RATIO,
  assertDubbingConfig,
  dubbingMixSettings,
  type DubbingConfig,
} from '../../types/dubbing';
import { parseDubbingPreferences } from '../../types/dubbingConfigDraft';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');
const RATE = 24000;

function toneWav(file: string, seconds: number, amplitude: number, hz = 220) {
  const samples = RATE * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(
      Math.round(32767 * amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)),
      i * 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

/** RMS in dBFS over [fromSec, toSec) of a mono or stereo 16-bit wav. */
function rmsDb(file: string, fromSec = 0, toSec = Infinity): number {
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

async function main() {
  // ── settings and validation ──
  assert.deepEqual(buildVoiceMixFilters({ gainDb: 0, normalize: false }), []);
  assert.ok(
    buildVoiceMixFilters({ gainDb: 6, normalize: false }).some((f) =>
      f.startsWith('volume=6dB'),
    ),
  );
  assert.equal(dubbingMixSettings({}).duckRatio, DUBBING_DUCK_RATIO.medium);
  assert.equal(
    DUBBING_DUCK_RATIO.medium,
    8,
    'medium keeps the old fixed ratio',
  );
  assert.deepEqual(dubbingMixSettings({}), {
    gainDb: 0,
    duckRatio: 8,
    normalize: false,
  });
  const base: DubbingConfig = {
    engine: { kind: 'cloud', providerId: 'p' },
    voice: 'v',
    globalSpeed: 1,
    background: 'mute',
    output: 'audioOnly',
  };
  assertDubbingConfig(base);
  assertDubbingConfig({
    ...base,
    voiceGainDb: -12,
    duckLevel: 'strong',
    normalizeVoice: true,
  });
  assert.throws(() => assertDubbingConfig({ ...base, voiceGainDb: 13 }));
  assert.throws(() => assertDubbingConfig({ ...base, voiceGainDb: -13 }));
  assert.throws(() => assertDubbingConfig({ ...base, duckLevel: 'max' }));
  assert.throws(() => assertDubbingConfig({ ...base, normalizeVoice: 1 }));
  // drafts saved before these settings existed still parse
  const legacy = {
    engineKey: '',
    voice: '',
    globalSpeed: 1,
    background: 'mute',
    output: 'replaceTrack',
    audioFormat: 'wav',
    overflow: 'truncate',
    exportShiftedSubtitle: false,
  };
  assert.doesNotThrow(() => parseDubbingPreferences(legacy));
  assert.throws(() => parseDubbingPreferences({ ...legacy, voiceGainDb: 99 }));

  // ── real audio ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsub-mix-'));
  try {
    const src = path.join(dir, 'src.wav');
    toneWav(src, 2, 0.1);
    const before = rmsDb(src);

    const same = path.join(dir, 'same.wav');
    await applyVoiceMixSettings(src, same, { gainDb: 0, normalize: false });
    assert.ok(Math.abs(rmsDb(same) - before) < 0.05, 'no settings, no change');

    const louder = path.join(dir, 'louder.wav');
    await applyVoiceMixSettings(src, louder, { gainDb: 6, normalize: false });
    assert.ok(
      Math.abs(rmsDb(louder) - before - 6) < 0.3,
      `+6 dB, got ${rmsDb(louder) - before}`,
    );
    const quieter = path.join(dir, 'quieter.wav');
    await applyVoiceMixSettings(src, quieter, { gainDb: -6, normalize: false });
    assert.ok(Math.abs(rmsDb(quieter) - before + 6) < 0.3, '-6 dB');
    assert.equal(readWavInfo(louder).sampleRate, RATE, 'format is kept');

    // a boost must not clip
    const hot = path.join(dir, 'hot.wav');
    toneWav(hot, 1, 0.8);
    const hotOut = path.join(dir, 'hot-out.wav');
    await applyVoiceMixSettings(hot, hotOut, { gainDb: 12, normalize: false });
    const peak = (() => {
      const buf = fs.readFileSync(hotOut);
      const data = buf.subarray(buf.indexOf('data') + 8);
      let max = 0;
      for (let i = 0; i + 1 < data.length; i += 2)
        max = Math.max(max, Math.abs(data.readInt16LE(i)));
      return max / 32768;
    })();
    assert.ok(
      peak <= 0.99,
      `limiter keeps the peak under full scale, got ${peak}`,
    );

    // loudness evening: a quiet line next to a loud one end up closer together
    const quiet = path.join(dir, 'quiet.wav');
    const loud = path.join(dir, 'loud.wav');
    toneWav(quiet, 2, 0.1);
    toneWav(loud, 2, 0.4);
    const joined = path.join(dir, 'joined.wav');
    execFileSync(
      ffmpegPath,
      [
        '-y',
        '-i',
        quiet,
        '-i',
        loud,
        '-filter_complex',
        'concat=n=2:v=0:a=1',
        '-c:a',
        'pcm_s16le',
        joined,
      ],
      { stdio: 'ignore' },
    );
    const evened = path.join(dir, 'evened.wav');
    await applyVoiceMixSettings(joined, evened, { gainDb: 0, normalize: true });
    const gapBefore = rmsDb(joined, 2.2, 3.8) - rmsDb(joined, 0.2, 1.8);
    const gapAfter = rmsDb(evened, 2.2, 3.8) - rmsDb(evened, 0.2, 1.8);
    assert.ok(
      gapAfter < gapBefore - 4,
      `loudness gap shrinks (${gapBefore.toFixed(1)} -> ${gapAfter.toFixed(1)} dB)`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('mix settings units OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
