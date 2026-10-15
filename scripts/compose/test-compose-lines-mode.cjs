const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const ffmpeg = require('ffmpeg-static');
const originalLoad = Module._load;
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const { buildAssDocument } = require('../../main/helpers/assStyleBuilder.ts');
const { DEFAULT_STYLE } = require('../../renderer/components/subtitleMerge/constants.ts');

/** Subtitle text the hard-burn path hands to the ASS builder. */
const seenByAssBuilder = [];
Module._load = function (request, parent, isMain) {
  if (/\/(storeManager|logger)$/.test(request)) return { logMessage() {} };
  if (request.endsWith('/fileUtils'))
    return {
      timemarkToSeconds: (value) =>
        value.split(':').reduce((total, n) => total * 60 + Number(n), 0),
    };
  if (request.endsWith('/subtitleMerger'))
    return {
      MERGE_CANCELLED: 'MERGE_CANCELLED',
      getVideoInfo: async () => ({ width: 640, height: 360, duration: 3 }),
      buildAssForSubtitle: (text, _file, style) => {
        seenByAssBuilder.push(text);
        return {
          assContent: buildAssDocument([{ startMs: 0, endMs: 3000, text: 'x' }], style),
          effectiveStyle: style,
        };
      },
      escapeSubtitlePath: (value) => value.replace(/\\/g, '/').replace(/:/g, '\\:'),
      cleanupTempSubtitle: (value) => fs.rmSync(value, { force: true }),
      writeTempAssFile: (content) => {
        const file = path.join(os.tmpdir(), `video-subtitle-master-${Date.now()}.ass`);
        fs.writeFileSync(file, content);
        return file;
      },
    };
  if (request.endsWith('/hwEncoderDetector'))
    return { getHwAccelInfo: async () => ({ available: false }), buildHwCqArgs: () => [] };
  return originalLoad.call(this, request, parent, isMain);
};

const leftovers = () =>
  fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('video-subtitle-master-lines-'));

async function main() {
  const { runComposeJob } = require('../../main/helpers/compose/composeRunner.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsub-compose-lines-'));
  const video = path.join(root, 'input.mp4');
  const sub = path.join(root, 'bilingual.srt');
  const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args]);
  run(['-f', 'lavfi', '-i', 'color=black:s=640x360:r=25:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  const bilingual =
    '1\n00:00:00,100 --> 00:00:01,400\n你好吗\nXin chào bạn\n\n2\n00:00:01,500 --> 00:00:02,900\n再见了\nTạm biệt nhé\n\n3\n00:00:03,000 --> 00:00:03,500\n谢谢\nCảm ơn\n';
  fs.writeFileSync(sub, bilingual);
  const before = leftovers().length;

  const extractText = (file) => {
    const out = path.join(root, `${path.basename(file)}.txt.srt`);
    run(['-y', '-i', file, '-map', '0:s:0', out]);
    return fs.readFileSync(out, 'utf8');
  };
  const soft = (linesMode, name) =>
    runComposeJob(
      {
        videoPath: video,
        outputPath: path.join(root, name),
        subtitle: { mode: 'soft', subtitlePath: sub, ...(linesMode ? { linesMode } : {}) },
        audio: { mode: 'keep' },
      },
      { jobId: `lines-${name}`, setCancel() {}, onProgress() {} },
    );

  // soft track: the chosen block only, the user's own file untouched, no temp copy left behind
  const bottom = extractText(await soft('bottom', 'bottom.mkv'));
  assert.ok(bottom.includes('Xin chào bạn') && !bottom.includes('你好吗'), 'bottom keeps the translation');
  const top = extractText(await soft('top', 'top.mkv'));
  assert.ok(top.includes('你好吗') && !top.includes('Xin chào bạn'), 'top keeps the first line');
  const both = extractText(await soft('both', 'both.mkv'));
  assert.ok(both.includes('你好吗') && both.includes('Xin chào bạn'), 'both is the old behaviour');
  const unset = extractText(await soft(undefined, 'unset.mkv'));
  assert.ok(unset.includes('你好吗') && unset.includes('Xin chào bạn'), 'no option is the old behaviour');
  assert.equal(fs.readFileSync(sub, 'utf8'), bilingual, 'the original subtitle file is not rewritten');
  assert.equal(leftovers().length, before, 'temporary subtitle copies are removed');

  // hard burn: the ASS builder receives only the chosen block
  seenByAssBuilder.length = 0;
  await runComposeJob(
    {
      videoPath: video,
      outputPath: path.join(root, 'hard.mkv'),
      subtitle: { mode: 'hard', subtitlePath: sub, style: DEFAULT_STYLE, linesMode: 'bottom' },
      audio: { mode: 'keep' },
    },
    { jobId: 'lines-hard', setCancel() {}, onProgress() {} },
  );
  assert.equal(seenByAssBuilder.length, 1);
  assert.ok(seenByAssBuilder[0].includes('Tạm biệt nhé') && !seenByAssBuilder[0].includes('再见了'), 'hard burn gets the bottom block only');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('compose lines mode OK');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
