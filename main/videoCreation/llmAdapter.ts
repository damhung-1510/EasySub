import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Provider } from '../../types/provider';
export interface LlmRequest {
  system: string;
  input: unknown;
  schema: unknown;
  repair?: { errors: string; previous: string };
  signal: AbortSignal;
}
export interface LlmReply {
  text: string;
  incomplete?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}
export interface StructuredLlm {
  complete(request: LlmRequest): Promise<LlmReply>;
}
export interface LlmBoundary {
  beforeRequest?(request: LlmRequest): Promise<void>;
  afterRequest?(reply: LlmReply): Promise<void>;
}
export function createAssistantLlm(
  provider: Provider,
  boundary: Required<Pick<LlmBoundary, 'beforeRequest'>> & LlmBoundary,
): StructuredLlm {
  return {
    async complete(request) {
      await boundary.beforeRequest(request);
      const { requestAssistant } = await import('../assistant/provider');
      const reply = await requestAssistant(
        provider,
        [
          {
            role: 'system',
            content:
              request.system +
              '\nReturn only JSON matching this schema: ' +
              JSON.stringify(request.schema),
          },
          {
            role: 'user',
            content: JSON.stringify({
              data: request.input,
              repair: request.repair,
            }),
          },
        ],
        [],
        request.signal,
        () => {},
      );
      if (reply.calls.length) throw new Error('UNEXPECTED_TOOL_CALL');
      const result = { text: reply.content };
      await boundary.afterRequest?.(result);
      return result;
    },
  };
}
export async function requestStructured<T>(
  llm: StructuredLlm,
  system: string,
  input: unknown,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  boundary: LlmBoundary = {},
): Promise<{
  value: T;
  usage: { requests: number; inputTokens: number; outputTokens: number };
}> {
  let repair: LlmRequest['repair'];
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const request = {
      system,
      input,
      schema: zodToJsonSchema(schema as z.ZodTypeAny),
      repair,
      signal,
    };
    await boundary.beforeRequest?.(request);
    const reply = await llm.complete(request);
    usage.requests++;
    usage.inputTokens += reply.usage?.inputTokens || 0;
    usage.outputTokens += reply.usage?.outputTokens || 0;
    await boundary.afterRequest?.(reply);
    signal.throwIfAborted();
    if (reply.incomplete) throw new Error('INCOMPLETE_RESPONSE');
    if (reply.text.length > 1024 * 1024)
      throw new Error('STRUCTURED_OUTPUT_TOO_LARGE');
    try {
      const clean = reply.text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      return { value: schema.parse(JSON.parse(clean)), usage };
    } catch (error) {
      repair = {
        errors:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join(';')
            : 'Invalid JSON',
        previous: reply.text,
      };
    }
  }
  throw new Error(
    'STRUCTURED_OUTPUT_INVALID: initial request and two repairs failed',
  );
}
