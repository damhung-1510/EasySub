import test from 'node:test';
import assert from 'node:assert/strict';
import { testProviderConnection } from '../../main/videoCreation/providerConnectionTest';
import type { ProviderPublicConfig } from '../../types/videoProvider';
import type { HttpClient } from '../../main/videoCreation/transport';

const config: ProviderPublicConfig = {
  id: 'gemini-provider',
  version: 1,
  revisionId: 'revision',
  name: 'Veo',
  kind: 'video',
  protocol: 'veo-gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelId: 'veo-3.1-generate-preview',
  authMode: 'header',
  authHeader: 'x-goog-api-key',
  timeoutMs: 1000,
  concurrency: 1,
  createdAt: 'today',
  updatedAt: 'today',
  hasCredential: true,
  credentialPersistence: 'encrypted',
};

test('Gemini connection probe uses only a read-only model-list request', async () => {
  const requests: Parameters<HttpClient>[0][] = [];
  const client: HttpClient = async (input) => {
    requests.push(input);
    return {
      status: 200,
      headers: {},
      bytes: Buffer.from(JSON.stringify({ models: [{ name: 'models/test' }] })),
    };
  };
  const result = await testProviderConnection(
    config,
    async () => 'private-key',
    client,
  );
  assert.deepEqual(result, {
    providerId: config.id,
    status: 'ok',
    code: 'READ_ONLY_CONNECTION_OK',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(
    requests[0].url,
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
  );
  assert.equal(requests[0].headers['x-goog-api-key'], 'private-key');
  assert.equal(requests[0].body, undefined);
  assert.equal(JSON.stringify(result).includes('private-key'), false);
});

test('probe distinguishes rejected credentials from unavailable service', async () => {
  const unauthorized = await testProviderConnection(
    config,
    async () => 'bad-key',
    async () => ({ status: 401, headers: {}, bytes: Buffer.from('{}') }),
  );
  assert.equal(unauthorized.code, 'AUTH_FAILED');
  assert.equal(unauthorized.status, 'failed');

  const unavailable = await testProviderConnection(
    config,
    async () => 'key',
    async () => {
      throw Error('offline');
    },
  );
  assert.equal(unavailable.code, 'CONNECTION_UNAVAILABLE');
  assert.equal(unavailable.status, 'inconclusive');
});

test('probe explains incompatible Gemini URL and skips custom API network calls', async () => {
  let called = false;
  const client: HttpClient = async () => {
    called = true;
    throw Error('unexpected request');
  };
  const wrongUrl = await testProviderConnection(
    {
      ...config,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    async () => 'key',
    client,
  );
  assert.equal(wrongUrl.code, 'INVALID_GEMINI_BASE_URL');
  const custom = await testProviderConnection(
    { ...config, protocol: 'custom-async-json' },
    async () => 'key',
    client,
  );
  assert.equal(custom.code, 'NO_SAFE_READ_ONLY_CHECK');
  assert.equal(called, false);
});

test('previous Gemini root URL is normalized to the v1beta API', async () => {
  const urls: string[] = [];
  const result = await testProviderConnection(
    { ...config, baseUrl: 'https://generativelanguage.googleapis.com' },
    async () => 'key',
    async (input) => {
      urls.push(input.url);
      return {
        status: 200,
        headers: {},
        bytes: Buffer.from('{"models":[]}'),
      };
    },
  );
  assert.equal(result.status, 'ok');
  assert.deepEqual(urls, [
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
  ]);
});

test('Seedance uses a read-only Ark files request with bearer auth', async () => {
  const requests: Parameters<HttpClient>[0][] = [];
  const result = await testProviderConnection(
    {
      ...config,
      protocol: 'seedance-ark',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      authMode: 'bearer',
    },
    async () => 'ark-key',
    async (input) => {
      requests.push(input);
      return { status: 200, headers: {}, bytes: Buffer.from('{"data":[]}') };
    },
  );
  assert.equal(result.status, 'ok');
  assert.equal(requests[0].method, 'GET');
  assert.equal(
    requests[0].url,
    'https://ark.cn-beijing.volces.com/api/v3/files?limit=1',
  );
  assert.equal(requests[0].headers.authorization, 'Bearer ark-key');
});
