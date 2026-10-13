import { fireEvent, render, screen } from '@testing-library/react';
import CostApprovalDialog from '../videoCreation/CostApprovalDialog';
import TakeReview from '../videoCreation/TakeReview';
jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
test('a quote cannot start a paid batch until explicit consent', () => {
  const onApprove = jest.fn();
  render(
    <CostApprovalDialog
      quote={{
        quoteId: 'q1',
        maxMinor: 400,
        currency: 'USD',
        confidence: 'estimate',
        fingerprint: 'f',
        providerId: 'p',
        modelId: 'm',
        shotCount: 1,
        capturedAt: '2026-10-13',
        components: [],
      }}
      onApprove={onApprove}
      busy={false}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'generation.approveCost' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'generation.approveCost' }),
  );
  expect(onApprove).toHaveBeenCalledWith(400);
});
test('unknown job requires reconciliation and never presents automatic retry', () => {
  const onAction = jest.fn().mockResolvedValue(undefined);
  render(
    <TakeReview
      attempts={[{ id: 'a1', shotId: 's1', state: 'unknown' }]}
      onAction={onAction}
      busy={false}
    />,
  );
  expect(screen.getByText('status.unknown')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'generation.reconcile' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'generation.reconcile' }));
  expect(onAction).toHaveBeenCalledWith('reconcile', {
    attemptId: 'a1',
    decision: { notSubmitted: true, acknowledged: true },
  });
  expect(screen.queryByRole('button', { name: 'generation.retry' })).toBeNull();
});
test('keeping footage from old inputs requires explicit consent and a reason', () => {
  const onAction = jest.fn().mockResolvedValue(undefined);
  render(
    <TakeReview
      attempts={[
        {
          id: 'old',
          state: 'review',
          snapshot: { revisionId: 'old-revision' },
        },
      ]}
      currentRevisionId="new-revision"
      shotId="s1"
      stale
      onAction={onAction}
      busy={false}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'generation.keepOld' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('generation.keepOldReason'), {
    target: { value: 'The approved footage already matches the story' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'generation.keepOld' }));
  expect(onAction).toHaveBeenCalledWith('selectTake', {
    shotId: 's1',
    attemptId: 'old',
    keepOld: true,
    reason: 'The approved footage already matches the story',
  });
});
test('VND budgets use zero decimal places instead of multiplying by 100', () => {
  const onApprove = jest.fn();
  const quote: any = {
    quoteId: 'q',
    maxMinor: 1000,
    currency: 'VND',
    confidence: 'estimate',
    components: [],
  };
  render(
    <CostApprovalDialog quote={quote} onApprove={onApprove} busy={false} />,
  );
  expect(screen.getByRole('spinbutton')).toHaveValue(1000);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'generation.approveCost' }),
  );
  expect(onApprove).toHaveBeenCalledWith(1000);
});
