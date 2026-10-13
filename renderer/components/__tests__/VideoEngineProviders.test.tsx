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
  authHeader: 'x-goog-api-key',
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
test('new provider shows required fields and keeps technical options collapsed', () => {
  render(<VideoProviderForm onSave={jest.fn()} />);
  expect(screen.getByLabelText('videoProviders.name')).toBeRequired();
  expect(screen.getByLabelText('videoProviders.baseUrl')).toBeRequired();
  expect(screen.getByLabelText('videoProviders.apiKey')).toBeRequired();
  expect(screen.getByLabelText('videoProviders.model')).toBeRequired();
  expect(screen.getByLabelText('videoProviders.model')).toHaveValue(
    'veo-3.1-generate-preview',
  );
  expect(
    screen.getByText('videoProviders.advanced').closest('details'),
  ).not.toHaveAttribute('open');
  expect(
    screen.getByRole('button', { name: 'videoProviders.save' }),
  ).toBeDisabled();
});
test('saved credential remains optional until switching provider protocol', () => {
  render(<VideoProviderForm provider={provider} onSave={jest.fn()} />);
  expect(screen.getByLabelText('videoProviders.apiKey')).not.toBeRequired();
  fireEvent.change(screen.getByLabelText('videoProviders.protocol'), {
    target: { value: 'seedance-ark' },
  });
  expect(screen.getByLabelText('videoProviders.apiKey')).toBeRequired();
  expect(screen.getByLabelText('videoProviders.model')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'videoProviders.save' }),
  ).toBeDisabled();
});
test('character image setup starts with an image model', () => {
  render(<VideoProviderForm imagesOnly onSave={jest.fn()} />);
  expect(screen.getByLabelText('videoProviders.protocol')).toHaveValue(
    'gemini-image',
  );
  expect(screen.getByLabelText('videoProviders.model')).toHaveValue(
    'gemini-2.5-flash-image',
  );
  expect(screen.queryByRole('option', { name: /veo-gemini/ })).toBeNull();
});
test('new provider can be saved with only the required fields', async () => {
  const onSave = jest.fn().mockResolvedValue(provider);
  render(<VideoProviderForm onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('videoProviders.name'), {
    target: { value: 'My Veo' },
  });
  fireEvent.change(screen.getByLabelText('videoProviders.apiKey'), {
    target: { value: 'private-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'videoProviders.save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({
    name: 'My Veo',
    protocol: 'veo-gemini',
    modelId: 'veo-3.1-generate-preview',
    secret: 'private-key',
  });
});
test('API key guidance follows built-in providers and is hidden for custom APIs', () => {
  render(<VideoProviderForm onSave={jest.fn()} />);
  expect(
    screen.getByRole('link', { name: 'videoProviders.keyLinkGemini' }),
  ).toHaveAttribute('href', 'https://aistudio.google.com/apikey');

  const protocol = screen.getByLabelText('videoProviders.protocol');
  fireEvent.change(protocol, { target: { value: 'seedance-ark' } });
  expect(
    screen.getByRole('link', { name: 'videoProviders.keyLinkSeedance' }),
  ).toHaveAttribute(
    'href',
    'https://ark.volcengine.com/region:cn-beijing/apikey',
  );

  fireEvent.change(protocol, { target: { value: 'openai-image' } });
  expect(
    screen.getByRole('link', { name: 'videoProviders.keyLinkOpenAI' }),
  ).toHaveAttribute('href', 'https://platform.openai.com/api-keys');

  fireEvent.change(protocol, { target: { value: 'custom-async-json' } });
  expect(screen.queryByRole('link')).toBeNull();
});
