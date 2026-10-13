/**
 * 交付字幕单行文本的配音文本替换（纯函数，无 Electron 依赖）。
 *
 * 配音稿被改过时，交付字幕里对应的旧配音文本要换成新文本，其余行（双语的原文行）保持不变。
 * 只在能唯一确定位置时替换，否则返回 null 由调用方拒绝，避免把旧译文静默写进成片。
 */
export function replaceDubDisplayText(
  deliveredText: string,
  baseText: string,
  currentText: string,
): string | null {
  const lines = deliveredText.split('\n').map((line) => line.trim());
  const oldLines = baseText.split('\n').map((line) => line.trim());
  const matches = lines.flatMap((_, offset) =>
    oldLines.every((line, i) => lines[offset + i] === line) ? [offset] : [],
  );
  if (matches.length === 1) {
    lines.splice(matches[0], oldLines.length, currentText);
    return lines.join('\n');
  }
  if (matches.length === 0) {
    // 纯译文字幕：交付稿把同一句话软折行成多行，而配音稿是一整行，
    // 逐行比较永远对不上。忽略空白后整块相同，就是同一份单语文本。
    const squash = (text: string) => text.replace(/\s+/g, '');
    if (squash(deliveredText) === squash(baseText)) return currentText;
  }
  return null;
}
