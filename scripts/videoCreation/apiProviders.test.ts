import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrimaryVideoAdapter } from '../../main/videoCreation/providers/primaryVideo';
import { createImageAdapter } from '../../main/videoCreation/providers/imageProvider';
import { createCustomAdapter } from '../../main/videoCreation/providers/customProfile';
import {
  createTransport,
  type HttpClient,
  type ProviderTransport,
} from '../../main/videoCreation/transport';
import type { ProviderConfig, VideoRequest } from '../../types/videoProvider';
const signal = new AbortController().signal;
export const config: ProviderConfig = {
  id: 'provider',
  version: 1,
  revisionId: 'config-v1',
  name: 'Veo',
  kind: 'video',
  protocol: 'veo-gemini',
  modelId: 'veo-3.1-generate-preview',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  authMode: 'header',
  authHeader: 'x-goog-api-key',
  concurrency: 1,
  timeoutMs: 30000,
  createdAt: 'today',
  updatedAt: 'today',
};
export const request: VideoRequest = {
  requestId: 'request',
  fingerprint: 'fp',
  prompt: 'A person walking',
  modelId: config.modelId,
  durationMs: 8000,
  aspectRatio: '16:9',
  resolution: '720p',
  references: [
    { assetId: 'portrait', mimeType: 'image/png', dataBase64: 'abc' },
  ],
  audioMode: 'native',
};
test('Veo submits correct inline references and resolves native operation output', async () => {
  const calls: unknown[] = [];
  const transport: ProviderTransport = {
    async json(endpoint, method, body) {
      calls.push({ endpoint, method, body });
      return method === 'POST'
        ? { name: 'models/model/operations/123' }
        : {
            name: 'models/model/operations/123',
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: 'https://generativelanguage.googleapis.com/download/1',
                    },
                  },
                ],
              },
            },
          };
    },
    async bytes() {
      throw Error('unused');
    },
  };
  const adapter = createPrimaryVideoAdapter(config, transport);
  const job = await adapter.submit(request, signal);
  assert.equal(job.id, 'models/model/operations/123');
  const post = calls[0] as {
    body: { instances: { referenceImages: unknown[] }[] };
  };
  assert.equal(post.body.instances[0].referenceImages.length, 1);
  assert.equal((await adapter.poll(job.id, signal)).state, 'completed');
  assert.equal(
    createPrimaryVideoAdapter(
      { ...config, modelId: 'veo-3.0-generate-001' },
      transport,
    ).capabilities().references,
    false,
  );
  await assert.rejects(
    adapter.submit(
      {
        ...request,
        references: [
          ...request.references,
          ...request.references,
          ...request.references,
          ...request.references,
        ],
      },
      signal,
    ),
    /REFERENCE_LIMIT/,
  );
});
test('Seedance uses native task path and approved inline image data', async () => {
  const calls: any[] = [];
  const adapter = createPrimaryVideoAdapter(
    {
      ...config,
      protocol: 'seedance-ark',
      modelId: 'seedance-1-5-pro-251215',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    },
    {
      async json(endpoint, method, body) {
        calls.push({ endpoint, method, body });
        return method === 'POST'
          ? { id: 'ark-job' }
          : {
              id: 'ark-job',
              status: 'succeeded',
              content: { video_url: 'https://approved.test/movie.mp4' },
            };
      },
      async bytes() {
        throw Error('unused');
      },
    },
  );
  const job = await adapter.submit(
    {
      ...request,
      modelId: 'seedance-1-5-pro-251215',
      references: [{ ...request.references[0], role: 'firstFrame' }],
      durationMs: 5000,
    },
    signal,
  );
  assert.equal(calls[0].endpoint, 'contents/generations/tasks');
  assert.equal(calls[0].body.content[1].role, 'first_frame');
  assert.match(
    calls[0].body.content[1].image_url.url,
    /^data:image\/png;base64,/,
  );
  assert.equal((await adapter.poll(job.id, signal)).state, 'completed');
});
test('Gemini image edits carry approved portrait and parse inline result', async () => {
  let sent: any;
  const adapter = createImageAdapter(
    {
      ...config,
      kind: 'image',
      protocol: 'gemini-image',
      modelId: 'gemini-2.5-flash-image',
    },
    {
      async json(_endpoint, _method, body) {
        sent = body;
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: Buffer.from('image bytes').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        };
      },
      async bytes() {
        throw Error('unused');
      },
    },
  );
  const image = await adapter.generate(
    {
      requestId: 'image',
      fingerprint: 'fp',
      modelId: 'gemini-2.5-flash-image',
      prompt: 'Show full body',
      references: request.references,
    },
    signal,
  );
  assert.equal(sent.contents[0].parts[1].inlineData.data, 'abc');
  assert.equal(image.bytes.toString(), 'image bytes');
});
test('custom mapping is declarative and preserves references', async () => {
  let sent: any;
  const profile = {
    id: 'profile',
    revision: 1,
    submit: {
      method: 'POST' as const,
      path: 'tasks',
      body: {
        model: '{{model}}',
        prompt: '{{prompt}}',
        references: '{{references}}',
      },
    },
    poll: { method: 'GET' as const, path: 'tasks/{{remoteJobId}}' },
    mapping: {
      jobId: 'data.id',
      status: 'data.status',
      resultUrl: 'data.output.url',
      states: {
        new: 'queued' as const,
        done: 'completed' as const,
        error: 'failed' as const,
      },
    },
  };
  const adapter = createCustomAdapter(
    {
      ...config,
      protocol: 'custom-async-json',
      profile,
      capabilities: {
        ...createPrimaryVideoAdapter(config, {} as never).capabilities(),
        verified: false,
      },
    },
    profile,
    {
      async json(_path, method, body) {
        sent = body;
        return {
          data: {
            id: 'custom-123',
            status: method === 'POST' ? 'new' : 'done',
            output: { url: 'https://approved.test/result.mp4' },
          },
        };
      },
      async bytes() {
        throw Error('unused');
      },
    },
  );
  assert.equal((await adapter.submit(request, signal)).id, 'custom-123');
  assert.equal(sent.references.length, 1);
  assert.equal((await adapter.poll('custom-123', signal)).state, 'completed');
});
test('custom completed response without a mapped result remains unknown', async () => {
  const profile = {
    id: 'profile',
    revision: 1,
    submit: {
      method: 'POST' as const,
      path: 'tasks',
      body: { prompt: '{{prompt}}' },
    },
    poll: { method: 'GET' as const, path: 'tasks/{{remoteJobId}}' },
    mapping: {
      jobId: 'data.id',
      status: 'data.status',
      resultUrl: 'data.output.url',
      states: {
        new: 'queued' as const,
        done: 'completed' as const,
        error: 'failed' as const,
      },
    },
  };
  const adapter = createCustomAdapter(
    {
      ...config,
      protocol: 'custom-async-json',
      profile,
      capabilities: {
        ...createPrimaryVideoAdapter(config, {} as never).capabilities(),
        verified: false,
      },
    },
    profile,
    {
      json: async () => ({ data: { id: 'accepted-id', status: 'done' } }),
      bytes: async () => {
        throw Error('unused');
      },
    },
  );
  await assert.rejects(
    adapter.poll('accepted-id', signal),
    (error: any) =>
      error.code === 'RESPONSE_MAPPING_FAILED' &&
      error.outcome === 'unknown' &&
      error.remoteJobId === 'accepted-id',
  );
});
test('transport strips credentials across approved redirects and unknown POST never retries', async () => {
  const requests: any[] = [];
  const http: HttpClient = async (input) => {
    requests.push(input);
    return requests.length === 1
      ? {
          status: 302,
          headers: { location: 'https://output.test/result.mp4' },
          bytes: Buffer.alloc(0),
        }
      : {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
          bytes: Buffer.from('bytes'),
        };
  };
  const transport = createTransport(
    { ...config, allowedAssetOrigins: ['https://output.test'] },
    async () => 'secret',
    http,
  );
  await transport.bytes(config.baseUrl + '/download', signal);
  assert.equal(requests[0].headers['x-goog-api-key'], 'secret');
  assert.equal(requests[1].headers['x-goog-api-key'], undefined);
  let submits = 0;
  const broken = createTransport(
    config,
    async () => 'secret',
    async () => {
      submits++;
      throw Error('timeout');
    },
  );
  await assert.rejects(broken.json('tasks', 'POST', {}, signal), (error) =>
    Boolean((error as any).outcome === 'unknown'),
  );
  assert.equal(submits, 1);
  await assert.rejects(
    transport.bytes('https://unknown.test/file', signal),
    /Approve/,
  );
});
test('Veo quotes reject combined constraints before a provider request', async () => {
  let calls = 0;
  const api = createPrimaryVideoAdapter(config, {
    json: async () => {
      calls++;
      return { name: 'models/model/operations/new' };
    },
    bytes: async () => {
      throw Error('unused');
    },
  });
  await assert.rejects(
    api.quote({ ...request, durationMs: 4000 }, signal),
    /REFERENCE_DURATION_REQUIRED/,
  );
  await assert.rejects(
    api.quote(
      { ...request, references: [], durationMs: 4000, resolution: '1080p' },
      signal,
    ),
    /RESOLUTION_DURATION_REQUIRED/,
  );
  await assert.rejects(
    api.quote(
      { ...request, references: [], durationMs: 6000, resolution: '4k' },
      signal,
    ),
    /RESOLUTION_DURATION_REQUIRED/,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await api.quote(
        {
          ...request,
          durationMs: 4000,
          references: request.references.map((reference) => ({
            ...reference,
            role: 'firstFrame' as const,
          })),
        },
        signal,
      )
    ).confidence,
    'unknown',
  );
  assert.equal(
    (await api.quote({ ...request, references: [], durationMs: 4000 }, signal))
      .confidence,
    'unknown',
  );
});
