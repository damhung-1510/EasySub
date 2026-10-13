import fs from 'node:fs/promises';
import type { ImageAdapter, ImageRequest } from '../../../types/videoProvider';
import { ProviderError } from '../../../types/videoProvider';
export function createFakeImageAdapter(
  fixturePath: string,
  references = true,
): ImageAdapter & { submitCalls: number; requests: ImageRequest[] } {
  const adapter = {
    submitCalls: 0,
    requests: [] as ImageRequest[],
    capabilities: () => ({
      references,
      maxReferences: references ? 3 : 0,
      verified: true,
    }),
    quote: async () => ({
      currency: 'USD',
      maxMinor: 0,
      confidence: 'exact' as const,
      capturedAt: new Date().toISOString(),
      components: [{ label: 'test fixture', minor: 0 }],
    }),
    async generate(request: ImageRequest, signal: AbortSignal) {
      signal.throwIfAborted();
      if (request.references.length && !references)
        throw new ProviderError(
          'REFERENCE_CAPABILITY_REQUIRED',
          'Fixture does not accept references',
        );
      adapter.submitCalls++;
      adapter.requests.push(structuredClone(request));
      return {
        bytes: await fs.readFile(fixturePath, { signal }),
        mimeType: 'image/png',
        actualCost: { currency: 'USD', minor: 0 },
      };
    },
  };
  return adapter;
}
