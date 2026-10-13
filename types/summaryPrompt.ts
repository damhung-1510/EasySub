/**
 * 产品级通读摘要提示词。
 *
 * 与翻译服务商的 systemPrompt（src/tr JSON 协议）物理分离：摘要服务可以
 * 不是翻译服务，且摘要输出是纯文本，不能走回显协议。
 *
 * settings.summaryPrompt 存用户改写版；空 / 缺省 / 空白回落本出厂稿，
 * 不做首启动写死迁移，避免把后续出厂更新锁进用户商店。
 */

export const defaultSummaryPrompt = `# Vai trò: Trợ lý phân tích phụ đề
Bạn là trợ lý phân tích phụ đề. Dưới đây là phụ đề \${sourceLanguage} hiện tại (mỗi dòng: id<TAB>nguyên văn).

# Lưu ý
Hãy viết "bản tóm tắt phục vụ dịch" bằng \${targetLanguage} (dùng làm ngữ cảnh tham khảo cho các đợt dịch theo lô sau này), không quá 400 từ, và bắt buộc có đủ các mục sau:

1. **Tóm lược nội dung**: đoạn phụ đề hiện tại nói về điều gì, liên quan đến chủ đề hoặc bối cảnh nào.
2. **Người nói chính và cách xưng hô**: những người nói, những người được nhắc đến trong phụ đề hiện tại, cùng cách họ gọi nhau. Chỉ ghi những gì xuất hiện trong phụ đề hiện tại, không tự bổ sung nội dung chưa thấy.
3. **Giọng điệu và thông tin còn bỏ ngỏ**: đặc điểm giọng điệu của người nói (trang trọng / suồng sã / mỉa mai / căng thẳng, v.v.), cùng những thông tin chưa được nói rõ trong lô này mà có thể ảnh hưởng đến sự mạch lạc của bản dịch về sau.
4. **Danh xưng, tên riêng và chỗ dễ gây nhầm lẫn**: chỉ ra những cách gọi dễ lẫn hoặc đối tượng chưa xác định, **vẫn giữ cách viết như trong phụ đề gốc**. Nếu thiếu chỗ, mục này có thể rút gọn.

Quy tắc về tên riêng (bản tóm tắt là ngữ cảnh cho các lô dịch sau, không phải bản dịch):
- Tên người, tên địa danh, tên tổ chức, danh xưng: luôn dùng cách viết trong phụ đề gốc để dễ đối chiếu với nguyên văn của các lô sau.
- Nếu trong instructions có kèm bảng thuật ngữ: không tự bịa cách dịch ngoài bảng; **không** đổi tên riêng trong bản tóm tắt sang cách dịch trong bảng. Việc áp dụng cách dịch do cơ chế chèn thuật ngữ của các lô dịch sau đảm nhiệm.
- Không ghi chú kiểu "(cách dịch tạm thời, chờ xác nhận)", và không tự đặt thêm một bộ cách gọi riêng.

# Yêu cầu định dạng đầu ra

1. Đầu vào là danh sách phụ đề hiện tại, mỗi dòng \`id<TAB>nguyên văn\`; không có mốc thời gian; các lần xuống dòng trong nguyên văn đã được nén thành \` / \`.
2. Chỉ xuất phần nội dung tóm tắt.
3. Không dùng JSON, không dịch từng dòng, không xếp chồng nhiều tiêu đề Markdown, không viết thành lời dẫn cho khán giả hay bài bình phim.
4. Không dịch lần lượt các dòng liền kề; đây không phải là tác vụ dịch.
5. Nếu thiếu chỗ, ưu tiên giữ các mục 1–3, rút gọn hoặc bỏ mục 4.

# Examples

Input:
\`\`\`
0	Welcome to China
1	China is a beautiful country
\`\`\`
Output:
Mở đầu chào đón thính giả đến với Trung Quốc và khen ngợi phong cảnh nơi đây. Người nói hướng về thính giả, giọng nhiệt tình, mang tính giới thiệu. Tên riêng China giữ nguyên văn; lời chào đón được dùng nhất quán trước sau.
`;

/** 文件总 cue 数下限；再短压缩没有信息增益。 */
export const SUMMARY_MIN_CUES = 20;

/** 预计批次下限；单批时模型已看见全文。 */
export const SUMMARY_MIN_BATCHES = 2;

/** 与 refineProvider 同构的「跟随翻译服务」哨兵。 */
export const FOLLOW_TRANSLATION_PROVIDER = 'follow-translation';

