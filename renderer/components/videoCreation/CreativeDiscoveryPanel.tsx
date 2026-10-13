import React, { useState, useEffect } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
export type VideoAction = (
  command: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;
export default function CreativeDiscoveryPanel({
  discovery,
  onAction,
  busy,
}: {
  discovery?: {
    question?: string;
    currentQuestion?: unknown;
    assumptions?: unknown[];
    decisions?: unknown[];
    [key: string]: unknown;
  };
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [answer, setAnswer] = useState('');
  const question =
    discovery?.question ||
    (typeof discovery?.currentQuestion === 'string'
      ? discovery.currentQuestion
      : (discovery?.currentQuestion as { text?: string })?.text);
  useEffect(() => setAnswer(''), [question]);
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{t('discovery.title')}</h3>
      {!discovery && (
        <Button
          disabled={busy}
          onClick={() => void onAction('startDiscovery', {})}
        >
          {t('discovery.start')}
        </Button>
      )}
      {question && (
        <>
          <p className="rounded bg-muted p-3">{question}</p>
          <label className="block">
            {t('discovery.answer')}
            <textarea
              className="w-full rounded border bg-background p-2"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !answer.trim()}
            onClick={() => void onAction('answerDiscovery', { answer })}
          >
            {t('discovery.send')}
          </Button>
        </>
      )}
      {discovery && (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onAction('suggestRemaining', {})}
          >
            {t('discovery.suggest')}
          </Button>
          <h4>{t('discovery.assumptions')}</h4>
          <ul className="list-disc pl-5">
            {(discovery.assumptions || []).map((a, i) => (
              <li key={i}>{typeof a === 'string' ? a : JSON.stringify(a)}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {t('discovery.confirmHint')}
          </p>
        </>
      )}
    </section>
  );
}
