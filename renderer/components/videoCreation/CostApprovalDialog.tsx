import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { BatchQuote } from '../../../types/videoCreationIpc';
import { toMajor, toMinor } from './money';
export default function CostApprovalDialog({
  quote,
  onApprove,
  busy,
}: {
  quote: BatchQuote;
  onApprove: (capMinor: number) => unknown;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [consent, setConsent] = useState(false);
  const [budget, setBudget] = useState(
    quote.maxMinor === undefined
      ? ''
      : String(toMajor(quote.maxMinor, quote.currency)),
  );
  const capMinor = budget ? toMinor(Number(budget), quote.currency) : NaN;
  return (
    <section className="space-y-3 rounded border border-primary/40 p-3">
      <h3 className="font-semibold">{t('generation.costTitle')}</h3>
      <p>
        {quote.maxMinor === undefined
          ? t('generation.unknownCost')
          : new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: quote.currency,
            }).format(toMajor(quote.maxMinor, quote.currency))}{' '}
        · {quote.confidence}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('generation.budgetHint')}
      </p>
      {quote.components.map((c, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {c.label}
          {c.minor === undefined
            ? ''
            : ` · ${toMajor(c.minor, quote.currency)} ${quote.currency}`}
        </p>
      ))}
      <label className="block">
        {t('generation.budget')} ({quote.currency})
        <input
          type="number"
          min="0"
          step="any"
          className="ml-2 rounded border bg-background p-1"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t('generation.consent')}
      </label>
      <Button
        disabled={
          busy ||
          !consent ||
          !budget ||
          !Number.isSafeInteger(capMinor) ||
          capMinor <= 0 ||
          (quote.maxMinor !== undefined && capMinor < quote.maxMinor)
        }
        onClick={() => onApprove(capMinor)}
      >
        {t('generation.approveCost')}
      </Button>
    </section>
  );
}
