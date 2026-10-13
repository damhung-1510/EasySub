import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { VideoAction } from './CreativeDiscoveryPanel';
function ReconcileForm({
  attemptId,
  busy,
  onAction,
}: {
  attemptId: string;
  busy: boolean;
  onAction: VideoAction;
}) {
  const { t } = useTranslation('videoCreation');
  const [remoteJobId, setRemoteJobId] = useState('');
  const [notSubmitted, setNotSubmitted] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t('generation.reconcileHint')}
      </p>
      <label className="block">
        {t('generation.remoteJobId')}
        <input
          className="ml-2 rounded border bg-background p-1"
          value={remoteJobId}
          onChange={(e) => {
            setRemoteJobId(e.target.value);
            setNotSubmitted(false);
          }}
        />
      </label>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={notSubmitted}
          onChange={(e) => {
            setNotSubmitted(e.target.checked);
            setRemoteJobId('');
          }}
        />
        {t('generation.notSubmitted')}
      </label>
      <Button
        disabled={busy || (!remoteJobId.trim() && !notSubmitted)}
        variant="outline"
        onClick={() =>
          void onAction('reconcile', {
            attemptId,
            decision: remoteJobId.trim()
              ? { remoteJobId: remoteJobId.trim() }
              : { notSubmitted: true, acknowledged: true },
          }).catch(() => {})
        }
      >
        {t('generation.reconcile')}
      </Button>
    </div>
  );
}
function KeepOldTake({
  shotId,
  attemptId,
  busy,
  onAction,
}: {
  shotId?: string;
  attemptId: string;
  busy: boolean;
  onAction: VideoAction;
}) {
  const { t } = useTranslation('videoCreation');
  const [accepted, setAccepted] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2 rounded border border-amber-500/40 p-2">
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        {t('generation.keepOldConsent')}
      </label>
      <label className="block">
        {t('generation.keepOldReason')}
        <input
          aria-label={t('generation.keepOldReason')}
          className="ml-2 rounded border bg-background p-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        disabled={busy || !accepted || !reason.trim()}
        onClick={() =>
          void onAction('selectTake', {
            shotId,
            attemptId,
            keepOld: true,
            reason,
          }).catch(() => {})
        }
      >
        {t('generation.keepOld')}
      </Button>
    </div>
  );
}
export default function TakeReview({
  attempts,
  onAction,
  busy,
  shotId,
  stale,
  currentRevisionId,
}: {
  attempts: {
    id: string;
    state: string;
    error?: { message: string };
    [key: string]: unknown;
  }[];
  onAction: VideoAction;
  busy: boolean;
  shotId?: string;
  stale?: boolean;
  currentRevisionId?: string;
}) {
  const { t } = useTranslation('videoCreation');
  return (
    <div className="space-y-2">
      {stale && <p className="text-amber-600">{t('generation.stale')}</p>}
      {attempts.map((a) => (
        <div key={a.id} className="rounded border p-2 text-sm">
          <div className="flex gap-2">
            <span className="font-mono">{a.id.slice(0, 8)}</span>
            <span>{t(`status.${a.state}`)}</span>
          </div>
          {a.error && <p role="alert">{a.error.message}</p>}
          {a.state === 'unknown' && (
            <ReconcileForm attemptId={a.id} busy={busy} onAction={onAction} />
          )}
          {['queued', 'running'].includes(a.state) && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void onAction('pollStatus', { attemptId: a.id }).catch(
                    () => {},
                  )
                }
              >
                {t('generation.refresh')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void onAction('cancel', { attemptId: a.id }).catch(() => {})
                }
              >
                {t('generation.cancel')}
              </Button>
            </>
          )}
          {['review', 'accepted'].includes(a.state) && (
            <>
              <p>{t('generation.reviewChecklist')}</p>
              {(stale ||
                (currentRevisionId &&
                  (a.snapshot as { revisionId?: string })?.revisionId !==
                    currentRevisionId)) && (
                <KeepOldTake
                  shotId={shotId}
                  attemptId={a.id}
                  busy={busy}
                  onAction={onAction}
                />
              )}
              <Button
                disabled={
                  busy ||
                  stale ||
                  Boolean(
                    currentRevisionId &&
                    (a.snapshot as { revisionId?: string })?.revisionId !==
                      currentRevisionId,
                  )
                }
                onClick={() =>
                  void onAction('selectTake', {
                    shotId,
                    attemptId: a.id,
                  }).catch(() => {})
                }
              >
                {t('generation.selectTake')}
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
