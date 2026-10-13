import type {
  JsonValue,
  ProviderProtocolProfile,
} from '../../../types/videoProviderProfile';
import type {
  ProviderConfig,
  VideoAdapter,
  RemoteJob,
  VideoRequest,
} from '../../../types/videoProvider';
import { ProviderError } from '../../../types/videoProvider';
import type { ProviderTransport } from '../transport';
import { validateProviderProfile } from './profileValidation';
import {
  downloadVideo,
  getVideoCapabilities,
  validateVideoRequest,
  quoteConfigured,
  referenceData,
} from './primaryVideo';
export function resolveField(raw: unknown, field: string): unknown {
  return field
    .split('.')
    .reduce(
      (v, key) =>
        v && typeof v === 'object'
          ? (v as Record<string, unknown>)[key]
          : undefined,
      raw,
    );
}
export function substituteTemplate(
  template: JsonValue,
  values: Record<string, JsonValue>,
  encode = false,
): JsonValue {
  if (typeof template === 'string') {
    const exact = template.match(/^\{\{(\w+)\}\}$/);
    if (exact)
      return encode
        ? encodeURIComponent(String(values[exact[1]] ?? ''))
        : structuredClone(values[exact[1]]);
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = values[key];
      if (value && typeof value === 'object')
        throw new ProviderError(
          'INVALID_PROFILE',
          'Object placeholders must occupy a whole JSON value',
        );
      return encode
        ? encodeURIComponent(String(value ?? ''))
        : String(value ?? '');
    });
  }
  if (Array.isArray(template))
    return template.map((v) => substituteTemplate(v, values, encode));
  if (template && typeof template === 'object')
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [
        k,
        substituteTemplate(v, values, encode),
      ]),
    );
  return template;
}
export function createCustomAdapter(
  config: ProviderConfig,
  raw: ProviderProtocolProfile,
  transport: ProviderTransport,
): VideoAdapter {
  const profile = validateProviderProfile(raw);
  const capabilities = getVideoCapabilities(config);
  function values(
    request?: VideoRequest,
    id?: string,
  ): Record<string, JsonValue> {
    return {
      model: config.modelId,
      prompt: request?.prompt || '',
      durationSeconds: (request?.durationMs || 0) / 1000,
      aspectRatio: request?.aspectRatio || '',
      resolution: request?.resolution || '',
      references:
        request?.references.map((r) => ({
          assetId: r.assetId,
          ...referenceData(r),
        })) || [],
      remoteJobId: id || '',
    };
  }
  function map(raw: unknown, knownId?: string): RemoteJob {
    const id = resolveField(raw, profile.mapping.jobId) || knownId;
    const status = resolveField(raw, profile.mapping.status);
    const state = profile.mapping.states[String(status)];
    if (typeof id !== 'string' || !id || !state)
      throw new ProviderError(
        'RESPONSE_MAPPING_FAILED',
        'Missing field ' +
          (id ? profile.mapping.status : profile.mapping.jobId),
        'unknown',
        false,
        undefined,
        typeof id === 'string' ? id : undefined,
      );
    const url = resolveField(raw, profile.mapping.resultUrl);
    if (state === 'completed' && (typeof url !== 'string' || !url.trim()))
      throw new ProviderError(
        'RESPONSE_MAPPING_FAILED',
        'Missing field ' + profile.mapping.resultUrl,
        'unknown',
        false,
        undefined,
        id,
      );
    const usage = profile.mapping.usageMinor
      ? resolveField(raw, profile.mapping.usageMinor)
      : undefined;
    return {
      id,
      state,
      ...(typeof url === 'string' ? { resultUrl: url } : {}),
      ...(Number.isSafeInteger(usage) && Number(usage) >= 0
        ? {
            actualCost: {
              currency: config.pricing?.currency || 'USD',
              minor: Number(usage),
            },
          }
        : {}),
      ...(state === 'failed'
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
      const vars = values(request);
      return map(
        await transport.json(
          String(substituteTemplate(profile.submit.path, vars, true)),
          profile.submit.method,
          profile.submit.body
            ? substituteTemplate(profile.submit.body, vars)
            : undefined,
          signal,
        ),
      );
    },
    async poll(id, signal) {
      return map(
        await transport.json(
          String(
            substituteTemplate(profile.poll.path, values(undefined, id), true),
          ),
          profile.poll.method,
          undefined,
          signal,
        ),
        id,
      );
    },
    async cancel(id, signal) {
      if (!profile.cancel) return { supported: false, cancelled: false };
      await transport.json(
        String(
          substituteTemplate(profile.cancel.path, values(undefined, id), true),
        ),
        profile.cancel.method,
        profile.cancel.body
          ? substituteTemplate(profile.cancel.body, values(undefined, id))
          : undefined,
        signal,
      );
      return { supported: true, cancelled: false, remoteState: 'requested' };
    },
    download: (job, destination, signal) =>
      downloadVideo(transport, job, destination, signal),
  };
}
