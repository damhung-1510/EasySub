import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  filterSubtitleLines,
  inspectBilingualSubtitle,
} from '../main/helpers/bilingualSubtitle';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsub-bilingual-'));
const srt = (blocks: string[][]) =>
  blocks
    .map(
      (lines, i) =>
        `${i + 1}\n00:00:0${i},000 --> 00:00:0${i},900\n${lines.join('\n')}\n`,
    )
    .join('\n');

try {
  // ── no sidecar: guessed from two lines per cue ──
  const guessed = path.join(dir, 'guessed.srt');
  const guessedContent = srt([
    ['你好', 'Xin chào'],
    ['再见', 'Tạm biệt'],
    ['谢谢', 'Cảm ơn'],
    ['好的', 'Được rồi'],
  ]);
  fs.writeFileSync(guessed, guessedContent);
  assert.deepEqual(inspectBilingualSubtitle(guessed, guessedContent), {
    order: 'unknown',
    unresolved: 0,
  });
  assert.equal(
    filterSubtitleLines(guessed, guessedContent, 'both'),
    guessedContent,
  );
  assert.equal(
    filterSubtitleLines(guessed, guessedContent, undefined),
    guessedContent,
  );
  const top = filterSubtitleLines(guessed, guessedContent, 'top');
  assert.ok(
    top.includes('你好') && !top.includes('Xin chào'),
    'top keeps the first line',
  );
  const bottom = filterSubtitleLines(guessed, guessedContent, 'bottom');
  assert.ok(
    bottom.includes('Tạm biệt') && !bottom.includes('再见'),
    'bottom keeps the second line',
  );
  assert.ok(
    /^1\n00:00:00,000 --> 00:00:00,900\nXin chào/.test(bottom),
    'timing and numbering are kept',
  );

  // a monolingual file is not bilingual
  const mono = srt([['Một'], ['Hai'], ['Ba'], ['Bốn']]);
  const monoPath = path.join(dir, 'mono.srt');
  fs.writeFileSync(monoPath, mono);
  assert.equal(inspectBilingualSubtitle(monoPath, mono), undefined);
  assert.equal(
    filterSubtitleLines(monoPath, mono, 'top'),
    mono,
    'not bilingual: unchanged',
  );

  // too few two-line cues: not bilingual (soft-wrapped single language)
  const mixed = srt([['A'], ['B'], ['C', 'D'], ['E']]);
  const mixedPath = path.join(dir, 'mixed.srt');
  fs.writeFileSync(mixedPath, mixed);
  assert.equal(inspectBilingualSubtitle(mixedPath, mixed), undefined);

  // a few cues that do not split keep both lines
  const odd = srt([
    ['你好', 'Xin chào'],
    ['再见', 'Tạm biệt'],
    ['谢谢', 'Cảm ơn'],
    ['好的', 'Được rồi'],
    ['行', 'Ừ'],
    ['单行'],
  ]);
  const oddPath = path.join(dir, 'odd.srt');
  fs.writeFileSync(oddPath, odd);
  assert.deepEqual(inspectBilingualSubtitle(oddPath, odd), {
    order: 'unknown',
    unresolved: 1,
  });
  assert.ok(filterSubtitleLines(oddPath, odd, 'bottom').includes('单行'));

  // ASS is never rewritten
  const ass =
    '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name\nStyle: Default\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,你好\\NXin chào\n';
  const assPath = path.join(dir, 'a.ass');
  fs.writeFileSync(assPath, ass);
  assert.equal(inspectBilingualSubtitle(assPath, ass), undefined);
  assert.equal(filterSubtitleLines(assPath, ass, 'top'), ass);

  // ── with a sidecar: order and wrapped translation come from the task data ──
  const cuesData = [
    {
      id: '1',
      startMs: 0,
      endMs: 900,
      source: '你好吗',
      target: 'Bạn khỏe không',
    },
    {
      id: '2',
      startMs: 1000,
      endMs: 1900,
      source: '再见',
      target: 'Tạm biệt các bạn nhé',
    },
    { id: '3', startMs: 2000, endMs: 2900, source: '谢谢', target: 'Cảm ơn' },
  ];
  // the sidecar is found in the folder next to the subtitle that older versions wrote to
  const legacy = path.join(dir, '.smartsub-proofread');
  fs.mkdirSync(legacy);

  // translation last, one translation line wrapped over two lines
  const stFile = path.join(dir, 'source-first.srt');
  const stContent = srt([
    ['你好吗', 'Bạn khỏe', 'không'],
    ['再见', 'Tạm biệt các', 'bạn nhé'],
    ['谢谢', 'Cảm ơn'],
  ]);
  fs.writeFileSync(stFile, stContent);
  fs.writeFileSync(
    path.join(legacy, 'task.json'),
    JSON.stringify({
      version: 2,
      meta: {
        sourceFile: path.join(dir, 'src.srt'),
        targetFile: path.join(dir, 'tgt.srt'),
        finalTargetFile: stFile,
        translateContent: 'sourceAndTranslate',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      speakers: [],
      cues: cuesData,
    }),
  );
  const info = inspectBilingualSubtitle(stFile, stContent);
  assert.equal(info?.order, 'sourceAndTranslate');
  assert.equal(info?.unresolved, 0);
  const sourceOnly = filterSubtitleLines(stFile, stContent, 'top');
  assert.ok(sourceOnly.includes('你好吗') && !sourceOnly.includes('Bạn khỏe'));
  const translationOnly = filterSubtitleLines(stFile, stContent, 'bottom');
  assert.ok(
    translationOnly.includes('Bạn khỏe\nkhông') &&
      !translationOnly.includes('你好吗'),
    'wrapped translation is kept whole',
  );

  // translation first, and a cue edited by hand so it cannot be located
  const tsFile = path.join(dir, 'translation-first.srt');
  const tsContent = srt([
    ['Bạn khỏe không', '你好吗'],
    ['Tạm biệt các bạn nhé', '再见'],
    ['Đã sửa tay', '谢谢 khác'],
  ]);
  fs.writeFileSync(tsFile, tsContent);
  fs.writeFileSync(
    path.join(legacy, 'task2.json'),
    JSON.stringify({
      version: 2,
      meta: {
        sourceFile: path.join(dir, 'src.srt'),
        targetFile: path.join(dir, 'tgt.srt'),
        finalTargetFile: tsFile,
        translateContent: 'translateAndSource',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      speakers: [],
      cues: cuesData,
    }),
  );
  const info2 = inspectBilingualSubtitle(tsFile, tsContent);
  assert.equal(info2?.order, 'translateAndSource');
  assert.equal(info2?.unresolved, 1, 'the hand-edited cue cannot be located');
  const first = filterSubtitleLines(tsFile, tsContent, 'top');
  assert.ok(first.includes('Bạn khỏe không') && !first.includes('你好吗'));
  assert.ok(
    first.includes('Đã sửa tay\n谢谢 khác'),
    'an unresolved cue keeps both lines',
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('bilingual subtitle units OK');
