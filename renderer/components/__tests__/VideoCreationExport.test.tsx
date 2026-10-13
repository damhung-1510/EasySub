import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExportPanel from '../videoCreation/ExportPanel';
jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
test('export stays blocked until every shot has a current accepted video take', () => {
  const episode: any = {
    audioMode: 'native',
    shots: [{ id: 's1', selectedAttemptId: undefined, attempts: [] }],
  };
  const { rerender } = render(
    <ExportPanel episode={episode} onAction={jest.fn()} busy={false} />,
  );
  expect(screen.getByRole('button', { name: 'export.run' })).toBeDisabled();
  episode.shots[0] = {
    id: 's1',
    selectedAttemptId: 'a1',
    stale: true,
    attempts: [{ id: 'a1', state: 'accepted', artifacts: [{ kind: 'video' }] }],
  };
  rerender(<ExportPanel episode={episode} onAction={jest.fn()} busy={false} />);
  expect(screen.getByRole('button', { name: 'export.run' })).toBeDisabled();
  episode.shots[0].stale = false;
  rerender(<ExportPanel episode={episode} onAction={jest.fn()} busy={false} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'export.run' })).toBeEnabled();
});
jest.mock('../../hooks/useTtsEngineOptions', () => ({
  useTtsEngineOptions: () => ({
    engineOptions: [
      {
        key: 'cloud:tts1',
        label: 'TTS configured',
        ready: true,
        voices: [{ id: 'narrator', label: 'Narrator' }],
      },
    ],
    refreshEngines: jest.fn(),
  }),
  parseEngineKey: (key: string) => ({
    kind: 'cloud',
    providerId: key.slice(6),
  }),
}));

test('paid narration requires a configured voice and explicit budget before export', async () => {
  const episode: any = {
    audioMode: 'narration',
    language: 'vi',
    shots: [
      {
        selectedAttemptId: 'a',
        attempts: [
          { id: 'a', state: 'accepted', artifacts: [{ kind: 'video' }] },
        ],
      },
    ],
  };
  const onAction = jest.fn().mockResolvedValue({ path: 'out.mp4' });
  render(<ExportPanel episode={episode} onAction={onAction} busy={false} />);
  expect(screen.getByRole('button', { name: 'export.run' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('export.ttsEngine'), {
    target: { value: 'cloud:tts1' },
  });
  fireEvent.change(screen.getByLabelText('export.voice'), {
    target: { value: 'narrator' },
  });
  fireEvent.change(screen.getByLabelText('generation.budget'), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'export.run' }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith(
      'export',
      expect.objectContaining({
        audioAuthorized: true,
        capMinor: 200,
        dubbingConfig: expect.objectContaining({
          voice: 'narrator',
          engine: { kind: 'cloud', providerId: 'tts1' },
        }),
      }),
    ),
  );
  await screen.findByRole('status');
});
