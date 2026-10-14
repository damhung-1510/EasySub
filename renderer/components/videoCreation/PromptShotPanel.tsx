import React, { useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode } from '../../../types/videoProject';
import type {
  ProviderPublicConfig,
  VideoCapabilities,
} from '../../../types/videoProvider';
import type { VideoAction } from './CreativeDiscoveryPanel';
import { videoCreationClient } from '../../lib/videoCreationClient';

export default function PromptShotPanel({
  episode,
  provider,
  onAction,
  busy,
  onPrepared,
}: {
  episode: Episode;
  provider?: ProviderPublicConfig;
  onAction: VideoAction;
  busy: boolean;
  onPrepared: () => void;
}) {
  const { t } = useTranslation('videoCreation');
  const [prompt, setPrompt] = useState(episode.idea);
  const [duration, setDuration] = useState('');
  const [ratio, setRatio] = useState('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState<VideoCapabilities>();
  useEffect(() => {
    setCapabilities(undefined);
    if (!provider) return;
    let active = true;
    void videoCreationClient
      .call('videoCapabilities', { videoProviderId: provider.id })
      .then((value) => {
        if (active) setCapabilities(value as VideoCapabilities);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [provider?.id]);
  const durationMs = capabilities?.durationsMs.includes(Number(duration))
    ? Number(duration)
    : capabilities?.durationsMs[0];
  const aspectRatio = capabilities?.aspectRatios.includes(ratio)
    ? ratio
    : capabilities?.aspectRatios.includes(episode.aspectRatio)
      ? episode.aspectRatio
      : capabilities?.aspectRatios[0];
  const selectedResolution = capabilities?.resolutions.includes(resolution)
    ? resolution
    : capabilities?.resolutions[0];
  const alreadyPrepared = Boolean(
    episode.brief || episode.script || episode.shots.length,
  );
  const prepare = async () => {
    setError('');
    try {
      await onAction('preparePromptShot', {
        prompt: prompt.trim(),
        durationMs,
        aspectRatio,
        resolution: selectedResolution,
      });
      onPrepared();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">{t('quick.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('quick.hint')}</p>
      {alreadyPrepared ? (
        <p className="text-sm">{t('quick.prepared')}</p>
      ) : (
        <>
          <label className="block text-sm">
            {t('quick.prompt')}
            <textarea
              className="mt-1 min-h-32 w-full rounded border bg-background p-3"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              {t('storyboard.duration')}
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                value={durationMs ?? ''}
                onChange={(event) => setDuration(event.target.value)}
              >
                {(capabilities?.durationsMs ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value / 1000}s
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t('settings.ratio')}
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                value={aspectRatio ?? ''}
                onChange={(event) => setRatio(event.target.value)}
              >
                {(capabilities?.aspectRatios ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t('quick.resolution')}
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                value={selectedResolution ?? ''}
                onChange={(event) => setResolution(event.target.value)}
              >
                {(capabilities?.resolutions ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!provider && (
            <p className="text-sm text-muted-foreground">
              {t('quick.selectProvider')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !prompt.trim() ||
              !durationMs ||
              !aspectRatio ||
              !selectedResolution ||
              !capabilities?.text
            }
            onClick={() => void prepare()}
          >
            {t('quick.prepare')}
          </Button>
        </>
      )}
    </section>
  );
}
