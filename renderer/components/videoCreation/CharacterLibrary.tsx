import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { Character, VideoProject } from '../../../types/videoProject';
import type { ProviderPublicConfig } from '../../../types/videoProvider';
import type { VideoAction } from './CreativeDiscoveryPanel';
import {
  useTtsEngineOptions,
  type DubbingEngineOption,
} from '../../hooks/useTtsEngineOptions';
import ReferenceEditor from './ReferenceEditor';
function CharacterCard({
  character,
  project,
  imageProvider,
  onAction,
  busy,
  engineOptions,
}: {
  engineOptions: DubbingEngineOption[];
  character: Character;
  project: VideoProject;
  imageProvider?: ProviderPublicConfig;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const revision = character.revisions.find(
    (r) => r.revisionId === character.currentRevisionId,
  );
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(
    revision?.identity.description ?? '',
  );
  const [linkTarget, setLinkTarget] = useState('');
  const [voiceEngine, setVoiceEngine] = useState(
    revision?.voice?.providerId
      ? revision.voice.providerId.startsWith('local:')
        ? revision.voice.providerId
        : `cloud:${revision.voice.providerId}`
      : '',
  );
  const [voiceId, setVoiceId] = useState(revision?.voice?.voiceId ?? '');
  const voiceOption = engineOptions.find(
    (e) => e.key === voiceEngine && e.ready,
  );
  const save = () =>
    onAction('update', {
      patch: {
        characters: project.characters.map((c) =>
          c.id !== character.id
            ? c
            : {
                ...c,
                name,
                revisions: c.revisions.map((r) =>
                  r.revisionId !== c.currentRevisionId
                    ? r
                    : {
                        ...r,
                        identity: { ...r.identity, description },
                        voice:
                          voiceId && voiceOption
                            ? {
                                providerId:
                                  voiceOption.kind === 'cloud'
                                    ? voiceEngine.slice(6)
                                    : voiceEngine,
                                voiceId,
                                language: project.episodes[0]?.language ?? 'vi',
                              }
                            : r.voice,
                      },
                ),
              },
        ),
      },
    });
  return (
    <article className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{character.name}</h3>
        <span className="text-xs">
          {character.confirmed ? t('cast.approved') : t('cast.candidate')}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">ID: {character.id}</p>
      <label className="block text-sm">
        {t('cast.name')}
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">
        {t('cast.description')}
        <textarea
          className="min-h-24 w-full rounded border bg-background p-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">
          {t('export.ttsEngine')}
          <select
            className="block w-full rounded border bg-background p-2"
            value={voiceEngine}
            onChange={(e) => {
              setVoiceEngine(e.target.value);
              setVoiceId('');
            }}
          >
            <option value="">{t('providers.select')}</option>
            {engineOptions
              .filter((e) => e.ready)
              .map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          {t('cast.voice')}
          <select
            className="block w-full rounded border bg-background p-2"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            <option value="">{t('providers.select')}</option>
            {voiceOption?.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t('cast.voiceHint')}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {t('save')}
        </Button>
        {!character.confirmed && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void onAction('linkEntities', {
                characterId: character.id,
                confirmed: true,
              })
            }
          >
            {t('cast.confirm')}
          </Button>
        )}
      </div>
      {project.characters.length > 1 && (
        <div className="flex gap-2">
          <select
            aria-label={t('cast.link')}
            className="min-w-0 flex-1 rounded border bg-background p-1 text-sm"
            value={linkTarget}
            onChange={(e) => setLinkTarget(e.target.value)}
          >
            <option value="">{t('cast.link')}</option>
            {project.characters
              .filter((c) => c.id !== character.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !linkTarget}
            onClick={() =>
              void onAction('linkEntities', {
                characterId: character.id,
                targetCharacterId: linkTarget,
                confirmed: true,
              })
            }
          >
            {t('cast.link')}
          </Button>
        </div>
      )}
      <ReferenceEditor
        projectId={project.id}
        character={character}
        assets={project.assets}
        imageProvider={imageProvider}
        onAction={onAction}
        busy={busy}
      />
    </article>
  );
}
export default function CharacterLibrary({
  project,
  imageProvider,
  onAction,
  busy,
  showExtract = true,
}: {
  project: VideoProject;
  imageProvider?: ProviderPublicConfig;
  onAction: VideoAction;
  busy: boolean;
  showExtract?: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const { engineOptions } = useTtsEngineOptions();
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('cast.sharedHint')}</p>
      {showExtract && (
        <Button
          disabled={busy}
          onClick={() => void onAction('extractEntities', {})}
        >
          {t('cast.extract')}
        </Button>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {project.characters.map((c) => (
          <CharacterCard
            key={`${c.id}:${c.currentRevisionId}`}
            character={c}
            engineOptions={engineOptions}
            project={project}
            imageProvider={imageProvider}
            onAction={onAction}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}
