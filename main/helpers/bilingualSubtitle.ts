import {
  detectSubtitleFormatFromContent,
  parseSubtitleCues,
  serializeSubtitleCues,
  type SubtitleCue,
} from './subtitleFormats';
import {
  bilingualContentType,
  resolveDubbingScript,
  type BilingualContentType,
} from './dubbing/bilingualScript';
import { findDubbingProofreadDataFile } from './dubbing/speakerMetadata';
import type { ProofreadDataFileV2 } from '../../types/proofreadData';
import type {
  BilingualSubtitleInfo,
  SubtitleLinesMode,
} from '../../types/subtitleMerge';

/** Formats whose cue text is plain lines; ASS cues carry override tags and are left alone. */
const FILTERABLE = new Set(['srt', 'vtt']);
/** Share of cues that must have exactly two lines before a file with no sidecar counts as bilingual. */
const GUESS_RATIO = 0.8;
const GUESS_MIN_CUES = 3;

const textLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

interface Layout {
  info: BilingualSubtitleInfo;
  /** Per cue: how many leading lines are the top block; undefined when the cue cannot be split. */
  splits: Array<number | undefined>;
}

/** The two-block layout of `cues`, from the task's sidecar when it lists the file, else by line count. */
function layoutOf(
  subtitlePath: string,
  cues: readonly SubtitleCue[],
  sidecar: ProofreadDataFileV2 | null | undefined,
): Layout | undefined {
  const order: BilingualContentType | undefined = sidecar
    ? bilingualContentType(sidecar.meta, subtitlePath)
    : undefined;
  if (sidecar && order) {
    const script = resolveDubbingScript(subtitlePath, cues, sidecar);
    const splits = script.cues.map((cue) =>
      cue.display
        ? order === 'sourceAndTranslate'
          ? cue.display.from
          : cue.display.to
        : undefined,
    );
    return {
      info: { order, unresolved: script.unresolved.length },
      splits,
    };
  }

  const filled = cues.filter((cue) => textLines(cue.text).length > 0);
  const twoLine = filled.filter((cue) => textLines(cue.text).length === 2);
  if (
    filled.length < GUESS_MIN_CUES ||
    twoLine.length / filled.length < GUESS_RATIO
  ) {
    return undefined;
  }
  return {
    info: { order: 'unknown', unresolved: filled.length - twoLine.length },
    splits: cues.map((cue) => {
      const lines = textLines(cue.text);
      return lines.length === 2 ? 1 : undefined;
    }),
  };
}

function parseFilterable(subtitlePath: string, content: string) {
  const format = detectSubtitleFormatFromContent(subtitlePath, content);
  if (!FILTERABLE.has(format)) return undefined;
  return { format, cues: parseSubtitleCues(content, format) };
}

/** Whether `content` is a bilingual SRT/VTT, and in which order; undefined when it is not. */
export function inspectBilingualSubtitle(
  subtitlePath: string,
  content: string,
): BilingualSubtitleInfo | undefined {
  const parsed = parseFilterable(subtitlePath, content);
  if (!parsed || parsed.cues.length === 0) return undefined;
  const sidecar = findDubbingProofreadDataFile(subtitlePath)?.data;
  return layoutOf(subtitlePath, parsed.cues, sidecar)?.info;
}

/**
 * `content` reduced to its top or bottom block. Anything that cannot be split safely
 * (ASS files, files that are not bilingual, cues whose lines do not divide) is returned as it was.
 */
export function filterSubtitleLines(
  subtitlePath: string,
  content: string,
  mode: SubtitleLinesMode | undefined,
): string {
  if (!mode || mode === 'both') return content;
  const parsed = parseFilterable(subtitlePath, content);
  if (!parsed || parsed.cues.length === 0) return content;
  const sidecar = findDubbingProofreadDataFile(subtitlePath)?.data;
  const layout = layoutOf(subtitlePath, parsed.cues, sidecar);
  if (!layout) return content;
  const cues = parsed.cues.map((cue, index): SubtitleCue => {
    const split = layout.splits[index];
    if (split === undefined) return cue;
    const lines = textLines(cue.text);
    const kept = mode === 'top' ? lines.slice(0, split) : lines.slice(split);
    return { ...cue, text: kept.join('\n') };
  });
  return serializeSubtitleCues(cues, parsed.format);
}
