import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../../../ui/button';
import VideoProviderForm from './VideoProviderForm';
import type { VideoProviderHook } from '../../../../hooks/useVideoProviders';
import { videoProviderDraft } from '../../../../lib/videoProviderDraft';
import { videoCreationClient } from '../../../../lib/videoCreationClient';
import type { ProviderConnectionResult } from '../../../../../types/videoProvider';
export default function VideoProviderPanel({
  selectedProviderId,
  onSelect,
  api,
  imagesOnly = false,
}: {
  selectedProviderId?: string;
  onSelect: (id?: string) => void;
  api: VideoProviderHook;
  imagesOnly?: boolean;
}) {
  const { t } = useTranslation('resources');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<ProviderConnectionResult | null>(
    null,
  );
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const provider = api.providers.find((p) => p.id === selectedProviderId);
  const visible = api.providers.filter(
    (p) => !p.archived && (!imagesOnly || p.kind === 'image'),
  );
  const action = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('videoProviders.description')}
      </p>
      {api.error && <p role="alert">{api.error}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!provider && !creating && (
        <>
          <div className="grid gap-2">
            {visible.map((p) => (
              <button
                type="button"
                className="rounded border p-3 text-left"
                key={p.id}
                onClick={() => {
                  onSelect(p.id);
                  setCreating(false);
                }}
              >
                <strong>{p.name}</strong>
                <p className="text-xs text-muted-foreground">
                  {p.protocol} · {p.modelId} ·{' '}
                  {t(
                    p.verifiedAt
                      ? 'videoProviders.verified'
                      : 'videoProviders.unverified',
                  )}
                </p>
              </button>
            ))}
          </div>
          <Button onClick={() => setCreating(true)}>
            {t('videoProviders.add')}
          </Button>
          <details>
            <summary>{t('videoProviders.importExport')}</summary>
            <p className="text-xs text-muted-foreground">
              {t('videoProviders.importHint')}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                setExportText(
                  JSON.stringify(
                    api.providers.map((p) => {
                      const { id, ...draft } = videoProviderDraft(p);
                      return draft;
                    }),
                    null,
                    2,
                  ),
                )
              }
            >
              {t('videoProviders.export')}
            </Button>
            {exportText && (
              <textarea
                readOnly
                className="h-40 w-full rounded border bg-background p-2 font-mono text-xs"
                value={exportText}
              />
            )}
            <textarea
              aria-label={t('videoProviders.import')}
              className="h-32 w-full rounded border bg-background p-2 font-mono text-xs"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <Button
              disabled={!importText.trim()}
              variant="outline"
              onClick={() =>
                void action(async () => {
                  const parsed = JSON.parse(importText);
                  if (!Array.isArray(parsed))
                    throw new Error('INVALID_PROVIDER_IMPORT');
                  for (const item of parsed) {
                    if ('secret' in item || 'apiKey' in item)
                      throw new Error('SECRET_IN_CONFIG');
                    const {
                      id,
                      version,
                      revisionId,
                      createdAt,
                      updatedAt,
                      verifiedAt,
                      ...draft
                    } = item;
                    await api.save(draft, 0);
                  }
                  setImportText('');
                })
              }
            >
              {t('videoProviders.import')}
            </Button>
          </details>
        </>
      )}
      {(creating || provider) && (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false);
              onSelect();
              setTestResult(null);
              setConfirmDelete(false);
            }}
          >
            {t('videoProviders.back')}
          </Button>
          <VideoProviderForm
            key={provider?.id ?? 'new'}
            provider={provider}
            imagesOnly={imagesOnly}
            onSave={async (draft, version) => {
              const result = await api.save(draft, version);
              if (!provider) {
                setCreating(false);
                onSelect((result as { id: string }).id);
              }
              return result;
            }}
          />
          {provider && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    setTestResult(null);
                    const result = await videoCreationClient.call(
                      'testProvider',
                      { providerId: provider.id },
                    );
                    setTestResult(result as ProviderConnectionResult);
                  })
                }
              >
                {t('videoProviders.test')}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    const {
                      id,
                      version,
                      revisionId,
                      createdAt,
                      updatedAt,
                      hasCredential,
                      credentialPersistence,
                      verifiedAt,
                      ...draft
                    } = provider;
                    const clone = await api.save(
                      {
                        ...videoProviderDraft(provider),
                        id: undefined,
                        name: `${provider.name} (2)`,
                      },
                      0,
                    );
                    onSelect((clone as { id: string }).id);
                  })
                }
              >
                {t('videoProviders.clone')}
              </Button>
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                {t('videoProviders.remove')}
              </Button>
            </div>
          )}
          {testResult && (
            <p
              role="status"
              className={`text-sm ${testResult.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {t(`videoProviders.connection.${testResult.code}`)}
            </p>
          )}
          {confirmDelete && provider && (
            <div className="rounded border p-3">
              <p>{t('videoProviders.removeHint')}</p>
              <Button
                variant="destructive"
                onClick={() =>
                  void action(async () => {
                    await api.remove(provider.id, provider.version);
                    setConfirmDelete(false);
                    onSelect();
                  })
                }
              >
                {t('videoProviders.confirmRemove')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
