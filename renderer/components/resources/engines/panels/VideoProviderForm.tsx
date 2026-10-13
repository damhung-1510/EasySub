import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
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
}: {
  provider?: ProviderPublicConfig;
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
        kind: 'video',
        protocol: 'veo-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'veo-3.0-generate-preview',
        authMode: 'header',
        authHeader: 'x-goog-api-key',
        timeoutMs: 120000,
        concurrency: 1,
      };
  const [draft, setDraft] = useState<ProviderDraft>(initial);
  const [secret, setSecret] = useState('');
  const [advanced, setAdvanced] = useState(
    JSON.stringify(
      {
        capabilities: initial.capabilities,
        pricing: initial.pricing,
        profile: initial.profile,
        parameters: initial.parameters,
      },
      null,
      2,
    ),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const change = (key: keyof ProviderDraft, value: unknown) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || !!secret;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
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
    },
  });
  const input = (key: keyof ProviderDraft, label: string, type = 'text') => (
    <label className="block text-sm" key={key}>
      {t(`videoProviders.${label}`)}
      <Input
        aria-label={t(`videoProviders.${label}`)}
        type={type}
        value={String(draft[key] ?? '')}
        onChange={(e) =>
          change(
            key,
            type === 'number' ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </label>
  );
  const chooseProtocol = (protocol: ProviderProtocol) => {
    const defaults: Partial<ProviderDraft> =
      protocol === 'veo-gemini'
        ? {
            kind: 'video',
            baseUrl: 'https://generativelanguage.googleapis.com',
            modelId: 'veo-3.0-generate-preview',
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
                baseUrl: 'https://generativelanguage.googleapis.com',
                modelId: '',
                authMode: 'header',
                authHeader: 'x-goog-api-key',
              }
            : protocol === 'openai-image'
              ? {
                  kind: 'image',
                  baseUrl: 'https://api.openai.com/v1',
                  modelId: '',
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
      {provider && (
        <p className="text-sm text-muted-foreground">
          {t(
            provider.verifiedAt
              ? 'videoProviders.verified'
              : 'videoProviders.unverified',
          )}{' '}
          · {provider.modelId}
        </p>
      )}
      {input('name', 'name')}
      <label className="block text-sm">
        {t('videoProviders.protocol')}
        <select
          className="block w-full rounded border bg-background p-2"
          value={draft.protocol}
          onChange={(e) => chooseProtocol(e.target.value as ProviderProtocol)}
        >
          {[
            'veo-gemini',
            'seedance-ark',
            'custom-async-json',
            'gemini-image',
            'openai-image',
          ].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {input('baseUrl', 'baseUrl')}
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
      {input('modelId', 'model')}
      {input('modelVersion', 'modelVersion')}
      <label className="block text-sm">
        {t('videoProviders.authMode')}
        <select
          className="block w-full rounded border bg-background p-2"
          value={draft.authMode}
          onChange={(e) => change('authMode', e.target.value)}
        >
          {['none', 'bearer', 'header'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      {draft.authMode === 'header' && input('authHeader', 'authHeader')}
      {draft.authMode !== 'none' && (
        <label className="block text-sm">
          {t('videoProviders.apiKey')}
          <Input
            aria-label={t('videoProviders.apiKey')}
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setSaved(false);
            }}
          />
          <span className="text-xs text-muted-foreground">
            {t(
              provider?.hasCredential
                ? 'videoProviders.secretStored'
                : 'videoProviders.secretHint',
            )}
          </span>
        </label>
      )}
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
      <details>
        <summary>{t('videoProviders.advanced')}</summary>
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
      </details>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {saved && <p role="status">{t('videoProviders.saved')}</p>}
      <Button
        type="submit"
        disabled={
          busy ||
          !draft.name.trim() ||
          !draft.modelId.trim() ||
          !draft.baseUrl.trim()
        }
      >
        {t('videoProviders.save')}
      </Button>
    </form>
  );
}
