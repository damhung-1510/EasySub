import type {
  ProviderConnectionResult,
  ProviderPublicConfig,
} from '../../types/videoProvider';
import { ProviderError } from '../../types/videoProvider';
import { createTransport, type HttpClient } from './transport';

/** Read-only credential probe. It cannot establish video-generation access or billing eligibility. */
export async function testProviderConnection(
  config: ProviderPublicConfig,
  getSecret: () => Promise<string>,
  httpClient?: HttpClient,
): Promise<ProviderConnectionResult> {
  const result = (
    status: ProviderConnectionResult['status'],
    code: ProviderConnectionResult['code'],
  ): ProviderConnectionResult => ({ providerId: config.id, status, code });
  if (!config.hasCredential) return result('failed', 'CREDENTIAL_REQUIRED');
  if (config.protocol === 'custom-async-json')
    return result('inconclusive', 'NO_SAFE_READ_ONLY_CHECK');
  if (
    ['veo-gemini', 'gemini-image'].includes(config.protocol) &&
    !['', '/v1beta'].includes(
      new URL(config.baseUrl).pathname.replace(/\/$/, ''),
    )
  )
    return result('failed', 'INVALID_GEMINI_BASE_URL');

  const endpoint =
    config.protocol === 'seedance-ark'
      ? 'files?limit=1'
      : config.protocol === 'openai-image'
        ? 'models'
        : 'models?pageSize=1';
  try {
    const response = await createTransport(config, getSecret, httpClient).json(
      endpoint,
      'GET',
      undefined,
      AbortSignal.timeout(10000),
    );
    const data = response as Record<string, unknown> | null;
    const items =
      config.protocol === 'veo-gemini' || config.protocol === 'gemini-image'
        ? data?.models
        : data?.data;
    return Array.isArray(items)
      ? result('ok', 'READ_ONLY_CONNECTION_OK')
      : result('inconclusive', 'UNEXPECTED_RESPONSE');
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : '';
    if (code === 'AUTH_FAILED') return result('failed', 'AUTH_FAILED');
    if (code === 'HTTP_404') return result('failed', 'ENDPOINT_NOT_FOUND');
    if (code === 'RATE_LIMIT') return result('inconclusive', 'RATE_LIMIT');
    return result('inconclusive', 'CONNECTION_UNAVAILABLE');
  }
}
