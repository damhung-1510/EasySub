import http from 'node:http';
import https from 'node:https';
import type { ProviderConfig } from '../../types/videoProvider';
import { ProviderError } from '../../types/videoProvider';
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: Buffer;
  signal: AbortSignal;
  maxBytes: number;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
}
export type HttpClient = (input: HttpRequest) => Promise<HttpResponse>;
export interface ProviderTransport {
  json(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
  bytes(
    url: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; mimeType: string }>;
}
export function validateNetworkUrl(value: string, allowLocalHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error('INVALID_URL');
  }
  if (url.username || url.password) throw Error('URL_CREDENTIALS_FORBIDDEN');
  const host = url.hostname.toLowerCase();
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && allowLocalHttp && local)
  )
    throw Error('HTTPS_REQUIRED');
  if (
    !local &&
    (/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) ||
      host === '[::]' ||
      host.endsWith('.local'))
  )
    throw Error('NETWORK_ADDRESS_FORBIDDEN');
  return url;
}
/** Uses the application's configured Node globalAgents, including existing proxy configuration. */
export const nodeHttpClient: HttpClient = (input) =>
  new Promise((resolve, reject) => {
    const client = input.url.startsWith('https:') ? https : http;
    const req = client.request(
      input.url,
      { method: input.method, headers: input.headers, signal: input.signal },
      (res) => {
        const chunks: Buffer[] = [];
        let count = 0;
        res.on('data', (chunk: Buffer) => {
          count += chunk.length;
          if (count > input.maxBytes) {
            res.destroy();
            reject(
              new ProviderError(
                'RESPONSE_TOO_LARGE',
                'Provider response exceeds size limit',
              ),
            );
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers: Record<string, string> = {};
          Object.entries(res.headers).forEach(([key, v]) => {
            if (v !== undefined)
              headers[key] = Array.isArray(v) ? v.join(',') : v;
          });
          resolve({
            status: res.statusCode || 0,
            headers,
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    if (input.body) req.write(input.body);
    req.end();
  });
export function createTransport(
  config: ProviderConfig,
  getSecret: () => Promise<string> = async () => '',
  httpClient: HttpClient = nodeHttpClient,
): ProviderTransport {
  const base = validateNetworkUrl(config.baseUrl, config.allowLocalHttp);
  const gemini =
    config.protocol === 'veo-gemini' || config.protocol === 'gemini-image';
  const rootUrl =
    gemini && base.pathname === '/'
      ? base.origin + '/v1beta/'
      : base.toString().replace(/\/$/, '') + '/';
  const allowed = new Set([base.origin, ...(config.allowedAssetOrigins || [])]);
  async function run(
    urlText: string,
    method: 'GET' | 'POST' | 'DELETE',
    body: unknown,
    signal: AbortSignal,
    asset = false,
  ): Promise<HttpResponse> {
    signal.throwIfAborted();
    let url = validateNetworkUrl(urlText, config.allowLocalHttp);
    if (!allowed.has(url.origin))
      throw new ProviderError(
        'ASSET_ORIGIN_NOT_APPROVED',
        'Approve the output origin in Engine settings',
      );
    const headers: Record<string, string> = {};
    if (!asset) headers['content-type'] = 'application/json';
    const authName =
      config.authMode === 'bearer' ? 'authorization' : config.authHeader;
    if (url.origin === base.origin && config.authMode !== 'none' && authName)
      headers[authName] =
        config.authMode === 'bearer'
          ? 'Bearer ' + (await getSecret())
          : await getSecret();
    const payload =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > 100 * 1024 * 1024)
      throw new ProviderError(
        'REQUEST_TOO_LARGE',
        'Request exceeds size limit',
      );
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const effective = AbortSignal.any([signal, timeout]);
    let currentHeaders = { ...headers };
    for (let redirects = 0; redirects < 6; redirects++) {
      let res: HttpResponse;
      try {
        res = await httpClient({
          url: url.toString(),
          method,
          headers: currentHeaders,
          body: payload,
          signal: effective,
          maxBytes: asset ? 1024 * 1024 * 1024 : 100 * 1024 * 1024,
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          'NETWORK_ERROR',
          method === 'POST'
            ? 'Submission outcome is unknown; reconcile before trying again'
            : 'Provider read failed',
          method === 'POST' ? 'unknown' : 'failed',
          method !== 'POST',
        );
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (method !== 'GET')
          throw new ProviderError(
            'SUBMIT_REDIRECT',
            'Submission redirect requires endpoint configuration',
            'unknown',
          );
        if (!res.headers.location)
          throw new ProviderError(
            'INVALID_REDIRECT',
            'Missing redirect target',
          );
        const next = validateNetworkUrl(
          new URL(res.headers.location, url).toString(),
          config.allowLocalHttp,
        );
        if (!allowed.has(next.origin))
          throw new ProviderError(
            'ASSET_ORIGIN_NOT_APPROVED',
            'Redirect origin is not approved',
          );
        if (next.origin !== url.origin)
          currentHeaders = {
            ...currentHeaders,
            ...(authName ? { [authName]: undefined } : {}),
          } as Record<string, string>;
        Object.keys(currentHeaders).forEach((k) => {
          if (currentHeaders[k] === undefined) delete currentHeaders[k];
        });
        url = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        const retryHeader = res.headers['retry-after'];
        const retryMs = retryHeader
          ? Number.isFinite(Number(retryHeader))
            ? Number(retryHeader) * 1000
            : Math.max(0, Date.parse(retryHeader) - Date.now())
          : undefined;
        throw new ProviderError(
          res.status === 429
            ? 'RATE_LIMIT'
            : res.status === 401 || res.status === 403
              ? 'AUTH_FAILED'
              : 'HTTP_' + res.status,
          'Provider returned HTTP ' + res.status,
          method === 'POST' && res.status >= 500 ? 'unknown' : 'failed',
          method === 'GET' && (res.status === 429 || res.status >= 500),
          retryMs,
        );
      }
      return res;
    }
    throw new ProviderError('REDIRECT_LIMIT', 'Too many redirects');
  }
  return {
    async json(endpoint, method, body, signal) {
      if (
        endpoint.startsWith('/') ||
        endpoint.includes('..') ||
        endpoint.includes('://') ||
        endpoint.includes('\\')
      )
        throw new ProviderError(
          'INVALID_ENDPOINT',
          'Use a relative API endpoint',
        );
      const res = await run(
        new URL(endpoint, rootUrl).toString(),
        method,
        body,
        signal,
      );
      try {
        return JSON.parse(res.bytes.toString('utf8'));
      } catch {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Provider response is not JSON',
          method === 'POST' ? 'unknown' : 'failed',
        );
      }
    },
    async bytes(url, signal) {
      const response = await run(url, 'GET', undefined, signal, true);
      return {
        bytes: response.bytes,
        mimeType: (response.headers['content-type'] || '').split(';')[0],
      };
    },
  };
}
export function redactDiagnostic(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (/authorization|api.?key|secret|token|cookie|url/i.test(_key))
      return '[redacted]';
    return entry;
  });
}
