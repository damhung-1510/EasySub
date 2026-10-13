import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode } from '../../../types/videoProject';
import type { VideoAction } from './CreativeDiscoveryPanel';
import {
  useTtsEngineOptions,
  parseEngineKey,
} from '../../hooks/useTtsEngineOptions';
import { toMinor } from './money';
export default function ExportPanel({
  episode,
  onAction,
  busy,
}: {
  episode: Episode;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [engineKey, setEngineKey] = useState('');
  const [voice, setVoice] = useState('');
  const [consent, setConsent] = useState(false);
  const [cap, setCap] = useState('');
  const { engineOptions, refreshEngines } = useTtsEngineOptions();
  const engineOption = engineOptions.find(
    (e) => e.key === engineKey && e.ready,
  );
  const native = episode.audioMode === 'native';
  const ready =
    episode.shots.length > 0 &&
    episode.shots.every(
      (s) =>
        s.selectedAttemptId &&
        !s.stale &&
        s.attempts.some(
          (a) =>
            a.id === s.selectedAttemptId &&
            a.state === 'accepted' &&
            a.artifacts.some((f) => f.kind === 'video'),
        ),
    );
  const audioReady =
    consent &&
    (native ||
      (engineOption &&
        engineOption.voices.some((v) => v.id === voice) &&
        cap &&
        Number(cap) > 0 &&
        Number.isFinite(Number(cap))));
  const exportVideo = () => {
    setError('');
    const payload = native
      ? { nativeAudioReviewed: true }
      : {
          dubbingConfig: {
            engine: parseEngineKey(engineKey),
            voice,
            globalSpeed: 1,
            background: 'mute',
            output: 'audioOnly',
            audioFormat: 'wav',
            language: episode.language,
          },
          audioAuthorized: true,
          currency: 'USD',
          capMinor: toMinor(Number(cap), 'USD'),
        };
    void onAction('export', payload)
      .then((r) => {
        setResult(JSON.stringify(r, null, 2));
        setOutputPath((r as { path?: string })?.path ?? '');
      })
      .catch((e) => setError(String(e)));
  };
  return (
    <section className="space-y-3">
      <p>{t('export.hint')}</p>
      <p className="text-sm text-muted-foreground">{t('export.audioHint')}</p>
      {!native && (
        <div className="space-y-3 rounded border p-3">
          <label className="block text-sm">
            {t('export.ttsEngine')}
            <select
              aria-label={t('export.ttsEngine')}
              className="block w-full rounded border bg-background p-2"
              value={engineKey}
              onChange={(e) => {
                setEngineKey(e.target.value);
                setVoice('');
                setConsent(false);
              }}
            >
              <option value="">{t('providers.select')}</option>
              {engineOptions
                .filter((e) => e.ready)
                .map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            {t('export.voice')}
            <select
              aria-label={t('export.voice')}
              className="block w-full rounded border bg-background p-2"
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value);
                setConsent(false);
              }}
            >
              <option value="">{t('providers.select')}</option>
              {engineOption?.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refreshEngines()}
          >
            {t('generation.refresh')}
          </Button>
          <label className="block text-sm">
            {t('generation.budget')} (USD)
            <input
              aria-label={t('generation.budget')}
              type="number"
              min="0"
              step="0.01"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="ml-2 rounded border bg-background p-1"
            />
          </label>
        </div>
      )}
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t(native ? 'export.nativeReview' : 'export.audioConsent')}
      </label>
      {!ready && <p role="status">{t('export.missingTakes')}</p>}
      <Button disabled={busy || !ready || !audioReady} onClick={exportVideo}>
        {busy ? t('export.working') : t('export.run')}
      </Button>
      {error && <p role="alert">{error}</p>}
      {outputPath && (
        <div className="space-y-2">
          <p className="break-all text-sm">{outputPath}</p>
          <Button
            variant="outline"
            onClick={() =>
              void window.ipc
                .invoke('toolbox:openFolder', outputPath)
                .catch((e) => setError(String(e)))
            }
          >
            {t('export.reveal')}
          </Button>
        </div>
      )}
      {result && (
        <pre
          role="status"
          className="whitespace-pre-wrap break-all rounded bg-muted p-3 text-sm"
        >
          {t('export.done')}
        </pre>
      )}
    </section>
  );
}
