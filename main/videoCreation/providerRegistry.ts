import type {
  ProviderConfig,
  VideoAdapter,
  ImageAdapter,
} from '../../types/videoProvider';
import { ProviderError } from '../../types/videoProvider';
import type { ProviderTransport } from './transport';
import { createPrimaryVideoAdapter } from './providers/primaryVideo';
import { createCustomAdapter } from './providers/customProfile';
import { createImageAdapter } from './providers/imageProvider';
export function createVideoAdapter(
  config: ProviderConfig,
  transport: ProviderTransport,
): VideoAdapter {
  if (config.kind !== 'video')
    throw new ProviderError(
      'PROVIDER_KIND_MISMATCH',
      'Choose a video provider',
    );
  return config.protocol === 'custom-async-json'
    ? createCustomAdapter(config, config.profile!, transport)
    : createPrimaryVideoAdapter(config, transport);
}
export { createImageAdapter };
export function createVideoRegistry(
  configs: ProviderConfig[],
  transportFactory: (config: ProviderConfig) => ProviderTransport,
) {
  return {
    get(id: string, revisionId?: string) {
      const config = configs.find(
        (c) =>
          c.id === id &&
          (revisionId ? c.revisionId === revisionId : !c.archived),
      );
      if (!config)
        throw new ProviderError(
          'PROVIDER_NOT_FOUND',
          'Provider configuration is unavailable',
        );
      return createVideoAdapter(config, transportFactory(config));
    },
  };
}
export function createImageRegistry(
  configs: ProviderConfig[],
  transportFactory: (config: ProviderConfig) => ProviderTransport,
) {
  return {
    get(id: string): ImageAdapter {
      const config = configs.find((c) => c.id === id && !c.archived);
      if (!config)
        throw new ProviderError(
          'PROVIDER_NOT_FOUND',
          'Provider configuration is unavailable',
        );
      return createImageAdapter(config, transportFactory(config));
    },
  };
}
