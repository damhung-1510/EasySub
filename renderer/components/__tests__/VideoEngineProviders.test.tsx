import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VideoProviderForm from '../resources/engines/panels/VideoProviderForm';
import { isEngineViewId } from '../../lib/engineViews';
jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../../context/NavigationGuardContext', () => ({
  useNavigationGuard: jest.fn(),
}));
const provider: any = {
  id: 'p1',
  version: 2,
  name: 'Veo',
  kind: 'video',
  protocol: 'veo-gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  modelId: 'veo-3.0-generate-preview',
  authMode: 'header',
  hasCredential: true,
  status: 'unverified',
  timeoutMs: 120000,
  concurrency: 1,
};
test('video view selection is separate from transcription engine IDs', () => {
  expect(isEngineViewId('video:overview')).toBe(true);
  expect(isEngineViewId('video:provider:p1')).toBe(true);
  expect(isEngineViewId('video:images')).toBe(true);
});
test('secret input starts empty, is one-way, and clears after successful save', async () => {
  const onSave = jest.fn().mockResolvedValue(provider);
  render(<VideoProviderForm provider={provider} onSave={onSave} />);
  expect(screen.getByLabelText('videoProviders.apiKey')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('videoProviders.apiKey'), {
    target: { value: 'new-private-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'videoProviders.save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].secret).toBe('new-private-key');
  expect(onSave.mock.calls[0][1]).toBe(2);
  await waitFor(() =>
    expect(screen.getByLabelText('videoProviders.apiKey')).toHaveValue(''),
  );
  expect(screen.queryByDisplayValue('new-private-key')).toBeNull();
});
test('failed CAS save retains draft and secret for a deliberate retry', async () => {
  render(
    <VideoProviderForm
      provider={provider}
      onSave={jest.fn().mockRejectedValue(new Error('VERSION_CONFLICT'))}
    />,
  );
  fireEvent.change(screen.getByLabelText('videoProviders.name'), {
    target: { value: 'New name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'videoProviders.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'VERSION_CONFLICT',
  );
  expect(screen.getByLabelText('videoProviders.name')).toHaveValue('New name');
});
