import { render, screen } from '@testing-library/react';
import TakeReview from '../videoCreation/TakeReview';

jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

test('existing failed attempts reveal their 429 reason', () => {
  render(
    <TakeReview
      attempts={[
        {
          id: 'c22bd6ce-d3b8',
          state: 'failed',
          error: {
            code: 'RATE_LIMIT',
            message: 'Provider rejected the request',
          },
        },
      ]}
      onAction={jest.fn()}
      busy={false}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('RATE_LIMIT');
  expect(screen.getByRole('alert')).toHaveTextContent('generation.rateLimited');
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'Provider rejected the request',
  );
});
