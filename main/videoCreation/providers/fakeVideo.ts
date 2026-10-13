import fs from 'node:fs/promises';
import type {
  VideoAdapter,
  VideoCapabilities,
  RemoteJob,
  VideoRequest,
} from '../../../types/videoProvider';
import { ProviderError } from '../../../types/videoProvider';
import { downloadVideo, validateVideoRequest } from './primaryVideo';
export interface FakeVideoOptions {
  fixturePath: string;
  capabilities?: Partial<VideoCapabilities>;
  unknownSubmit?: boolean;
  pollRateLimitOnce?: boolean;
  failed?: boolean;
}
/** Test-only injection. This adapter is deliberately absent from the production registry and protocol selector. */
export function createFakeVideoAdapter(
  options: FakeVideoOptions,
): VideoAdapter & {
  submitCalls: number;
  pollCalls: number;
  requests: VideoRequest[];
} {
  const caps: VideoCapabilities = {
    text: true,
    image: true,
    references: true,
    maxReferences: 3,
    durationsMs: [500, 1000, 4000, 6000, 8000],
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    audio: false,
    seed: true,
    cancel: false,
    concurrency: 1,
    verified: true,
    ...options.capabilities,
  };
  const polls = new Map<string, number>();
  const adapter = {
    submitCalls: 0,
    pollCalls: 0,
    requests: [] as VideoRequest[],
    capabilities: () => structuredClone(caps),
    quote: async () => ({
      currency: 'USD',
      maxMinor: 0,
      confidence: 'exact' as const,
      capturedAt: new Date().toISOString(),
      components: [{ label: 'test fixture', minor: 0 }],
    }),
    async submit(
      request: VideoRequest,
      signal: AbortSignal,
    ): Promise<RemoteJob> {
      signal.throwIfAborted();
      validateVideoRequest(request, caps);
      adapter.submitCalls++;
      adapter.requests.push(structuredClone(request));
      if (options.unknownSubmit)
        throw new ProviderError(
          'SUBMIT_TIMEOUT',
          'Fixture unknown outcome',
          'unknown',
        );
      const id = 'fake-' + request.requestId;
      polls.set(id, 0);
      return { id, state: 'queued' };
    },
    async poll(id: string, signal: AbortSignal): Promise<RemoteJob> {
      signal.throwIfAborted();
      adapter.pollCalls++;
      const n = (polls.get(id) || 0) + 1;
      polls.set(id, n);
      if (options.pollRateLimitOnce && n === 1)
        throw new ProviderError(
          'RATE_LIMIT',
          'Fixture rate limit',
          'failed',
          true,
          1,
        );
      if (options.failed)
        return {
          id,
          state: 'failed',
          error: {
            code: 'FIXTURE_FAILED',
            message: 'Fixture rejected request',
          },
        };
      return {
        id,
        state: n < 2 ? 'running' : 'completed',
        ...(n >= 2
          ? {
              resultUrl: 'https://fixture.invalid/video',
              actualCost: { currency: 'USD', minor: 0 },
            }
          : {}),
      };
    },
    cancel: async () => ({ supported: false, cancelled: false }),
    download: (job: RemoteJob, destination: string, signal: AbortSignal) =>
      downloadVideo(
        {
          json: async () => {
            throw Error('unused');
          },
          bytes: async () => ({
            bytes: await fs.readFile(options.fixturePath),
            mimeType: 'video/mp4',
          }),
        },
        job,
        destination,
        signal,
      ),
  };
  return adapter;
}
