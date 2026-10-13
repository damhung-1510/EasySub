import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScriptEditor from '../videoCreation/ScriptEditor';
import CreativeDiscoveryPanel from '../videoCreation/CreativeDiscoveryPanel';
import StoryboardEditor from '../videoCreation/StoryboardEditor';
jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../../context/NavigationGuardContext', () => ({
  useNavigationGuard: jest.fn(),
}));
test('keeps imported original separate and saves draft against its displayed revision', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  render(
    <ScriptEditor
      originalText="The original story"
      scriptText="Draft"
      expectedVersion={3}
      onSave={onSave}
    />,
  );
  expect(screen.getByTestId('original-script')).toHaveTextContent(
    'The original story',
  );
  fireEvent.change(screen.getByLabelText('script.draft'), {
    target: { value: 'Edited draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('Edited draft', 3));
});
test('failed draft save preserves editable text and explains conflict', async () => {
  render(
    <ScriptEditor
      originalText="Original"
      scriptText="Draft"
      expectedVersion={3}
      onSave={jest.fn().mockRejectedValue(new Error('VERSION_CONFLICT'))}
    />,
  );
  fireEvent.change(screen.getByLabelText('script.draft'), {
    target: { value: 'Keep me' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'VERSION_CONFLICT',
  );
  expect(screen.getByLabelText('script.draft')).toHaveValue('Keep me');
});
test('AI gap suggestions remain assumptions requiring explicit confirmation', async () => {
  const onAction = jest.fn().mockResolvedValue(undefined);
  render(
    <CreativeDiscoveryPanel
      discovery={{
        question: 'Who is the audience?',
        assumptions: ['Family audience'],
        decisions: [],
      }}
      onAction={onAction}
      busy={false}
    />,
  );
  expect(screen.getByText('Who is the audience?')).toBeVisible();
  expect(screen.getByText('Family audience')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'discovery.suggest' }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith('suggestRemaining', {}),
  );
  expect(onAction).not.toHaveBeenCalledWith('confirmBrief', expect.anything());
});
test('an external project version update cannot silently rebase unsaved script changes', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <ScriptEditor scriptText="Draft" expectedVersion={3} onSave={onSave} />,
  );
  fireEvent.change(screen.getByLabelText('script.draft'), {
    target: { value: 'My unsaved edit' },
  });
  rerender(
    <ScriptEditor
      scriptText="External edit"
      expectedVersion={4}
      onSave={onSave}
    />,
  );
  expect(screen.getByLabelText('script.draft')).toHaveValue('My unsaved edit');
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith('My unsaved edit', 3),
  );
});
test('scene form edits narrative text while preserving stable scene and speaker IDs', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const scene = {
    id: 'scene-1',
    location: 'Beach',
    time: 'Dawn',
    characterIds: ['hero'],
    action: 'Walks',
    dialogues: [{ id: 'line-1', speakerId: 'hero', text: 'Hello' }],
    narration: 'A new day',
    sound: 'Waves',
    durationMs: 5000,
  };
  render(
    <ScriptEditor
      scriptText={JSON.stringify([scene])}
      expectedVersion={3}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getByLabelText('script.action'), {
    target: { value: 'Runs' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = JSON.parse(onSave.mock.calls[0][0]);
  expect(saved[0]).toEqual({ ...scene, action: 'Runs' });
});
test('storyboard exposes explicit character binding refresh before shot approval', async () => {
  const onAction = jest.fn().mockResolvedValue(undefined);
  const episode = {
    shots: [
      {
        id: 'shot-1',
        order: 1,
        stale: true,
        snapshot: {
          revisionId: 'shot-r1',
          prompt: 'Hero enters',
          durationMs: 8000,
          camera: 'wide',
          environment: 'room',
          characterBindings: [
            { characterId: 'hero', characterRevisionId: 'hero-r1' },
          ],
        },
        snapshots: [],
        attempts: [],
      },
    ],
  } as any;
  render(
    <StoryboardEditor
      episode={episode}
      onAction={onAction}
      busy={false}
      canBuild={false}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'storyboard.refreshBindings' }),
  );
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith('refreshShotBindings', {}),
  );
});
