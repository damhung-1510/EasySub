import type {
  ProviderProtocolProfile,
  JsonValue,
} from '../../../types/videoProviderProfile';
const variables = new Set([
  'model',
  'prompt',
  'durationSeconds',
  'aspectRatio',
  'resolution',
  'references',
  'remoteJobId',
]);
export function validateProviderProfile(raw: unknown): ProviderProtocolProfile {
  const p = raw as ProviderProtocolProfile;
  const fail = () => {
    throw Error('INVALID_PROFILE');
  };
  if (
    !p ||
    typeof p !== 'object' ||
    typeof p.id !== 'string' ||
    !Number.isInteger(p.revision) ||
    p.revision < 1 ||
    JSON.stringify(p).length > 1024 * 1024
  )
    fail();
  function inspect(value: JsonValue, depth = 0) {
    if (depth > 20) fail();
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{(.*?)\}\}/g))
        if (!variables.has(match[1])) fail();
      if (/\{\{|\}\}/.test(value.replace(/\{\{\w+\}\}/g, ''))) fail();
    } else if (Array.isArray(value))
      value.forEach((v) => inspect(v, depth + 1));
    else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) {
        if (
          [
            '__proto__',
            'constructor',
            'prototype',
            'authorization',
            'apiKey',
            'api_key',
            'secret',
          ].includes(key)
        )
          fail();
        inspect(v, depth + 1);
      }
    }
  }
  for (const [kind, endpoint] of Object.entries({
    submit: p.submit,
    poll: p.poll,
    ...(p.cancel ? { cancel: p.cancel } : {}),
  })) {
    if (
      !endpoint ||
      !['GET', 'POST', 'DELETE'].includes(endpoint.method) ||
      typeof endpoint.path !== 'string' ||
      endpoint.path.startsWith('/') ||
      endpoint.path.includes('..') ||
      endpoint.path.includes('://') ||
      endpoint.path.includes('\\') ||
      endpoint.path.includes('?') ||
      endpoint.path.includes('#')
    )
      fail();
    if (
      (kind === 'submit' && endpoint.method !== 'POST') ||
      (kind === 'poll' && endpoint.method !== 'GET')
    )
      fail();
    inspect(endpoint.path);
    if (endpoint.body !== undefined) inspect(endpoint.body);
  }
  const mapping = p.mapping;
  if (!mapping || !mapping.states) fail();
  for (const key of ['jobId', 'status', 'resultUrl'] as const)
    if (
      typeof mapping[key] !== 'string' ||
      !mapping[key] ||
      !/^\w+(\.\w+)*$/.test(mapping[key]) ||
      mapping[key]
        .split('.')
        .some((k) => ['__proto__', 'constructor', 'prototype'].includes(k))
    )
      fail();
  const values = Object.values(mapping.states);
  if (
    !values.includes('completed') ||
    !values.includes('failed') ||
    values.some(
      (v) =>
        !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(v),
    )
  )
    fail();
  return structuredClone(p);
}
