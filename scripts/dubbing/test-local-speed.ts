import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  synthesizeWithOpenAiCompatible,
  usesLocalSpeed,
} from '../../main/service/tts/openaiCompatible';

/** 2 s of 24 kHz mono 16-bit tone, like an endpoint that ignores `speed`. */
function tone(seconds: number): Buffer {
  const rate = 24000;
  const samples = rate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)),
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
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function main() {
  assert.equal(
    usesLocalSpeed({ id: 'a', name: 'a', type: 'openaiCompatible' }),
    false,
  );
  assert.equal(
    usesLocalSpeed({ id: 'a', name: 'a', type: 'x', localSpeed: true }),
    true,
  );
  assert.equal(
    usesLocalSpeed({ id: 'a', name: 'a', type: 'x', localSpeed: 'true' }),
    true,
  );
  assert.equal(
    usesLocalSpeed({ id: 'a', name: 'a', type: 'x', localSpeed: false }),
    false,
  );

  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw));
      res.setHeader('Content-Type', 'audio/wav');
      res.end(tone(2));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsub-local-speed-'));
  const base = {
    id: 't',
    name: 't',
    type: 'openaiCompatible',
    apiUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    model: 'm',
  };
  const run = (extra: Record<string, unknown>, speed: number, name: string) =>
    synthesizeWithOpenAiCompatible(
      { ...base, ...extra },
      { text: 'x', voice: 'v', speed, outWavPath: path.join(dir, name) },
    );

  try {
    const normal = await run({}, 2, 'normal.wav');
    assert.equal(
      bodies[0].speed,
      2,
      'server speed is sent when localSpeed is off',
    );
    assert.ok(
      Math.abs(normal.durationMs - 2000) < 60,
      `unchanged ${normal.durationMs}`,
    );

    const local = await run({ localSpeed: true }, 2, 'local.wav');
    assert.equal(
      'speed' in bodies[1],
      false,
      'speed is not sent when localSpeed is on',
    );
    assert.ok(
      Math.abs(local.durationMs - 1000) < 80,
      `2x halves a 2 s clip, got ${local.durationMs} ms`,
    );

    const slow = await run({ localSpeed: true }, 0.5, 'slow.wav');
    assert.ok(
      Math.abs(slow.durationMs - 4000) < 120,
      `0.5x, got ${slow.durationMs} ms`,
    );

    const same = await run({ localSpeed: true }, 1, 'same.wav');
    assert.ok(
      Math.abs(same.durationMs - 2000) < 60,
      'speed 1 leaves the clip alone',
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.includes('tempo')),
      [],
      'no temp files are left behind',
    );
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('local speed units OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
