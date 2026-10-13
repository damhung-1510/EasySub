import type {
  ProviderDraft,
  ProviderPublicConfig,
} from '../../types/videoProvider';
export function videoProviderDraft(
  provider: ProviderPublicConfig,
): ProviderDraft {
  const {
    id,
    name,
    kind,
    protocol,
    baseUrl,
    modelId,
    modelVersion,
    authMode,
    authHeader,
    timeoutMs,
    concurrency,
    accountId,
    allowLocalHttp,
    allowedAssetOrigins,
    capabilities,
    pricing,
    profile,
    parameters,
  } = provider;
  return {
    id,
    name,
    kind,
    protocol,
    baseUrl,
    modelId,
    modelVersion,
    authMode,
    authHeader,
    timeoutMs,
    concurrency,
    accountId,
    allowLocalHttp,
    allowedAssetOrigins,
    capabilities,
    pricing,
    profile,
    parameters,
  };
}
