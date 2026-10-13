import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ProviderConfig,
  VideoAdapter,
  VideoCapabilities,
  VideoRequest,
  CostQuote,
  RemoteJob,
  ReferenceInput,
} from '../../../types/videoProvider';
import { ProviderError } from '../../../types/videoProvider';
import type { ProviderTransport } from '../transport';
import { validateMedia } from '../mediaProbe';
/** Official contracts: ai.google.dev/gemini-api/docs/veo and docs.volcengine.com/docs/ark/create-video-generation-task-api. Live account verification remains explicit. */
export function getVideoCapabilities(
  config: ProviderConfig,
): VideoCapabilities {
  const common = {
    text: true,
    image: true,
    aspectRatios: ['16:9', '9:16'],
    audio: true,
    seed: true,
    cancel: false,
    concurrency: config.concurrency,
    verified: false,
  };
  if (config.protocol === 'veo-gemini') {
    const models = [
      'veo-3.1-generate-preview',
      'veo-3.1-fast-generate-preview',
      'veo-3.0-generate-001',
      'veo-3.0-fast-generate-001',
    ];
    if (!models.includes(config.modelId))
      throw new ProviderError(
        'UNSUPPORTED_MODEL',
        'Choose a documented Veo model',
      );
    const modern = config.modelId.startsWith('veo-3.1');
    return {
      ...common,
      references: modern,
      maxReferences: modern ? 3 : 0,
      durationsMs: modern ? [4000, 6000, 8000] : [8000],
      resolutions: modern ? ['720p', '1080p', '4k'] : ['720p', '1080p'],
    };
  }
  if (config.protocol === 'seedance-ark') {
    const models = [
      'seedance-1-5-pro-251215',
      'doubao-seedance-1-5-pro-251215',
      'seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-250528',
      'seedance-1-0-pro-fast-251015',
      'doubao-seedance-1-0-pro-fast-251015',
      'seedance-1-0-lite-i2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
    ];
    if (!models.includes(config.modelId) && !config.modelId.startsWith('ep-'))
      throw new ProviderError(
        'UNSUPPORTED_MODEL',
        'Choose a documented Seedance model or your account endpoint ID',
      );
    // This implementation supports first-frame image input. Multi-image identity input must use a separately verified model profile.
    return {
      ...common,
      audio: config.modelId.includes('1-5'),
      references: false,
      maxReferences: 1,
      durationsMs: Array.from({ length: 11 }, (_, i) => (i + 2) * 1000),
      resolutions: ['480p', '720p', '1080p'],
    };
  }
  if (config.protocol === 'custom-async-json' && config.capabilities)
    return {
      ...config.capabilities,
      concurrency: config.concurrency,
      verified: !!config.verifiedAt,
    };
  throw new ProviderError(
    'UNSUPPORTED_PROTOCOL',
    'Video protocol is not supported',
  );
}
export function validateVideoRequest(
  request: VideoRequest,
  caps: VideoCapabilities,
  config?: ProviderConfig,
): void {
  if (config && request.modelId !== config.modelId)
    throw new ProviderError(
      'MODEL_MISMATCH',
      'Request model differs from the pinned configuration',
    );
  if (!request.requestId || !request.fingerprint || !request.prompt?.trim())
    throw new ProviderError(
      'INVALID_REQUEST',
      'Request needs a prompt and identifiers',
    );
  if (!caps.durationsMs.includes(request.durationMs))
    throw new ProviderError(
      'DURATION_NOT_SUPPORTED',
      'Choose a supported shot duration',
    );
  if (
    !caps.aspectRatios.includes(request.aspectRatio) ||
    !caps.resolutions.includes(request.resolution)
  )
    throw new ProviderError(
      'FORMAT_NOT_SUPPORTED',
      'Choose a supported ratio and resolution',
    );
  if (request.references.length > caps.maxReferences)
    throw new ProviderError('REFERENCE_LIMIT', 'Too many reference images');
  if (
    request.references.length &&
    !caps.references &&
    request.references.some((r) => r.role !== 'firstFrame')
  )
    throw new ProviderError(
      'REFERENCE_NOT_SUPPORTED',
      'This model accepts a first frame rather than character identity references',
    );
  if (config?.protocol === 'veo-gemini') {
    if (
      request.references.some((reference) => reference.role !== 'firstFrame') &&
      request.durationMs !== 8000
    )
      throw new ProviderError(
        'REFERENCE_DURATION_REQUIRED',
        'Veo reference generation requires an eight second shot',
      );
    if (request.resolution !== '720p' && request.durationMs !== 8000)
      throw new ProviderError(
        'RESOLUTION_DURATION_REQUIRED',
        'High resolution generation requires eight seconds',
      );
  }
  if (request.audioMode === 'native' && !caps.audio)
    throw new ProviderError(
      'NATIVE_AUDIO_NOT_SUPPORTED',
      'Model has no native audio',
    );
  if (request.seed !== undefined && !caps.seed)
    throw new ProviderError(
      'SEED_NOT_SUPPORTED',
      'Model does not support a seed',
    );
}
export function referenceData(reference: ReferenceInput) {
  if (!reference.dataBase64)
    throw new ProviderError(
      'REFERENCE_BYTES_REQUIRED',
      'Load the approved local reference before submission',
    );
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType))
    throw new ProviderError('INVALID_IMAGE', 'Unsupported reference type');
  return { mimeType: reference.mimeType, data: reference.dataBase64 };
}
export function quoteConfigured(
  config: ProviderConfig,
  count: number,
  image = false,
): CostQuote {
  const unit = image
    ? config.pricing?.minorPerImage
    : config.pricing?.minorPerSecond;
  return {
    currency: config.pricing?.currency || 'USD',
    maxMinor: unit === undefined ? undefined : Math.ceil(unit * count),
    confidence: unit === undefined ? 'unknown' : 'estimate',
    capturedAt: new Date().toISOString(),
    components: [
      {
        label: image ? 'image' : 'video',
        minor: unit === undefined ? undefined : Math.ceil(unit * count),
      },
    ],
  };
}
export async function downloadVideo(
  transport: ProviderTransport,
  job: RemoteJob,
  destination: string,
  signal: AbortSignal,
) {
  if (job.state !== 'completed' || !job.resultUrl)
    throw new ProviderError(
      'RESULT_NOT_READY',
      'Video result is not available',
    );
  const { bytes, mimeType } = await transport.bytes(job.resultUrl, signal);
  if (!['video/mp4', 'application/octet-stream'].includes(mimeType))
    throw new ProviderError('INVALID_VIDEO_MIME', 'Output is not an MP4');
  const temp = destination + '.' + randomUUID() + '.partial';
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', signal });
    const info = await validateMedia(temp, 'video', signal);
    signal.throwIfAborted();
    await fs.rename(temp, destination);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      id: sha256,
      kind: 'video' as const,
      relativePath: 'assets/' + path.basename(destination),
      sha256,
      mimeType: info.mimeType,
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}
export function createPrimaryVideoAdapter(
  config: ProviderConfig,
  transport: ProviderTransport,
): VideoAdapter {
  const capabilities = getVideoCapabilities(config);
  const veo = config.protocol === 'veo-gemini';
  function map(raw: unknown, id?: string): RemoteJob {
    const data = raw as any;
    const remoteId = data?.name || data?.id || id;
    if (typeof remoteId !== 'string' || !remoteId)
      throw new ProviderError(
        'RESPONSE_MAPPING_FAILED',
        'Provider did not return a job ID',
        'unknown',
      );
    if (veo) {
      if (data.error)
        return {
          id: remoteId,
          state: 'failed',
          error: {
            code: 'PROVIDER_FAILED',
            message: 'Provider operation failed',
          },
        };
      const response = data.response?.generateVideoResponse;
      const url = response?.generatedSamples?.[0]?.video?.uri;
      if (data.done && !url)
        return {
          id: remoteId,
          state: 'failed',
          error: {
            code: response?.raiMediaFilteredCount
              ? 'CONTENT_BLOCKED'
              : 'RESULT_MISSING',
            message: 'Provider returned no usable video',
          },
        };
      return {
        id: remoteId,
        state: data.done ? 'completed' : id ? 'running' : 'queued',
        ...(url ? { resultUrl: url } : {}),
      };
    }
    const states: Record<string, RemoteJob['state']> = {
      queued: 'queued',
      running: 'running',
      succeeded: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
      expired: 'failed',
    };
    const state = states[data.status];
    if (!state && id)
      throw new ProviderError(
        'RESPONSE_MAPPING_FAILED',
        'Unexpected task status',
      );
    return {
      id: remoteId,
      state: state || 'queued',
      ...(data.content?.video_url ? { resultUrl: data.content.video_url } : {}),
      ...(data.error
        ? {
            error: { code: 'PROVIDER_FAILED', message: 'Provider task failed' },
          }
        : {}),
    };
  }
  return {
    capabilities: () => structuredClone(capabilities),
    quote: async (request) => {
      validateVideoRequest(request, capabilities, config);
      return quoteConfigured(config, request.durationMs / 1000);
    },
    async submit(request, signal) {
      validateVideoRequest(request, capabilities, config);
      if (veo) {
        const instance: any = { prompt: request.prompt };
        const references = request.references.filter(
          (r) => r.role !== 'firstFrame',
        );
        const first = request.references.find((r) => r.role === 'firstFrame');
        if (first) instance.image = { inlineData: referenceData(first) };
        if (references.length)
          instance.referenceImages = references.map((r) => ({
            image: { inlineData: referenceData(r) },
            referenceType: 'asset',
          }));
        const parameters = {
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationMs / 1000,
          resolution: request.resolution,
          ...(request.seed !== undefined ? { seed: request.seed } : {}),
          ...(config.parameters || {}),
        };
        return map(
          await transport.json(
            'models/' +
              encodeURIComponent(config.modelId) +
              ':predictLongRunning',
            'POST',
            { instances: [instance], parameters },
            signal,
          ),
        );
      }
      const content = [
        { type: 'text', text: request.prompt },
        ...request.references.map((r) => {
          const data = referenceData(r);
          return {
            type: 'image_url',
            image_url: {
              url: 'data:' + data.mimeType + ';base64,' + data.data,
            },
            role: 'first_frame',
          };
        }),
      ];
      return map(
        await transport.json(
          'contents/generations/tasks',
          'POST',
          {
            model: config.modelId,
            content,
            duration: request.durationMs / 1000,
            ratio: request.aspectRatio,
            resolution: request.resolution,
            generate_audio: request.audioMode === 'native',
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
            ...(config.parameters || {}),
          },
          signal,
        ),
      );
    },
    async poll(id, signal) {
      if (
        veo &&
        !/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(id) &&
        !/^operations\/[\w.-]+$/.test(id)
      )
        throw new ProviderError('INVALID_REMOTE_ID', 'Invalid operation ID');
      if (!veo && !/^[\w.-]+$/.test(id))
        throw new ProviderError('INVALID_REMOTE_ID', 'Invalid task ID');
      return map(
        await transport.json(
          veo ? id : 'contents/generations/tasks/' + encodeURIComponent(id),
          'GET',
          undefined,
          signal,
        ),
        id,
      );
    },
    cancel: async () => ({ supported: false, cancelled: false }),
    download: (job, destination, signal) =>
      downloadVideo(transport, job, destination, signal),
  };
}
