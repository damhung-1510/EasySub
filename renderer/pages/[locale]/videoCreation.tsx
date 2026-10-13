import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { Button } from '../../components/ui/button';
import ProjectList from '../../components/videoCreation/ProjectList';
import EpisodeEditor from '../../components/videoCreation/EpisodeEditor';
import { videoCreationClient } from '../../lib/videoCreationClient';
import useVideoProviders from '../../hooks/useVideoProviders';
import type {
  VideoCommand,
  LlmProviderOption,
} from '../../../types/videoCreationIpc';
import type { ProjectSummary, VideoProject } from '../../../types/videoProject';
import type { VideoAction } from '../../components/videoCreation/CreativeDiscoveryPanel';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
export default function VideoCreationPage() {
  const { t } = useTranslation('videoCreation');
  const router = useRouter();
  const locale = String(router.query.locale ?? 'vi');
  const providers = useVideoProviders();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<VideoProject>();
  const [llmProviders, setLlmProviders] = useState<LlmProviderOption[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [episodeName, setEpisodeName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const readEpoch = useRef(0);
  const projectId =
    typeof router.query.projectId === 'string'
      ? router.query.projectId
      : undefined;
  const episodeId =
    typeof router.query.episodeId === 'string'
      ? router.query.episodeId
      : undefined;
  const episode =
    project?.episodes.find((e) => e.id === episodeId) ?? project?.episodes[0];
  const refresh = useCallback(async () => {
    const epoch = ++readEpoch.current;
    try {
      const [list, loaded, llms] = await Promise.all([
        videoCreationClient.call('list', {}),
        projectId
          ? videoCreationClient.call('load', { projectId })
          : Promise.resolve(undefined),
        videoCreationClient.call('listLlmProviders', {}),
      ]);
      if (epoch !== readEpoch.current) return;
      setProjects(list);
      setProject(loaded);
      setLlmProviders(llms as LlmProviderOption[]);
      setError('');
    } catch (e) {
      if (epoch === readEpoch.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
    const unsubscribe = window.ipc?.on?.(
      'videoCreation:changed',
      (event: { projectId?: string; version?: number }) => {
        if (!event.projectId || event.projectId === projectId) void refresh();
      },
    );
    return () => {
      readEpoch.current++;
      unsubscribe?.();
    };
  }, [refresh, projectId]);
  const open = (id?: string, epId?: string) =>
    void router.push({
      pathname: `/${locale}/videoCreation`,
      query: {
        ...(id ? { projectId: id } : {}),
        ...(epId ? { episodeId: epId } : {}),
      },
    });
  const action: VideoAction = async (command, payload) => {
    setBusy(true);
    setError('');
    try {
      const result = await videoCreationClient.call(command as VideoCommand, {
        projectId,
        episodeId: episode?.id,
        expectedVersion: project?.version,
        ...payload,
      });
      if (
        result &&
        typeof result === 'object' &&
        'episodes' in result &&
        'version' in result
      )
        setProject(result as VideoProject);
      else if (
        [
          'create',
          'delete',
          'importBackup',
          'importText',
          'importReference',
          'backup',
        ].includes(command)
      )
        await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        {error && (
          <div role="alert" className="space-y-2 rounded bg-destructive/10 p-3">
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              {t('retry')}
            </Button>
          </div>
        )}
        {!project && (
          <ProjectList
            projects={projects}
            busy={busy}
            onSelect={(id) => open(id)}
            onCreate={(draft) =>
              void action('create', draft as unknown as Record<string, unknown>)
                .then((p) => open((p as VideoProject).id))
                .catch(() => {})
            }
          />
        )}{' '}
        {!project && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action('importBackup', {})
                .then((p) => {
                  if (p && typeof p === 'object' && 'id' in p)
                    open(String(p.id));
                })
                .catch(() => {})
            }
          >
            {t('project.importBackup')}
          </Button>
        )}
        {project && episode && (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Button size="sm" variant="ghost" onClick={() => open()}>
                  {t('project.back')}
                </Button>
                <h1 className="mt-1 text-xl font-semibold">{project.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {t(`project.${project.kind}`)} · {t('project.revision')}{' '}
                  {project.version}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action('backup', {}).catch(() => {})}
                >
                  {t('project.backup')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeleteConfirm(!deleteConfirm)}
                >
                  {t('project.delete')}
                </Button>
              </div>
            </header>
            {deleteConfirm && (
              <div className="space-y-2 rounded border p-3">
                <p>{t('project.deleteHint')}</p>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void action('delete', {})
                      .then(() => open())
                      .catch(() => {})
                  }
                >
                  {t('project.confirmDelete')}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {project.episodes.map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant={episode.id === e.id ? 'default' : 'outline'}
                  onClick={() => open(project.id, e.id)}
                >
                  {e.name}
                </Button>
              ))}
              {project.kind === 'series' && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action('addEpisode', { name: episodeName })
                      .then((p) => {
                        const next = p as VideoProject;
                        setEpisodeName('');
                        open(
                          next.id,
                          next.episodes[next.episodes.length - 1].id,
                        );
                      })
                      .catch(() => {});
                  }}
                >
                  <input
                    aria-label={t('project.episodeName')}
                    className="w-40 rounded border bg-background px-2 text-sm"
                    placeholder={t('project.episodeName')}
                    value={episodeName}
                    onChange={(e) => setEpisodeName(e.target.value)}
                  />
                  <Button
                    size="sm"
                    type="submit"
                    variant="outline"
                    disabled={busy || !episodeName.trim()}
                  >
                    {t('project.addEpisode')}
                  </Button>
                </form>
              )}
            </div>
            <EpisodeEditor
              key={episode.id}
              project={project}
              episode={episode}
              providers={providers.providers}
              llmProviders={llmProviders}
              locale={locale}
              onAction={action}
              busy={busy}
            />
          </>
        )}
      </div>
    </main>
  );
}
export const getStaticProps = makeStaticProperties(['common', 'videoCreation']);
export { getStaticPaths };
