import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Episode, VideoProject } from '../../../types/videoProject';
import type { ProviderPublicConfig } from '../../../types/videoProvider';
import type { LlmProviderOption } from '../../../types/videoCreationIpc';
import type { VideoAction } from './CreativeDiscoveryPanel';
import CreativeDiscoveryPanel from './CreativeDiscoveryPanel';
import ScriptEditor from './ScriptEditor';
import CharacterLibrary from './CharacterLibrary';
import StoryboardEditor from './StoryboardEditor';
import GenerationPanel from './GenerationPanel';
import ExportPanel from './ExportPanel';
import BriefEditor from './BriefEditor';
import EpisodeSettings from './EpisodeSettings';
import { videoCreationClient } from '../../lib/videoCreationClient';
const tabs = [
  'idea',
  'brief',
  'script',
  'cast',
  'storyboard',
  'generation',
  'export',
] as const;
export default function EpisodeEditor({
  project,
  episode,
  providers,
  llmProviders,
  locale,
  onAction,
  busy,
}: {
  project: VideoProject;
  episode: Episode;
  providers: ProviderPublicConfig[];
  llmProviders: LlmProviderOption[];
  locale: string;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [tab, setTab] = useState<(typeof tabs)[number]>('idea');
  const [idea, setIdea] = useState(episode.idea);
  const [videoProviderId, setVideoProviderId] = useState('');
  const [imageProviderId, setImageProviderId] = useState('');
  const [llmProviderId, setLlmProviderId] = useState('');
  const [llmConsent, setLlmConsent] = useState(false);
  const [llmCap, setLlmCap] = useState('');
  const [maxRequests, setMaxRequests] = useState('10');
  const [newCreativeBudget, setNewCreativeBudget] = useState(false);
  const [creativeUsage, setCreativeUsage] = useState<{
    requests: number;
    maxRequests: number;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!llmProviderId) {
      setCreativeUsage(null);
      return;
    }
    let active = true;
    void videoCreationClient
      .call('creativeUsage', {
        projectId: project.id,
        episodeId: episode.id,
        llmProviderId,
      })
      .then((usage) => {
        if (active) setCreativeUsage(usage as typeof creativeUsage);
      })
      .catch(() => {
        if (active) setCreativeUsage(null);
      });
    return () => {
      active = false;
    };
  }, [project.id, project.version, episode.id, llmProviderId]);
  const videoProvider = providers.find((p) => p.id === videoProviderId);
  const imageProvider = providers.find((p) => p.id === imageProviderId);
  const llmReady = Boolean(
    llmProviderId &&
    llmConsent &&
    llmCap &&
    Math.round(Number(llmCap) * 100) >= Number(maxRequests) &&
    Number.isFinite(Number(llmCap)) &&
    Number.isInteger(Number(maxRequests)) &&
    Number(maxRequests) > 0 &&
    Number(maxRequests) <= 12,
  );
  const requiredCharacterIds = new Set([
    ...(episode.script?.scenes.flatMap((scene) => [
      ...scene.characterIds,
      ...scene.dialogues.map((d) => d.speakerId),
    ]) ?? []),
    ...episode.shots.flatMap((shot) =>
      shot.snapshot.characterBindings.map((b) => b.characterId),
    ),
  ]);
  const castReady = Array.from(requiredCharacterIds).every((id) =>
    project.characters.some((c) => c.id === id && c.confirmed),
  );
  const llmCommands = [
    'startDiscovery',
    'answerDiscovery',
    'suggestRemaining',
    'runScript',
    'extractEntities',
    'buildStoryboard',
  ];
  const action: VideoAction = async (command, payload) => {
    setError('');
    if (llmCommands.includes(command) && !llmReady) {
      const e = new Error(t('providers.authorizeLlm'));
      setError(e.message);
      throw e;
    }
    try {
      const result = await onAction(command, {
        llmProviderId,
        videoProviderId,
        imageProviderId,
        ...(llmCommands.includes(command)
          ? {
              authorized: true,
              capMinor: Math.round(Number(llmCap) * 100),
              maxRequests: Number(maxRequests),
              currency: 'USD',
              newCreativeBudget,
            }
          : {}),
        ...payload,
      });
      if (llmCommands.includes(command)) {
        void videoCreationClient
          .call('creativeUsage', {
            projectId: project.id,
            episodeId: episode.id,
            llmProviderId,
          })
          .then((usage) => setCreativeUsage(usage as typeof creativeUsage))
          .catch(() => {});
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (llmCommands.includes(command)) setNewCreativeBudget(false);
    }
  };
  const fire: VideoAction = (command, payload) =>
    action(command, payload).catch(() => undefined);
  const selector = (
    label: string,
    value: string,
    onChange: (id: string) => void,
    options: { id: string; name: string; modelId: string }[],
  ) => (
    <label className="min-w-0 text-xs">
      {t(`providers.${label}`)}
      <select
        aria-label={t(`providers.${label}`)}
        className="mt-1 block w-full rounded border bg-background p-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('providers.select')}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.modelId}
          </option>
        ))}
      </select>
    </label>
  );
  const discovery = episode.discovery;
  const brief = episode.brief ?? discovery?.draftRevision;
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border p-3">
        <div className="grid gap-3 md:grid-cols-3">
          {selector('llm', llmProviderId, setLlmProviderId, llmProviders)}
          {selector(
            'video',
            videoProviderId,
            setVideoProviderId,
            providers.filter((p) => p.kind === 'video' && !p.archived),
          )}
          {selector(
            'image',
            imageProviderId,
            setImageProviderId,
            providers.filter((p) => p.kind === 'image' && !p.archived),
          )}
        </div>
        <Link
          className="text-sm text-primary underline"
          href={`/${locale}/engines?view=video:overview`}
        >
          {t('providers.configure')}
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={llmConsent}
              onChange={(e) => setLlmConsent(e.target.checked)}
            />
            {t('providers.llmConsent')}
          </label>
          <label>
            {t('providers.llmBudget')}
            <input
              type="number"
              min="0"
              step="0.01"
              value={llmCap}
              onChange={(e) => setLlmCap(e.target.value)}
              className="ml-2 w-20 rounded border bg-background p-1"
            />
          </label>
          <label>
            {t('providers.maxRequests')}
            <input
              type="number"
              min="1"
              max="12"
              value={maxRequests}
              onChange={(e) => setMaxRequests(e.target.value)}
              className="ml-2 w-16 rounded border bg-background p-1"
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={newCreativeBudget}
              onChange={(event) => setNewCreativeBudget(event.target.checked)}
            />
            {t('providers.newCreativeBudget')}
          </label>
          {creativeUsage && (
            <span>
              {t('providers.usedRequests', {
                used: creativeUsage.requests,
                limit: creativeUsage.maxRequests,
              })}
            </span>
          )}
        </div>
      </section>
      <nav aria-label={t('workflow')} className="flex flex-wrap gap-1">
        {tabs.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? 'default' : 'outline'}
            onClick={() => setTab(id)}
          >
            {t(`tabs.${id}`)}
          </Button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded bg-destructive/10 p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('working')}
        </p>
      )}
      {tab === 'idea' && (
        <section className="space-y-3">
          <EpisodeSettings episode={episode} onAction={fire} busy={busy} />
          <label className="block text-sm">
            {t('project.idea')}
            <textarea
              className="min-h-32 w-full rounded border bg-background p-3"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={busy || idea === episode.idea}
              onClick={() => void fire('update', { patch: { idea } })}
            >
              {t('save')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void fire('importText', {})}
            >
              {t('script.import')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('script.importHint')}
          </p>
          <CreativeDiscoveryPanel
            discovery={
              discovery
                ? {
                    ...discovery,
                    assumptions: discovery.draftRevision?.assumptions,
                  }
                : undefined
            }
            busy={busy || !llmReady}
            onAction={fire}
          />
        </section>
      )}
      {tab === 'brief' &&
        (brief ? (
          <BriefEditor
            key={brief.revisionId}
            brief={brief}
            onAction={action}
            busy={busy}
          />
        ) : (
          <p>{t('brief.empty')}</p>
        ))}
      {tab === 'script' && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !llmReady || !episode.brief?.approvedAt}
              onClick={() =>
                void fire('runScript', {
                  mode: episode.originalScriptText ? 'import' : 'generate',
                })
              }
            >
              {episode.originalScriptText
                ? t('script.analyze')
                : t('script.generate')}
            </Button>
            {episode.originalScriptText && (
              <Button
                variant="outline"
                disabled={busy || !llmReady || !episode.brief?.approvedAt}
                onClick={() =>
                  void fire('runScript', { mode: 'rewrite', rewrite: true })
                }
              >
                {t('script.rewrite')}
              </Button>
            )}
            {episode.script && (
              <Button
                variant="outline"
                disabled={busy || !!episode.script.approvedAt || !castReady}
                onClick={() =>
                  void fire('update', { patch: { approveScript: true } })
                }
              >
                {t('script.approve')}
              </Button>
            )}
          </div>
          <ScriptEditor
            key={episode.script?.revisionId ?? episode.id}
            originalText={episode.originalScriptText}
            scriptText={JSON.stringify(episode.script?.scenes ?? [], null, 2)}
            expectedVersion={project.version}
            onSave={async (text, version) => {
              const scenes = JSON.parse(text);
              if (!Array.isArray(scenes))
                throw new Error('INVALID_SCRIPT_SCENES');
              return action('update', {
                expectedVersion: version,
                patch: { script: { ...episode.script, scenes } },
              });
            }}
          />
        </section>
      )}
      {tab === 'cast' && (
        <CharacterLibrary
          project={project}
          imageProvider={imageProvider}
          busy={busy}
          onAction={fire}
        />
      )}{' '}
      {tab === 'storyboard' && (
        <StoryboardEditor
          episode={episode}
          busy={busy}
          canBuild={
            !!videoProvider &&
            llmReady &&
            !!episode.script?.approvedAt &&
            castReady
          }
          onAction={fire}
        />
      )}{' '}
      {tab === 'generation' && (
        <GenerationPanel
          key={`${episode.id}:${project.version}`}
          project={project}
          episode={episode}
          busy={busy}
          canGenerate={
            !!videoProvider &&
            !!episode.script?.approvedAt &&
            castReady &&
            episode.shots.every((s) => !!s.snapshot.approvedAt && !s.stale)
          }
          onAction={action}
        />
      )}{' '}
      {tab === 'export' && (
        <ExportPanel episode={episode} busy={busy} onAction={action} />
      )}
    </div>
  );
}
