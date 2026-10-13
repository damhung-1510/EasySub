import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  CreativeDecision,
  CreativeField,
  DiscoveryAnswer,
  DiscoverySession,
  DiscoveryTurn,
  CreativeBriefDraft,
  ConfirmedCreativeBrief,
} from '../../../types/creativeDiscovery';
import type { ProjectStore } from '../../../types/videoProject';
import { creativeBriefSchema } from '../schemas';
import {
  requestStructured,
  type StructuredLlm,
  type LlmBoundary,
} from '../llmAdapter';
import { DISCOVERY_PROMPT, SUGGEST_PROMPT } from './prompt';
import { buildDiscoveryContext } from './context';
import { evaluateCreativeReadiness } from './readiness';
const fields = [
  'objective',
  'audience',
  'premise',
  'conflict',
  'characters',
  'relationships',
  'world',
  'locations',
  'language',
  'dialogueTone',
  'ending',
  'style',
  'targetDurationMs',
  'audioMode',
] as const;
const fieldSchema = z.enum(fields);
const turnSchema = z.object({
  summary: z.string(),
  decisions: z.array(
    z.object({
      field: fieldSchema,
      value: z.union([z.string(), z.number()]),
      source: z.enum(['user', 'import', 'suggested']).optional(),
      evidence: z.string().optional(),
    }),
  ),
  question: z
    .object({
      targetField: fieldSchema,
      text: z
        .string()
        .max(2000)
        .refine(
          (text) => (text.match(/\?/g) || []).length <= 1,
          'Ask only one question',
        ),
      rationale: z.string().max(1000),
    })
    .optional(),
});
const questions: Record<CreativeField, string> = {
  objective: 'Bạn muốn câu chuyện mang lại cảm xúc hay thông điệp gì?',
  audience: 'Video này dành cho ai?',
  premise: 'Điều gì xảy ra trong câu chuyện?',
  conflict: 'Nhân vật phải vượt qua trở ngại nào?',
  characters: 'Nhân vật chính mong muốn điều gì?',
  relationships: 'Mối quan hệ nào quan trọng với câu chuyện?',
  world: 'Câu chuyện diễn ra ở đâu và khi nào?',
  locations: 'Bối cảnh chính của câu chuyện là gì?',
  language: 'Bạn muốn dùng ngôn ngữ nào?',
  dialogueTone: 'Bạn muốn lời kể mang giọng điệu nào?',
  ending: 'Bạn muốn câu chuyện kết thúc như thế nào?',
  style: 'Bạn muốn phong cách hình ảnh nào?',
  targetDurationMs: 'Bạn muốn video dài khoảng bao lâu?',
  audioMode: 'Bạn muốn lời dẫn hay lời thoại nhân vật?',
};
export interface DiscoveryInput {
  projectId: string;
  episodeId: string;
  inputText: string;
  facts?: Partial<Record<CreativeField, string | number>>;
  source?: 'user' | 'import';
}
export interface DiscoveryDeps {
  store: ProjectStore;
  llm: StructuredLlm;
  boundary?: LlmBoundary;
}
function normalizeCreativeValue(
  field: CreativeField,
  value: string | number,
): string | number {
  if (field === 'targetDurationMs' && typeof value === 'string') {
    const number = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(number) || number <= 0)
      throw new Error('INVALID_TARGET_DURATION');
    return Math.round(
      number *
        (/ms|millisecond/i.test(value)
          ? 1
          : /minute|phút/i.test(value)
            ? 60000
            : 1000),
    );
  }
  if (field === 'targetDurationMs' && (typeof value !== 'number' || value <= 0))
    throw new Error('INVALID_TARGET_DURATION');
  if (field === 'audioMode') {
    const text = String(value).toLowerCase();
    if (/native|lời thoại|dialogue/.test(text)) return 'native';
    if (/tts/.test(text)) return 'tts';
    if (/narration|lời dẫn|voiceover/.test(text)) return 'narration';
    throw new Error('INVALID_AUDIO_MODE');
  }
  return value;
}
export function createDiscoveryWorkflow(deps: DiscoveryDeps) {
  async function locate(id: string) {
    for (const summary of await deps.store.list()) {
      const p = await deps.store.load(summary.id);
      const session = p.discoverySessions.find((s) => s.id === id);
      if (session) return { project: p, session };
    }
    throw new Error('DISCOVERY_NOT_FOUND');
  }
  async function persist(
    projectId: string,
    version: number,
    session: DiscoverySession,
  ) {
    await deps.store.update(projectId, version, (p) => {
      const index = p.discoverySessions.findIndex((s) => s.id === session.id);
      if (index < 0) p.discoverySessions.push(session);
      else p.discoverySessions[index] = session;
      const e = p.episodes.find((e) => e.id === session.episodeId);
      if (!e) throw new Error('EPISODE_NOT_FOUND');
      e.discovery = session;
      return p;
    });
  }
  async function next(
    session: DiscoverySession,
    signal: AbortSignal,
    answer?: DiscoveryAnswer,
  ): Promise<DiscoveryTurn> {
    const turnId = randomUUID();
    if (answer) {
      const directFacts =
        answer.facts ||
        (session.currentQuestion &&
        !/^(?:i (?:do not|don.t) know|don.t know|chưa biết|không biết|ai đề xuất)/i.test(
          answer.text.trim(),
        )
          ? { [session.currentQuestion.targetField]: answer.text }
          : {});
      const decisions = Object.entries(directFacts).map(([field, value]) => ({
        field: field as CreativeField,
        value: normalizeCreativeValue(field as CreativeField, value!),
        source: 'user' as const,
        confirmed: true,
        sourceTurnId: turnId,
      }));
      session.decisions = session.decisions
        .filter((d) => !decisions.some((n) => n.field === d.field))
        .concat(decisions);
      session.turns.push({
        id: turnId,
        role: 'user',
        text: answer.text,
        questions: [],
        createdAt: new Date().toISOString(),
        decisions,
      });
    }
    const result = await requestStructured(
      deps.llm,
      DISCOVERY_PROMPT,
      buildDiscoveryContext(session),
      turnSchema,
      signal,
      deps.boundary,
    );
    session.usage.requests += result.usage.requests;
    session.usage.inputTokens += result.usage.inputTokens;
    session.usage.outputTokens += result.usage.outputTokens;
    // Confirm extracted facts only when the model cites text the user actually supplied.
    const proposals: CreativeDecision[] = result.value.decisions
      .filter(
        (d) =>
          !session.decisions.some((c) => c.field === d.field && c.confirmed),
      )
      .map((d) => {
        const quoted = d.evidence?.trim();
        const evidenceText = answer?.text || session.inputText;
        const confirmed =
          !!quoted &&
          evidenceText.includes(quoted) &&
          (d.source === 'user' || d.source === 'import');
        return {
          field: d.field!,
          value: normalizeCreativeValue(d.field!, d.value!),
          source: confirmed ? (d.source as 'user' | 'import') : 'suggested',
          confirmed,
          sourceTurnId: answer ? turnId : session.id,
        };
      });
    session.decisions = session.decisions
      .filter((d) => !proposals.some((n) => n.field === d.field))
      .concat(proposals);
    const confirmed = new Set(
      session.decisions.filter((d) => d.confirmed).map((d) => d.field),
    );
    const target =
      result.value.question && !confirmed.has(result.value.question.targetField)
        ? result.value.question.targetField
        : fields.find((f) => !confirmed.has(f));
    const question = target
      ? {
          id: randomUUID(),
          targetField: target,
          text:
            result.value.question?.targetField === target
              ? result.value.question.text
              : questions[target],
          rationale:
            result.value.question?.targetField === target
              ? result.value.question.rationale
              : 'Complete the creative brief',
        }
      : undefined;
    const turn: DiscoveryTurn = {
      id: randomUUID(),
      role: 'assistant',
      text: result.value.summary,
      questions: question ? [question] : [],
      decisions: proposals,
      createdAt: new Date().toISOString(),
      offerSummary: session.turns.filter((t) => t.role === 'user').length >= 6,
    };
    session.turns.push(turn);
    session.currentQuestion = question;
    session.status = question ? 'clarifying' : 'review';
    return turn;
  }
  return {
    async startDiscovery(input: DiscoveryInput, signal: AbortSignal) {
      const p = await deps.store.load(input.projectId);
      if (!p.episodes.some((e) => e.id === input.episodeId))
        throw new Error('EPISODE_NOT_FOUND');
      const now = new Date().toISOString();
      const id = randomUUID();
      const session: DiscoverySession = {
        id,
        projectId: p.id,
        episodeId: input.episodeId,
        inputText: input.inputText,
        version: 1,
        turns: [],
        decisions: Object.entries(input.facts || {}).map(([field, value]) => ({
          field: field as CreativeField,
          value: normalizeCreativeValue(field as CreativeField, value!),
          source: input.source || 'user',
          confirmed: true,
          sourceTurnId: id,
        })),
        draftRevisions: [],
        status: 'draft',
        usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
      };
      await next(session, signal);
      await persist(p.id, p.version, session);
      return session;
    },
    async answerDiscovery(
      id: string,
      answer: DiscoveryAnswer,
      expectedVersion: number,
      signal: AbortSignal,
    ) {
      const { project, session } = await locate(id);
      if (session.version !== expectedVersion)
        throw new Error('VERSION_CONFLICT');
      if (session.status === 'confirmed')
        throw new Error('BRIEF_ALREADY_CONFIRMED');
      const turn = await next(session, signal, answer);
      session.version++;
      session.updatedAt = new Date().toISOString();
      await persist(project.id, project.version, session);
      return turn;
    },
    async suggestRemaining(
      id: string,
      signal: AbortSignal,
    ): Promise<CreativeBriefDraft> {
      const { project, session } = await locate(id);
      if (session.status === 'confirmed')
        throw new Error('BRIEF_ALREADY_CONFIRMED');
      const contentSchema = creativeBriefSchema.omit({
        revisionId: true,
        createdAt: true,
        approvedAt: true,
      });
      const result = await requestStructured(
        deps.llm,
        SUGGEST_PROMPT,
        buildDiscoveryContext(session),
        contentSchema,
        signal,
        deps.boundary,
      );
      const draft = {
        ...result.value,
        revisionId: randomUUID(),
        createdAt: new Date().toISOString(),
      } as CreativeBriefDraft;
      for (const d of session.decisions.filter((d) => d.confirmed))
        (draft as unknown as Record<string, unknown>)[d.field] = d.value;
      for (const field of fields)
        if (!session.decisions.some((d) => d.field === field && d.confirmed)) {
          session.decisions = session.decisions.filter(
            (d) => d.field !== field,
          );
          session.decisions.push({
            field,
            value: draft[field],
            source: 'suggested',
            confirmed: false,
            sourceTurnId: draft.revisionId,
          });
          if (!draft.assumptions.includes(`${field}: ${draft[field]}`))
            draft.assumptions.push(`${field}: ${draft[field]}`);
        }
      session.usage.requests += result.usage.requests;
      session.usage.inputTokens += result.usage.inputTokens;
      session.usage.outputTokens += result.usage.outputTokens;
      session.draftRevision = draft;
      session.draftRevisions.push(draft);
      session.status = 'review';
      session.currentQuestion = undefined;
      session.version++;
      await persist(project.id, project.version, session);
      return draft;
    },
    async confirmBrief(
      id: string,
      draftRevisionId: string,
      expectedVersion: number,
    ): Promise<ConfirmedCreativeBrief> {
      const { project, session } = await locate(id);
      if (session.version !== expectedVersion)
        throw new Error('VERSION_CONFLICT');
      const draft = session.draftRevision;
      if (!draft || draft.revisionId !== draftRevisionId)
        throw new Error('BRIEF_REVISION_CONFLICT');
      if (!evaluateCreativeReadiness(draft).ready)
        throw new Error('BRIEF_INCOMPLETE');
      const brief: ConfirmedCreativeBrief = {
        ...draft,
        approvedAt: new Date().toISOString(),
      };
      session.draftRevision = brief;
      session.draftRevisions = session.draftRevisions.map((r) =>
        r.revisionId === brief.revisionId ? brief : r,
      );
      session.status = 'confirmed';
      session.decisions = session.decisions.map((d) => ({
        ...d,
        confirmed: true,
      }));
      session.version++;
      await deps.store.update(project.id, project.version, (p) => {
        p.discoverySessions = p.discoverySessions.map((s) =>
          s.id === id ? session : s,
        );
        p.confirmedBriefRevisions.push(brief);
        const episode = p.episodes.find((e) => e.id === session.episodeId)!;
        episode.discovery = session;
        episode.brief = brief;
        return p;
      });
      return brief;
    },
  };
}
export async function startDiscovery(
  input: DiscoveryInput,
  deps: DiscoveryDeps,
  signal: AbortSignal,
) {
  return createDiscoveryWorkflow(deps).startDiscovery(input, signal);
}
