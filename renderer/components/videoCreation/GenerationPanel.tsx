import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode, VideoProject } from '../../../types/videoProject';
import type { BatchQuote } from '../../../types/videoCreationIpc';
import type { VideoAction } from './CreativeDiscoveryPanel';
import TakeReview from './TakeReview';
import CostApprovalDialog from './CostApprovalDialog';
import { AssetPreview } from './ReferenceEditor';
export default function GenerationPanel({
  project,
  episode,
  onAction,
  busy,
  canGenerate,
}: {
  project: VideoProject;
  episode: Episode;
  onAction: VideoAction;
  busy: boolean;
  canGenerate: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [selected, setSelected] = useState<string[]>(
    episode.shots.map((s) => s.id),
  );
  const [quote, setQuote] = useState<BatchQuote>();
  const [error, setError] = useState('');
  const requestQuote = async () => {
    setError('');
    try {
      setQuote((await onAction('quote', { shotIds: selected })) as BatchQuote);
    } catch (e) {
      setError(String(e));
    }
  };
  const approve = async (capMinor: number) => {
    if (!quote) return;
    const approval = (await onAction('approveCost', {
      quoteId: quote.quoteId,
      capMinor,
      currency: quote.currency,
      ...(quote.confidence === 'unknown'
        ? { unknownCeilingMinor: capMinor }
        : {}),
    })) as { approvalId: string };
    await onAction('startBatch', {
      quoteId: quote.quoteId,
      approvalId: approval.approvalId,
    });
    setQuote(undefined);
  };
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('generation.hint')}</p>
      {episode.shots.map((s) => (
        <article key={s.id} className="space-y-2 rounded border p-3">
          <label className="flex gap-2 font-medium">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) => {
                setSelected((current) =>
                  e.target.checked
                    ? [...current, s.id]
                    : current.filter((id) => id !== s.id),
                );
                setQuote(undefined);
              }}
            />
            {t('storyboard.shot')} {s.order} · {s.snapshot.durationMs / 1000}s
          </label>
          <p className="text-sm text-muted-foreground">{s.snapshot.prompt}</p>
          <TakeReview
            attempts={s.attempts.map((a) => ({ ...a }))}
            shotId={s.id}
            currentRevisionId={s.snapshot.revisionId}
            stale={s.stale}
            busy={busy}
            onAction={onAction}
          />
          {s.attempts
            .flatMap((a) => a.artifacts)
            .filter((a) => a.kind === 'video')
            .map((a) => (
              <AssetPreview key={a.id} projectId={project.id} asset={a} />
            ))}
          {s.selectedAttemptId && (
            <p className="text-sm text-success">
              {t('generation.selected')}: {s.selectedAttemptId.slice(0, 8)}
            </p>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={busy || !canGenerate || !selected.length}
        onClick={() => void requestQuote()}
      >
        {t('generation.quote')}
      </Button>
      {quote && (
        <CostApprovalDialog
          key={quote.quoteId}
          quote={quote}
          busy={busy}
          onApprove={(cap) =>
            void approve(cap).catch((e) => setError(String(e)))
          }
        />
      )}
    </section>
  );
}
