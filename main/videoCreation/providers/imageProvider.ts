import type {
  ProviderConfig,
  ImageAdapter,
} from '../../../types/videoProvider';
import { ProviderError } from '../../../types/videoProvider';
import type { ProviderTransport } from '../transport';
import { quoteConfigured, referenceData } from './primaryVideo';
/** Gemini generateContent legacy image protocol; no provider call occurs while configuring. */
export function createImageAdapter(
  config: ProviderConfig,
  transport: ProviderTransport,
): ImageAdapter {
  if (
    config.kind !== 'image' ||
    !['gemini-image', 'openai-image'].includes(config.protocol)
  )
    throw new ProviderError(
      'UNSUPPORTED_IMAGE_PROTOCOL',
      'Choose a supported image protocol',
    );
  const gemini = config.protocol === 'gemini-image';
  const models = gemini
    ? [
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview',
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image',
        'gemini-3.1-flash-image',
      ]
    : ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5'];
  if (!models.includes(config.modelId))
    throw new ProviderError(
      'UNSUPPORTED_MODEL',
      'Choose a documented image model',
    );
  const capabilities = {
    references: gemini,
    maxReferences: gemini ? 3 : 0,
    verified: !!config.verifiedAt,
  };
  return {
    capabilities: () => ({ ...capabilities }),
    quote: async () => quoteConfigured(config, 1, true),
    async generate(request, signal) {
      if (request.modelId !== config.modelId)
        throw new ProviderError(
          'MODEL_MISMATCH',
          'Request model differs from configuration',
        );
      if (!request.requestId || !request.fingerprint || !request.prompt)
        throw new ProviderError(
          'INVALID_REQUEST',
          'Prompt and request IDs are required',
        );
      if (request.references.length > capabilities.maxReferences)
        throw new ProviderError(
          'REFERENCE_LIMIT',
          'This image protocol cannot accept the requested references',
        );
      if (gemini) {
        const parts = [
          { text: request.prompt },
          ...request.references.map((r) => ({ inlineData: referenceData(r) })),
        ];
        const raw = (await transport.json(
          'models/' + encodeURIComponent(config.modelId) + ':generateContent',
          'POST',
          {
            contents: [{ role: 'user', parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          },
          signal,
        )) as any;
        const image = raw?.candidates
          ?.flatMap((c: any) => c.content?.parts || [])
          .find((p: any) => p.inlineData?.data)?.inlineData;
        if (
          !image ||
          typeof image.data !== 'string' ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
        )
          throw new ProviderError(
            'IMAGE_RESULT_MISSING',
            'Provider returned no usable image',
          );
        return {
          bytes: Buffer.from(image.data, 'base64'),
          mimeType: image.mimeType,
        };
      }
      const raw = (await transport.json(
        'images/generations',
        'POST',
        {
          model: config.modelId,
          prompt: request.prompt,
          n: 1,
          size:
            request.aspectRatio === '9:16'
              ? '1024x1536'
              : request.aspectRatio === '16:9'
                ? '1536x1024'
                : '1024x1024',
          output_format: 'png',
        },
        signal,
      )) as any;
      if (typeof raw?.data?.[0]?.b64_json !== 'string')
        throw new ProviderError(
          'IMAGE_RESULT_MISSING',
          'Provider returned no image bytes',
        );
      return {
        bytes: Buffer.from(raw.data[0].b64_json, 'base64'),
        mimeType: 'image/png',
      };
    },
  };
}
export const createPrimaryImageAdapter = createImageAdapter;
