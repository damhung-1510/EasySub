import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode, Shot } from '../../../types/videoProject';
import type { VideoAction } from './CreativeDiscoveryPanel';
function ShotEditor({
  shot,
  episode,
  onAction,
  busy,
}: {
  shot: Shot;
  episode: Episode;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [prompt, setPrompt] = useState(shot.snapshot.prompt);
  const [duration, setDuration] = useState(
    String(shot.snapshot.durationMs / 1000),
  );
  return (
    <article className="space-y-2 rounded border p-3">
      <h4 className="font-semibold">
        {t('storyboard.shot')} {shot.order}{' '}
        {shot.stale && (
          <span className="text-amber-600">{t('generation.stale')}</span>
        )}
      </h4>
      <p className="text-xs text-muted-foreground">
        {shot.snapshot.camera} · {shot.snapshot.environment}
      </p>
      <label className="block text-sm">
        {t('storyboard.prompt')}
        <textarea
          className="min-h-28 w-full rounded border bg-background p-2"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t('storyboard.duration')}
        <input
          type="number"
          min="1"
          className="ml-2 w-24 rounded border bg-background p-1"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {shot.snapshot.characterBindings
          .map(
            (b) =>
              `${b.characterId.slice(0, 8)} @ ${b.characterRevisionId.slice(0, 8)}`,
          )
          .join(' · ')}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={
          busy ||
          !prompt.trim() ||
          !Number.isFinite(Number(duration)) ||
          Number(duration) <= 0
        }
        onClick={() =>
          void onAction('update', {
            patch: {
              shots: episode.shots.map((s) =>
                s.id !== shot.id
                  ? s
                  : {
                      ...s,
                      snapshot: {
                        ...s.snapshot,
                        prompt,
                        durationMs: Math.round(Number(duration) * 1000),
                      },
                    },
              ),
            },
          })
        }
      >
        {t('save')}
      </Button>
    </article>
  );
}
export default function StoryboardEditor({
  episode,
  onAction,
  busy,
  canBuild,
}: {
  episode: Episode;
  onAction: VideoAction;
  busy: boolean;
  canBuild: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <Button
          disabled={busy || !canBuild}
          onClick={() => void onAction('buildStoryboard', {})}
        >
          {t('storyboard.build')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !episode.shots.length}
          onClick={() =>
            void onAction('approveShots', {
              shotIds: episode.shots.map((s) => s.id),
            })
          }
        >
          {t('storyboard.approve')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !episode.shots.length}
          onClick={() => void onAction('refreshShotBindings', {})}
        >
          {t('storyboard.refreshBindings')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('storyboard.hint')}</p>
      {episode.shots.map((s) => (
        <ShotEditor
          key={`${s.id}:${s.snapshot.revisionId}`}
          shot={s}
          episode={episode}
          onAction={onAction}
          busy={busy}
        />
      ))}
    </section>
  );
}
