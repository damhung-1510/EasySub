import path from 'path';
import fs from 'fs/promises';
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { store } from '../helpers/store';
import { resolveStorageLocation } from '../helpers/storagePaths';
import { saveWorkItem, getWorkItemById } from '../helpers/workItemStore';
import { logMessage } from '../helpers/storeManager';
import { supportsAssistant } from '../assistant/provider';
import { createAssistantLlm } from './llmAdapter';
import { createProviderSettings } from './providerSettings';
import { createBudgetLedger } from './budgetLedger';
import { createJobStore } from './jobStore';
import { createJobRunner } from './jobRunner';
import { createTransport } from './transport';
import { createVideoAdapter, createImageAdapter } from './providerRegistry';
import { createAssetStore } from './assetStore';
import {
  createVideoCreationService,
  type VideoCreationService,
} from './service';
import { exportEpisode } from './exportRunner';
import type { VideoCommandRequest } from '../../types/videoCreationIpc';
import type { ProviderConfig } from '../../types/videoProvider';

let shutdown: undefined | (() => Promise<void>);
export async function shutdownVideoCreation() {
  await shutdown?.();
}
export async function setupVideoCreationHandlers() {
  const settings = store.get('settings');
  const root = resolveStorageLocation({
    storageRoot: settings?.storageRoot,
    subpath: ['video-projects'],
    defaultBase: app.getPath('userData'),
  }).path;
  const stateRoot = path.join(app.getPath('userData'), 'video-creation');
  const providers = createProviderSettings(stateRoot, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
  });
  const ledger = createBudgetLedger(stateRoot);
  const jobStore = createJobStore(stateRoot);
  const assets = createAssetStore(root);
  const getAdapter = (config: ProviderConfig) =>
    createVideoAdapter(
      config,
      createTransport(config, () =>
        providers.getSecret(config.id, config.revisionId),
      ),
    );
  let service: VideoCreationService | undefined;
  let refresh = Promise.resolve();
  const runner = createJobRunner({
    store: jobStore,
    ledger,
    getAdapter,
    downloadDestination: (job) =>
      path.join(root, job.projectId, 'assets', job.id + '.mp4'),
    async resolveReferences(request, job) {
      const project = await service!.store.load(job.projectId);
      const refs = [];
      for (const ref of request.references) {
        const asset = project.assets.find((a) => a.id === ref.assetId);
        if (!asset) throw new Error('REFERENCE_REQUIRED');
        const bytes = await assets.readReference(
          project.id,
          asset,
          new AbortController().signal,
        );
        refs.push({ ...ref, dataBase64: bytes.dataBase64 });
      }
      return { ...request, references: refs };
    },
    onChanged() {
      if (service) {
        refresh = refresh
          .catch(() => {})
          .then(() => service!.syncJobs())
          .catch(() => {
            logMessage(
              'Video job project synchronization failed; job remains recoverable',
              'warning',
            );
          });
      }
    },
  });
  const broadcast = (event: unknown) => {
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed())
        win.webContents.send('videoCreation:changed', event);
  };
  service = await createVideoCreationService({
    root,
    providerSettings: providers,
    ledger,
    jobRunner: runner,
    jobStore,
    llm(providerId, boundary) {
      const provider = (store.get('translationProviders') || []).find(
        (p) => p.id === providerId,
      );
      if (!provider || !supportsAssistant(provider))
        throw new Error('LLM_PROVIDER_REQUIRED');
      return createAssistantLlm(provider, {
        beforeRequest: boundary.beforeRequest!,
        afterRequest: boundary.afterRequest,
      });
    },
    listLlmProviders: () =>
      (store.get('translationProviders') || [])
        .filter(supportsAssistant)
        .map((p) => ({ id: p.id, name: p.name, modelId: p.modelName })),
    getVideoAdapter: async (id, revision) =>
      getAdapter(await providers.get(id, revision)),
    getImageAdapter: async (id) => {
      const config = await providers.get(id);
      return createImageAdapter(
        config,
        createTransport(config, () =>
          providers.getSecret(id, config.revisionId),
        ),
      );
    },
    onChanged(event) {
      broadcast(event);
      if (event.projectId) {
        void service?.store
          .load(event.projectId)
          .then((project) => {
            for (const ep of project.episodes) {
              const attempts = ep.shots.flatMap((s) => s.attempts);
              const running = attempts.some((a) =>
                [
                  'ready',
                  'submitting',
                  'queued',
                  'running',
                  'downloading',
                ].includes(a.state),
              );
              const error = attempts.some(
                (a) => a.state === 'failed' || a.state === 'unknown',
              );
              const previous = getWorkItemById(ep.id);
              saveWorkItem(
                {
                  id: ep.id,
                  name: project.name + ' / ' + ep.name,
                  type: 'videoCreation',
                  videoProjectId: project.id,
                  episodeId: ep.id,
                  status:
                    ep.status === 'exported'
                      ? 'done'
                      : running
                        ? 'running'
                        : error
                          ? 'error'
                          : attempts.length
                            ? 'review'
                            : 'waiting',
                  createdAt:
                    previous?.createdAt || Date.parse(project.createdAt),
                  updatedAt: Date.now(),
                  configSnapshot: {
                    videoProjectId: project.id,
                    episodeId: ep.id,
                  },
                },
                { durable: true },
              );
            }
          })
          .catch(() => {});
      }
    },
    exportEpisode: (project, episodeId, options, signal) =>
      exportEpisode({ root, project, episodeId, options, signal }),
  });
  ipcMain.handle(
    'videoCreation:command',
    async (event, raw: VideoCommandRequest) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const p = { ...(raw?.payload || {}) };
      if (
        ['importReference', 'importText', 'importBackup'].includes(raw?.command)
      ) {
        const directory = raw.command === 'importBackup';
        const opts: Electron.OpenDialogOptions = {
          properties: directory ? ['openDirectory'] : ['openFile'],
          ...(directory
            ? {}
            : {
                filters: [
                  {
                    name: raw.command === 'importText' ? 'Script' : 'Images',
                    extensions:
                      raw.command === 'importText'
                        ? ['txt']
                        : ['png', 'jpg', 'jpeg', 'webp'],
                  },
                ],
              }),
        };
        const picked = owner
          ? await dialog.showOpenDialog(owner, opts)
          : await dialog.showOpenDialog(opts);
        if (picked.canceled) return null;
        if (raw.command === 'importText') {
          const stat = await fs.stat(picked.filePaths[0]);
          if (stat.size > 1024 * 1024) throw new Error('SCRIPT_TOO_LARGE');
          p.text = await fs.readFile(picked.filePaths[0], 'utf8');
        } else p.sourcePath = picked.filePaths[0];
      }
      if (raw?.command === 'backup') {
        const opts: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory'],
        };
        const picked = owner
          ? await dialog.showOpenDialog(owner, opts)
          : await dialog.showOpenDialog(opts);
        if (picked.canceled) return null;
        p.destinationPath = path.join(
          picked.filePaths[0],
          'EasySub-video-backup-' + Date.now(),
        );
      }
      if (raw?.command === 'export') {
        const opts: Electron.SaveDialogOptions = {
          title: 'Export video',
          defaultPath: 'video.mp4',
          filters: [{ name: 'MP4', extensions: ['mp4'] }],
        };
        const picked = owner
          ? await dialog.showSaveDialog(owner, opts)
          : await dialog.showSaveDialog(opts);
        if (picked.canceled || !picked.filePath) return null;
        p.outputPath = picked.filePath;
      }
      return service!.command({ ...raw, payload: p });
    },
  );
  shutdown = async () => {
    await service?.shutdown();
    await runner.shutdown();
    await refresh;
  };
  // Offline startup never submits a new unknown request; stored jobs resume by remote IDs.
  await runner.resume();
  await service.syncJobs();
}
