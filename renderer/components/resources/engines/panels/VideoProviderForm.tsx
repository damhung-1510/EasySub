import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigationGuard } from '../../../../context/NavigationGuardContext';
import { videoProviderDraft } from '../../../../lib/videoProviderDraft';
import type {
  ProviderDraft,
  ProviderPublicConfig,
  ProviderProtocol,
} from '../../../../../types/videoProvider';
export type ProviderSaveDraft = ProviderDraft & { secret?: string };
export default function VideoProviderForm({
  provider,
  onSave,
  imagesOnly = false,
}: {
  provider?: ProviderPublicConfig;
  imagesOnly?: boolean;
  onSave: (
    draft: ProviderSaveDraft,
    expectedVersion: number,
  ) => Promise<unknown>;
}) {
  const { t } = useTranslation('resources');
  const initial: ProviderDraft = provider
    ? videoProviderDraft(provider)
    : {
        name: '',
        kind: imagesOnly ? 'image' : 'video',
        protocol: imagesOnly ? 'gemini-image' : 'veo-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelId: imagesOnly
          ? 'gemini-2.5-flash-image'
          : 'veo-3.1-generate-preview',
        authMode: 'header',
        authHeader: 'x-goog-api-key',
        timeoutMs: 120000,
        concurrency: 1,
      };
  const [draft, setDraft] = useState<ProviderDraft>(initial);
  const [secret, setSecret] = useState('');
  const initialAdvanced = JSON.stringify(
    {
      capabilities: initial.capabilities,
      pricing: initial.pricing,
      profile: initial.profile,
      parameters: initial.parameters,
    },
    null,
    2,
  );
  const [advanced, setAdvanced] = useState(initialAdvanced);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const change = (key: keyof ProviderDraft, value: unknown) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const secretRequired =
    draft.authMode !== 'none' &&
    (!provider?.hasCredential ||
      draft.protocol !== provider.protocol ||
      draft.authMode !== provider.authMode);
  const requiredComplete =
    !!draft.name.trim() &&
    !!draft.baseUrl.trim() &&
    !!draft.modelId.trim() &&
    (draft.authMode !== 'header' || !!draft.authHeader?.trim()) &&
    (!secretRequired || !!secret.trim());
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    !!secret ||
    advanced !== initialAdvanced;
  const keyGuide =
    draft.protocol === 'veo-gemini' || draft.protocol === 'gemini-image'
      ? {
          intro: 'keyHelpGemini',
          link: 'keyLinkGemini',
          url: 'https://aistudio.google.com/apikey',
        }
      : draft.protocol === 'seedance-ark'
        ? {
            intro: 'keyHelpSeedance',
            link: 'keyLinkSeedance',
            url: 'https://ark.volcengine.com/region:cn-beijing/apikey',
          }
        : draft.protocol === 'openai-image'
          ? {
              intro: 'keyHelpOpenAI',
              link: 'keyLinkOpenAI',
              url: 'https://platform.openai.com/api-keys',
            }
          : null;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (!requiredComplete) throw new Error(t('videoProviders.requiredHint'));
      const extra = JSON.parse(advanced);
      for (const k of Object.keys(extra))
        if (!['capabilities', 'pricing', 'profile', 'parameters'].includes(k))
          throw new Error('INVALID_PROVIDER_OPTIONS');
      await onSave(
        { ...draft, ...extra, ...(secret ? { secret } : {}) },
        provider?.version ?? 0,
      );
      setSecret('');
      setSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  useNavigationGuard('video-provider-draft', {
    isDirty: dirty && !saved,
    onSave: save,
    onDiscard: () => {
      setDraft(initial);
      setSecret('');
      setAdvanced(initialAdvanced);
    },
  });
  const input = (
    key: keyof ProviderDraft,
    label: string,
    type = 'text',
    required = false,
    hint?: string,
  ) => (
    <label className="block space-y-1.5 text-sm" key={key}>
      <span className="font-medium">
        {t(`videoProviders.${label}`)}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <Input
        aria-label={t(`videoProviders.${label}`)}
        type={type}
        required={required}
        value={String(draft[key] ?? '')}
        onChange={(e) =>
          change(
            key,
            type === 'number' ? Number(e.target.value) : e.target.value,
          )
        }
      />
      {hint && (
        <span className="block text-xs text-muted-foreground">
          {t(`videoProviders.${hint}`)}
        </span>
      )}
    </label>
  );
  const chooseProtocol = (protocol: ProviderProtocol) => {
    const defaults: Partial<ProviderDraft> =
      protocol === 'veo-gemini'
        ? {
            kind: 'video',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            modelId: 'veo-3.1-generate-preview',
            authMode: 'header',
            authHeader: 'x-goog-api-key',
          }
        : protocol === 'seedance-ark'
          ? {
              kind: 'video',
              baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
              modelId: '',
              authMode: 'bearer',
            }
          : protocol === 'gemini-image'
            ? {
                kind: 'image',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                modelId: 'gemini-2.5-flash-image',
                authMode: 'header',
                authHeader: 'x-goog-api-key',
              }
            : protocol === 'openai-image'
              ? {
                  kind: 'image',
                  baseUrl: 'https://api.openai.com/v1',
                  modelId: 'gpt-image-1',
                  authMode: 'bearer',
                }
              : { kind: 'video', baseUrl: '', modelId: '', authMode: 'bearer' };
    setDraft((d) => ({ ...d, ...defaults, protocol }));
    setSaved(false);
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save().catch(() => {});
      }}
    >
      <div className="border-b pb-3">
        <h3 className="font-medium">
          {provider?.name || t('videoProviders.add')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('videoProviders.requiredHint')}
        </p>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">
          {t('videoProviders.protocol')}
          <span className="text-destructive"> *</span>
        </span>
        <select
          aria-label={t('videoProviders.protocol')}
          required
          className="block w-full rounded border bg-background p-2"
          value={draft.protocol}
          onChange={(e) => chooseProtocol(e.target.value as ProviderProtocol)}
        >
          {(imagesOnly
            ? ['gemini-image', 'openai-image']
            : [
                'veo-gemini',
                'seedance-ark',
                'custom-async-json',
                'gemini-image',
                'openai-image',
              ]
          ).map((p) => (
            <option key={p} value={p}>
              {t(`videoProviders.protocols.${p}`)}
            </option>
          ))}
        </select>
      </label>
      {input('name', 'name', 'text', true)}
      {input('baseUrl', 'baseUrl', 'url', true, 'baseUrlHint')}
      {draft.authMode !== 'none' && (
        <div className="space-y-1.5 text-sm">
          <label htmlFor="video-provider-secret" className="font-medium">
            {t('videoProviders.apiKey')}
            {secretRequired && <span className="text-destructive"> *</span>}
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id="video-provider-secret"
              aria-label={t('videoProviders.apiKey')}
              type={showSecret ? 'text' : 'password'}
              required={secretRequired}
              autoComplete="new-password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setSaved(false);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t(
                showSecret
                  ? 'videoProviders.hideKey'
                  : 'videoProviders.showKey',
              )}
              onClick={() => setShowSecret((value) => !value)}
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {t(
              provider?.hasCredential && !secretRequired
                ? 'videoProviders.secretStored'
                : 'videoProviders.secretHint',
            )}
          </span>
          {keyGuide && (
            <p className="text-xs text-muted-foreground">
              {t(`videoProviders.${keyGuide.intro}`)}{' '}
              <a
                href={keyGuide.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {t(`videoProviders.${keyGuide.link}`)}
              </a>
              {t('videoProviders.keyHelpLocal')}
            </p>
          )}
        </div>
      )}
      {input(
        'modelId',
        'model',
        'text',
        true,
        draft.protocol === 'seedance-ark' ? 'modelHintSeedance' : 'modelHint',
      )}
      <details
        key={draft.protocol}
        className="rounded border p-3"
        open={draft.protocol === 'custom-async-json' ? true : undefined}
      >
        <summary className="cursor-pointer text-sm font-medium">
          {t('videoProviders.advanced')}
        </summary>
        <div className="mt-3 space-y-3">
          {input('modelVersion', 'modelVersion')}
          <label className="block space-y-1.5 text-sm">
            <span>{t('videoProviders.authMode')}</span>
            <select
              aria-label={t('videoProviders.authMode')}
              className="block w-full rounded border bg-background p-2"
              value={draft.authMode}
              onChange={(e) => change('authMode', e.target.value)}
            >
              {['none', 'bearer', 'header'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          {draft.authMode === 'header' &&
            input('authHeader', 'authHeader', 'text', true)}
          <label className="block text-sm">
            {t('videoProviders.allowedAssetOrigins')}
            <Input
              value={(draft.allowedAssetOrigins ?? []).join(', ')}
              onChange={(e) =>
                change(
                  'allowedAssetOrigins',
                  e.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
            <span className="text-xs text-muted-foreground">
              {t('videoProviders.allowedAssetOriginsHint')}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {input('timeoutMs', 'timeout', 'number')}
            {input('concurrency', 'concurrency', 'number')}
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!draft.allowLocalHttp}
              onChange={(e) => change('allowLocalHttp', e.target.checked)}
            />
            {t('videoProviders.localHttp')}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('videoProviders.advancedHint')}
          </p>
          <textarea
            aria-label={t('videoProviders.advanced')}
            value={advanced}
            onChange={(e) => {
              setAdvanced(e.target.value);
              setSaved(false);
            }}
            className="min-h-48 w-full rounded border bg-background p-2 font-mono text-xs"
          />
        </div>
      </details>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {saved && <p role="status">{t('videoProviders.saved')}</p>}
      <Button type="submit" disabled={busy || !requiredComplete}>
        {t('videoProviders.save')}
      </Button>
    </form>
  );
}
