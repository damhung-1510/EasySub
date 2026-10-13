import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProviderConfig,
  ProviderDraft,
  ProviderPublicConfig,
} from '../../types/videoProvider';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import { createCredentialStore, type SecretCodec } from './credentialStore';
import { validateProviderProfile } from './providers/profileValidation';
import { validateNetworkUrl } from './transport';
export function validateProviderDraft(raw: ProviderDraft): ProviderDraft {
  if (!raw || typeof raw !== 'object') throw Error('INVALID_PROVIDER');
  const allowed = new Set([
    'id',
    'expectedVersion',
    'name',
    'kind',
    'protocol',
    'baseUrl',
    'modelId',
    'modelVersion',
    'authMode',
    'authHeader',
    'timeoutMs',
    'concurrency',
    'accountId',
    'allowLocalHttp',
    'allowedAssetOrigins',
    'capabilities',
    'pricing',
    'profile',
    'parameters',
  ]);
  for (const key of Object.keys(raw))
    if (!allowed.has(key))
      throw Error(
        /key|secret|token/i.test(key)
          ? 'SECRET_IN_CONFIG'
          : 'INVALID_CONFIG_FIELD',
      );
  if (
    !raw.name?.trim() ||
    !raw.modelId?.trim() ||
    !['video', 'image'].includes(raw.kind) ||
    ![
      'veo-gemini',
      'seedance-ark',
      'custom-async-json',
      'gemini-image',
      'openai-image',
    ].includes(raw.protocol)
  )
    throw Error('INVALID_PROVIDER');
  if (
    (raw.kind === 'image' &&
      !['gemini-image', 'openai-image'].includes(raw.protocol)) ||
    (raw.kind === 'video' &&
      ['gemini-image', 'openai-image'].includes(raw.protocol))
  )
    throw Error('UNSUPPORTED_PROTOCOL');
  validateNetworkUrl(raw.baseUrl, raw.allowLocalHttp);
  const u = new URL(raw.baseUrl);
  if (u.search || u.hash) throw Error('INVALID_BASE_URL');
  if (
    !['none', 'bearer', 'header'].includes(raw.authMode) ||
    (raw.authMode === 'header' &&
      !/^[a-zA-Z0-9-]+$/.test(raw.authHeader || '')) ||
    /^(host|cookie|content-length|proxy-authorization)$/i.test(
      raw.authHeader || '',
    )
  )
    throw Error('INVALID_AUTH');
  if (
    !Number.isInteger(raw.timeoutMs) ||
    raw.timeoutMs < 1000 ||
    raw.timeoutMs > 600000 ||
    !Number.isInteger(raw.concurrency) ||
    raw.concurrency < 1 ||
    raw.concurrency > 20
  )
    throw Error('INVALID_LIMIT');
  if (raw.id && !/^[a-zA-Z0-9_-]+$/.test(raw.id))
    throw Error('INVALID_PROVIDER_ID');
  raw.allowedAssetOrigins?.forEach((origin) => {
    validateNetworkUrl(origin, raw.allowLocalHttp);
    if (new URL(origin).origin !== origin) throw Error('INVALID_ASSET_ORIGIN');
  });
  if (raw.protocol === 'custom-async-json') {
    validateProviderProfile(raw.profile);
    if (!raw.capabilities) throw Error('CAPABILITIES_REQUIRED');
  }
  if (raw.capabilities) {
    const c = raw.capabilities;
    if (
      ['text', 'image', 'references', 'audio', 'seed', 'cancel'].some(
        (k) => typeof c[k] !== 'boolean',
      ) ||
      !Number.isInteger(c.maxReferences) ||
      c.maxReferences < 0 ||
      c.maxReferences > 20 ||
      !Array.isArray(c.durationsMs) ||
      !c.durationsMs.length ||
      c.durationsMs.some(
        (v) => !Number.isSafeInteger(v) || v < 1 || v > 600000,
      ) ||
      !Array.isArray(c.aspectRatios) ||
      !c.aspectRatios.length ||
      c.aspectRatios.some((v) => typeof v !== 'string' || v.length > 30) ||
      !Array.isArray(c.resolutions) ||
      !c.resolutions.length ||
      c.resolutions.some((v) => typeof v !== 'string' || v.length > 30)
    )
      throw Error('INVALID_CAPABILITIES');
    c.verified = false;
  }
  if (
    raw.parameters &&
    Object.keys(raw.parameters).some(
      (k) => !['negativePrompt', 'personGeneration', 'watermark'].includes(k),
    )
  )
    throw Error('PARAMETER_NOT_ALLOWED');
  if (raw.pricing) {
    const p = raw.pricing;
    if (
      !/^[A-Z]{3}$/.test(p.currency) ||
      !p.source ||
      !Number.isFinite(Date.parse(p.capturedAt)) ||
      [p.minorPerSecond, p.minorPerImage].some(
        (v) => v !== undefined && (!Number.isSafeInteger(v) || v < 0),
      )
    )
      throw Error('INVALID_PRICING');
  }
  return structuredClone(raw);
}
export function createProviderSettings(root: string, codec: SecretCodec) {
  const file = path.join(root, 'providers.json');
  const credentials = createCredentialStore(root, codec);
  let tail = Promise.resolve();
  async function read(): Promise<ProviderConfig[]> {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(raw)) throw Error('INVALID_PROVIDER_STORE');
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async function dto(config: ProviderConfig): Promise<ProviderPublicConfig> {
    const status = await credentials.status(
      config.id + '_' + config.revisionId,
    );
    return {
      ...structuredClone(config),
      hasCredential: status !== 'none',
      credentialPersistence: status,
    };
  }
  function write<T>(action: () => Promise<T>): Promise<T> {
    const current = tail.then(action);
    tail = current.then(
      () => {},
      () => {},
    );
    return current;
  }
  return {
    async list() {
      return Promise.all((await read()).filter((c) => !c.archived).map(dto));
    },
    async get(id: string, revisionId?: string) {
      const configs = await read();
      const found = configs.find(
        (c) =>
          c.id === id &&
          (revisionId ? c.revisionId === revisionId : !c.archived),
      );
      if (!found) throw Error('PROVIDER_NOT_FOUND');
      return dto(found);
    },
    async getSecret(id: string, revisionId?: string) {
      const configs = await read();
      const found = revisionId
        ? configs.find((c) => c.id === id && c.revisionId === revisionId)
        : configs
            .filter((c) => c.id === id)
            .sort((a, b) => b.version - a.version)[0];
      if (!found) throw Error('PROVIDER_NOT_FOUND');
      return credentials.get(found.id + '_' + found.revisionId);
    },
    save(raw: ProviderDraft, secret?: string) {
      return write(async () => {
        const draft = validateProviderDraft(raw);
        const configs = await read();
        const previous = configs.find((c) => c.id === draft.id && !c.archived);
        if (draft.id && !previous) throw Error('PROVIDER_NOT_FOUND');
        if (previous && draft.expectedVersion !== previous.version)
          throw Error('VERSION_CONFLICT');
        const { expectedVersion: _, id: inputId, ...fields } = draft;
        const now = new Date().toISOString();
        const config: ProviderConfig = {
          ...fields,
          id: inputId || randomUUID(),
          version: (previous?.version || 0) + 1,
          revisionId: randomUUID(),
          createdAt: previous?.createdAt || now,
          updatedAt: now,
        };
        if (secret)
          await credentials.save(config.id + '_' + config.revisionId, secret);
        else if (previous) {
          const oldSecret = await credentials
            .get(previous.id + '_' + previous.revisionId)
            .catch(() => undefined);
          if (oldSecret)
            await credentials.save(
              config.id + '_' + config.revisionId,
              oldSecret,
            );
        }
        await fs.mkdir(root, { recursive: true });
        await atomicReplaceTextFile(
          file,
          JSON.stringify([
            ...configs.map((c) =>
              c === previous ? { ...c, archived: true } : c,
            ),
            config,
          ]),
        );
        return dto(config);
      });
    },
    delete(id: string) {
      return write(async () => {
        const configs = await read();
        if (!configs.some((c) => c.id === id && !c.archived))
          throw Error('PROVIDER_NOT_FOUND');
        await atomicReplaceTextFile(
          file,
          JSON.stringify(
            configs.map((c) => (c.id === id ? { ...c, archived: true } : c)),
          ),
        );
      });
    },
    async exportConfig(id: string) {
      const config = (await read()).find((c) => c.id === id && !c.archived);
      if (!config) throw Error('PROVIDER_NOT_FOUND');
      const {
        id: _,
        revisionId: __,
        version: ___,
        createdAt: ____,
        updatedAt: _____,
        archived: ______,
        verifiedAt: _______,
        ...draft
      } = config;
      return draft;
    },
    importConfig(raw: unknown) {
      return validateProviderDraft(raw as ProviderDraft);
    },
  };
}
export type ProviderSettings = ReturnType<typeof createProviderSettings>;
