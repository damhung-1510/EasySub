import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode } from '../../../types/videoProject';
import type { VideoAction } from './CreativeDiscoveryPanel';
export default function EpisodeSettings({
  episode,
  onAction,
  busy,
}: {
  episode: Episode;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [language, setLanguage] = useState(episode.language);
  const [style, setStyle] = useState(episode.style);
  const [duration, setDuration] = useState(
    String(episode.targetDurationMs / 1000),
  );
  const [ratio, setRatio] = useState(episode.aspectRatio);
  const [audioMode, setAudioMode] = useState(episode.audioMode);
  return (
    <details className="rounded border p-3" open>
      <summary className="text-sm font-semibold">{t('settings.title')}</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          {t('brief.language')}
          <input
            className="mt-1 w-full rounded border bg-background p-2"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('brief.style')}
          <input
            className="mt-1 w-full rounded border bg-background p-2"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('settings.duration')}
          <input
            type="number"
            min="1"
            className="mt-1 w-full rounded border bg-background p-2"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('settings.ratio')}
          <select
            className="mt-1 w-full rounded border bg-background p-2"
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
          >
            {['16:9', '9:16', '1:1'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t('brief.audioMode')}
          <select
            className="mt-1 w-full rounded border bg-background p-2"
            value={audioMode}
            onChange={(e) =>
              setAudioMode(e.target.value as Episode['audioMode'])
            }
          >
            {['narration', 'tts', 'native'].map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.${mode}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="my-2 text-xs text-muted-foreground">{t('settings.hint')}</p>
      <Button
        size="sm"
        variant="outline"
        disabled={
          busy ||
          !language.trim() ||
          !duration ||
          Number(duration) <= 0 ||
          !Number.isFinite(Number(duration))
        }
        onClick={() =>
          void onAction('update', {
            patch: {
              language,
              style,
              targetDurationMs: Math.round(Number(duration) * 1000),
              aspectRatio: ratio,
              audioMode,
            },
          })
        }
      >
        {t('save')}
      </Button>
    </details>
  );
}
