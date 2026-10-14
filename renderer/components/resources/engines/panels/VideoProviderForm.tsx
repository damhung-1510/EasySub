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
  VideoCapabilities,
} from '../../../../../types/videoProvider';
import type { ProviderProtocolProfile } from '../../../../../types/videoProviderProfile';

const defaultCustomProfile: ProviderProtocolProfile = {
  id: 'custom-async-video',
  revision: 1,
  submit: {
    method: 'POST',
    path: 'tasks',
    body: {
      model: '{{model}}',
      prompt: '{{prompt}}',
      duration: '{{durationSeconds}}',
    },
  },
  poll: { method: 'GET', path: 'tasks/{{remoteJobId}}' },
  mapping: {
    jobId: 'id',
    status: 'status',
    resultUrl: 'output.url',
    states: {
      queued: 'queued',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
    },
  },
};
const defaultCustomCapabilities: VideoCapabilities = {
  text: true,
  image: false,
  references: false,
  maxReferences: 0,
  durationsMs: [5000],
  aspectRatios: ['16:9'],
  resolutions: ['720p'],
  audio: false,
  seed: false,
  cancel: false,
  concurrency: 1,
};
const csv = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
const bodyText = (profile?: ProviderProtocolProfile) =>
  JSON.stringify(
    profile?.submit.body ?? defaultCustomProfile.submit.body,
    null,
    2,
  );
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
  const initialCustomBody = bodyText(initial.profile);
  const initialDurations = (
    initial.capabilities?.durationsMs ?? defaultCustomCapabilities.durationsMs
  )
    .map((value) => value / 1000)
    .join(', ');
  const initialRatios = (
    initial.capabilities?.aspectRatios ?? defaultCustomCapabilities.aspectRatios
  ).join(', ');
  const initialResolutions = (
    initial.capabilities?.resolutions ?? defaultCustomCapabilities.resolutions
  ).join(', ');
  const [customBody, setCustomBody] = useState(initialCustomBody);
  const [durations, setDurations] = useState(initialDurations);
  const [ratios, setRatios] = useState(initialRatios);
  const [resolutions, setResolutions] = useState(initialResolutions);
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
    (!secretRequired || !!secret.trim()) &&
    (draft.protocol !== 'custom-async-json' ||
      (!!draft.profile?.submit.path.trim() &&
        !!draft.profile?.poll.path.trim() &&
        !!draft.profile?.mapping.jobId.trim() &&
        !!draft.profile?.mapping.status.trim() &&
        !!draft.profile?.mapping.resultUrl.trim() &&
        Object.values(draft.profile?.mapping.states ?? {}).includes(
          'completed',
        ) &&
        Object.values(draft.profile?.mapping.states ?? {}).includes('failed') &&
        !!customBody.trim() &&
        !!durations.trim() &&
        !!ratios.trim() &&
        !!resolutions.trim()));
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    !!secret ||
    (draft.protocol === 'custom-async-json' &&
      (customBody !== initialCustomBody ||
        durations !== initialDurations ||
        ratios !== initialRatios ||
        resolutions !== initialResolutions));
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
      let payload = draft;
      if (draft.protocol === 'custom-async-json') {
        let body: unknown;
        try {
          body = JSON.parse(customBody);
        } catch {
          throw new Error(t('videoProviders.custom.invalidBody'));
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new Error(t('videoProviders.custom.invalidBody'));
        const seconds = csv(durations).map(Number);
        if (seconds.some((value) => !Number.isInteger(value) || value <= 0))
          throw new Error(t('videoProviders.custom.invalidDurations'));
        payload = {
          ...draft,
          profile: {
            ...draft.profile!,
            submit: {
              ...draft.profile!.submit,
              body: body as ProviderProtocolProfile['submit']['body'],
            },
          },
          capabilities: {
            ...draft.capabilities!,
            durationsMs: seconds.map((value) => value * 1000),
            aspectRatios: csv(ratios),
            resolutions: csv(resolutions),
          },
        };
      }
      await onSave(
        { ...payload, ...(secret ? { secret } : {}) },
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
      setCustomBody(initialCustomBody);
      setDurations(initialDurations);
      setRatios(initialRatios);
      setResolutions(initialResolutions);
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
  const changeProfile = (
    update: (profile: ProviderProtocolProfile) => ProviderProtocolProfile,
  ) => {
    setDraft((current) => ({
      ...current,
      profile: update(current.profile ?? defaultCustomProfile),
    }));
    setSaved(false);
  };
  const changeCapabilities = (
    update: (capabilities: VideoCapabilities) => VideoCapabilities,
  ) => {
    setDraft((current) => ({
      ...current,
      capabilities: update(current.capabilities ?? defaultCustomCapabilities),
    }));
    setSaved(false);
  };
  const statusCode = (state: 'queued' | 'running' | 'completed' | 'failed') =>
    Object.entries(
      draft.profile?.mapping.states ?? defaultCustomProfile.mapping.states,
    ).find(([, value]) => value === state)?.[0] ?? '';
  const changeStatusCode = (
    state: 'queued' | 'running' | 'completed' | 'failed',
    value: string,
  ) =>
    changeProfile((profile) => {
      const states = { ...profile.mapping.states };
      const previous = Object.entries(states).find(
        ([, item]) => item === state,
      )?.[0];
      if (previous) delete states[previous];
      if (value) states[value] = state;
      return { ...profile, mapping: { ...profile.mapping, states } };
    });
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
    setDraft((d) => ({
      ...d,
      ...defaults,
      protocol,
      profile:
        protocol === 'custom-async-json' ? defaultCustomProfile : undefined,
      capabilities:
        protocol === 'custom-async-json'
          ? defaultCustomCapabilities
          : undefined,
      pricing: undefined,
      parameters: undefined,
    }));
    if (protocol === 'custom-async-json') {
      setCustomBody(bodyText(defaultCustomProfile));
      setDurations('5');
      setRatios('16:9');
      setResolutions('720p');
    }
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
          {draft.protocol === 'custom-async-json' && (
            <div className="space-y-4 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t('videoProviders.custom.intro')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span>{t('videoProviders.custom.submitPath')} *</span>
                  <Input
                    aria-label={t('videoProviders.custom.submitPath')}
                    value={draft.profile?.submit.path ?? ''}
                    onChange={(event) =>
                      changeProfile((profile) => ({
                        ...profile,
                        submit: { ...profile.submit, path: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>{t('videoProviders.custom.pollPath')} *</span>
                  <Input
                    aria-label={t('videoProviders.custom.pollPath')}
                    value={draft.profile?.poll.path ?? ''}
                    onChange={(event) =>
                      changeProfile((profile) => ({
                        ...profile,
                        poll: { ...profile.poll, path: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('videoProviders.custom.pathHint')}
              </p>
              <label className="block space-y-1.5 text-sm">
                <span>{t('videoProviders.custom.requestBody')} *</span>
                <textarea
                  aria-label={t('videoProviders.custom.requestBody')}
                  value={customBody}
                  onChange={(event) => {
                    setCustomBody(event.target.value);
                    setSaved(false);
                  }}
                  className="min-h-32 w-full rounded border bg-background p-2 font-mono text-xs"
                />
                <span className="block text-xs text-muted-foreground">
                  {t('videoProviders.custom.requestBodyHint')}
                </span>
              </label>
              <div className="space-y-2 border-t pt-3">
                <h4 className="text-sm font-medium">
                  {t('videoProviders.custom.responseTitle')}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t('videoProviders.custom.responseHint')}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ['jobId', 'jobId'],
                      ['status', 'statusField'],
                      ['resultUrl', 'resultUrl'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="block space-y-1.5 text-sm" key={key}>
                      <span>{t(`videoProviders.custom.${label}`)} *</span>
                      <Input
                        aria-label={t(`videoProviders.custom.${label}`)}
                        value={draft.profile?.mapping[key] ?? ''}
                        onChange={(event) =>
                          changeProfile((profile) => ({
                            ...profile,
                            mapping: {
                              ...profile.mapping,
                              [key]: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('videoProviders.custom.statusHint')}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['queued', 'running', 'completed', 'failed'] as const).map(
                    (state) => (
                      <label className="block space-y-1.5 text-sm" key={state}>
                        <span>
                          {t(`videoProviders.custom.states.${state}`)} *
                        </span>
                        <Input
                          aria-label={t(
                            `videoProviders.custom.states.${state}`,
                          )}
                          value={statusCode(state)}
                          onChange={(event) =>
                            changeStatusCode(state, event.target.value)
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              </div>
              <div className="space-y-2 border-t pt-3">
                <h4 className="text-sm font-medium">
                  {t('videoProviders.custom.capabilitiesTitle')}
                </h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ['durations', durations, setDurations, 'durationsHint'],
                      ['ratios', ratios, setRatios, 'ratiosHint'],
                      [
                        'resolutions',
                        resolutions,
                        setResolutions,
                        'resolutionsHint',
                      ],
                    ] as const
                  ).map(([label, value, setter, hint]) => (
                    <label className="block space-y-1.5 text-sm" key={label}>
                      <span>{t(`videoProviders.custom.${label}`)} *</span>
                      <Input
                        aria-label={t(`videoProviders.custom.${label}`)}
                        value={value}
                        onChange={(event) => {
                          setter(event.target.value);
                          setSaved(false);
                        }}
                      />
                      <span className="block text-xs text-muted-foreground">
                        {t(`videoProviders.custom.${hint}`)}
                      </span>
                    </label>
                  ))}
                </div>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!draft.capabilities?.references}
                    onChange={(event) =>
                      changeCapabilities((capabilities) => ({
                        ...capabilities,
                        image: event.target.checked,
                        references: event.target.checked,
                        maxReferences: event.target.checked ? 1 : 0,
                      }))
                    }
                  />
                  {t('videoProviders.custom.references')}
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!draft.capabilities?.audio}
                    onChange={(event) =>
                      changeCapabilities((capabilities) => ({
                        ...capabilities,
                        audio: event.target.checked,
                      }))
                    }
                  />
                  {t('videoProviders.custom.audio')}
                </label>
              </div>
            </div>
          )}
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