export const SUMMARY_GLOSSARY_HEADING =
  '## Thuật ngữ riêng (để đối chiếu: bản tóm tắt giữ nguyên cách viết gốc, không đổi sang bản dịch trong bảng)';

export const SUMMARY_BLOCK_HEADING =
  '## Tóm tắt nội dung tập này (khi dịch hãy tham khảo ngữ cảnh và trạng thái nhân vật, không ghi vào JSON đầu ra)';

export type SummaryErrorCode =
  | 'empty'
  | 'empty-after-think-strip'
  | 'skipped-trivial'
  | 'skipped-resume'
  | 'provider-unresolved'
  | 'provider-not-ai'
  | 'provider-unconfigured'
  | 'call-failed';

/** 出厂稿「不得超过 400 字」的运行时上限。CJK 按码点，其它语言按词。 */
export const SUMMARY_MAX_UNITS = 400;

const CJK_PRIMARY_SUBTAGS = new Set(['zh', 'ja', 'ko', 'yue']);

/**
 * 词边界分词器。结构化类型 + 运行时探测，不依赖 TS lib 的 Intl.Segmenter 声明。
 * 与 subtitleSegmentation 的词边界分词器同一写法。
 */
interface SummaryWordSegment {
  segment: string;
  index: number;
  isWordLike?: boolean;
}
interface SummaryWordSegmenter {
  segment(input: string): Iterable<SummaryWordSegment>;
}
type SummarySegmenterCtor = new (
  locale?: string,
  options?: { granularity?: 'word' | 'grapheme' | 'sentence' },
) => SummaryWordSegmenter;

const segmenterCache = new Map<string, SummaryWordSegmenter>();

/** 词边界分词器。构造失败或运行时没有 Segmenter 时返回 null，调用方按空白切分。 */
export function summaryWordSegmenter(
  locale: string,
): SummaryWordSegmenter | null {
  const ctor =
    typeof Intl !== 'undefined'
      ? (Intl as { Segmenter?: SummarySegmenterCtor }).Segmenter
      : undefined;
  if (typeof ctor !== 'function') return null;
  const key = locale || '';
  const cached = segmenterCache.get(key);
  if (cached) return cached;
  try {
    const created = new ctor(locale || undefined, { granularity: 'word' });
    segmenterCache.set(key, created);
    return created;
  } catch {
    return null;
  }
}

/** 主子标签（小写，按 '-' 或 '_' 切开的第一段）属于中日韩或粤语。 */
export function isCjkSummaryTarget(targetLang: string): boolean {
  const primary = String(targetLang || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return CJK_PRIMARY_SUBTAGS.has(primary);
}

export function isSummaryWhitespace(ch: string): boolean {
  return /^\s$/.test(ch);
}

/** 从 index 取出一个 Unicode 码点，不拆开代理对。 */
export function nextSummaryCodePoint(
  text: string,
  index: number,
): { ch: string; end: number } {
  const cp = text.codePointAt(index) as number;
  const width = cp > 0xffff ? 2 : 1;
  return { ch: text.slice(index, index + width), end: index + width };
}

function countNonSpaceCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; ) {
    const step = nextSummaryCodePoint(text, i);
    if (!isSummaryWhitespace(step.ch)) count += 1;
    i = step.end;
  }
  return count;
}

function countWordsFallback(text: string): number {
  const parts = text.trim().match(/\S+/g);
  return parts ? parts.length : 0;
}

function countWords(text: string, targetLang: string): number {
  const segmenter = summaryWordSegmenter(targetLang.trim());
  if (!segmenter) return countWordsFallback(text);
  let count = 0;
  const parts = Array.from(segmenter.segment(text));
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].isWordLike) count += 1;
  }
  return count;
}

/**
 * 摘要长度。
 * CJK 目标按 Unicode 码点计：先 trim，再去掉空白（含换行、全角空格）。
 * 换行不计入，避免排版把篇幅撑过上限；一个代理对算一个码点。
 * 其它目标按词计（Segmenter 的 isWordLike）。运行时没有 Segmenter 时按空白切分。
 */
export function measureSummary(text: string, targetLang: string): number {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return 0;
  if (isCjkSummaryTarget(targetLang)) return countNonSpaceCodePoints(trimmed);
  return countWords(trimmed, targetLang);
}

/** 空 / 空白 / 非字符串一律回落出厂稿。 */
export function resolveSummaryPrompt(stored?: unknown): string {
  if (typeof stored !== 'string') return defaultSummaryPrompt;
  const trimmed = stored.trim();
  return trimmed || defaultSummaryPrompt;
}
