import { fireEvent, render, screen } from '@testing-library/react';
import CharacterLibrary from '../videoCreation/CharacterLibrary';
jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../../context/NavigationGuardContext', () => ({
  useNavigationGuard: jest.fn(),
}));
jest.mock('../../hooks/useTtsEngineOptions', () => ({
  useTtsEngineOptions: () => ({
    engineOptions: [
      {
        key: 'cloud:tts1',
        kind: 'cloud',
        ready: true,
        label: 'Configured TTS',
        voices: [{ id: 'voice1', label: 'Hero voice' }],
      },
    ],
  }),
}));
test('character voice selection persists on its stable identity revision', () => {
  const character: any = {
    id: 'hero',
    name: 'Hero',
    aliases: [],
    confirmed: true,
    currentRevisionId: 'r1',
    variants: [],
    revisions: [
      {
        revisionId: 'r1',
        createdAt: '2026-10-13',
        identity: { description: 'A hero' },
        referenceAssetIds: [],
      },
    ],
  };
  const project: any = {
    id: 'p1',
    version: 3,
    characters: [character],
    episodes: [{ language: 'vi' }],
    assets: [],
  };
  const onAction = jest.fn().mockResolvedValue(undefined);
  render(
    <CharacterLibrary project={project} onAction={onAction} busy={false} />,
  );
  fireEvent.change(screen.getByLabelText('export.ttsEngine'), {
    target: { value: 'cloud:tts1' },
  });
  fireEvent.change(screen.getByLabelText('cast.voice'), {
    target: { value: 'voice1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  expect(onAction).toHaveBeenCalledWith('update', {
    patch: {
      characters: [
        expect.objectContaining({
          id: 'hero',
          revisions: [
            expect.objectContaining({
              revisionId: 'r1',
              voice: { providerId: 'tts1', voiceId: 'voice1', language: 'vi' },
            }),
          ],
        }),
      ],
    },
  });
});
