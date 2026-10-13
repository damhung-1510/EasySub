import fs from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import { createProjectStore, createEpisode } from './projectStore';
import { createDiscoveryWorkflow } from './discovery/workflow';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import { createCreativeBudgetStore } from './creativeBudget';
import type { StructuredLlm, LlmBoundary } from './llmAdapter';
import type {
  VideoProject,
  Episode,
  ProjectStore,
  Shot,
  MediaAsset,
  Character,
  ProjectDraft,
} from '../../types/videoProject';
import type {
  VideoCommandRequest,
  BatchQuote,
} from '../../types/videoCreationIpc';
import type {
  ProviderPublicConfig,
  ProviderDraft,
  VideoRequest,
  CostApproval,
} from '../../types/videoProvider';

const commands = new Set([
  'list',
  'create',
  'load',
  'update',
  'addEpisode',
  'delete',
  'importText',
  'startDiscovery',
  'answerDiscovery',
  'suggestRemaining',
  'confirmBrief',
  'runScript',
  'extractEntities',
  'linkEntities',
  'generateReference',
  'importReference',
  'approveReference',
  'buildStoryboard',
  'refreshShotBindings',
  'approveShots',
  'quote',
  'approveCost',
  'startBatch',
  'pollStatus',
  'cancel',
  'reconcile',
  'selectTake',
  'export',
  'backup',
  'importBackup',
  'assetPreview',
  'listProviders',
  'saveProvider',
  'deleteProvider',
  'testProvider',
  'listLlmProviders',
  'creativeUsage',
  'cancelOperation',
]);
const requestSchema = z
  .object({ command: z.string(), payload: z.record(z.unknown()).optional() })
  .strict();
export interface VideoServiceDeps {
  root: string;
  llm: (providerId: string, boundary: LlmBoundary) => StructuredLlm;
  listLlmProviders: () => { id: string; name: string; modelId: string }[];
  providerSettings?: any;
  ledger?: any;
  jobRunner?: any;
  jobStore?: any;
  getVideoAdapter?: (providerId: string, revisionId?: string) => Promise<any>;
  getImageAdapter?: (providerId: string) => Promise<any>;
  onChanged?: (event: {
    projectId?: string;
    version?: number;
    operation?: string;
  }) => void;
  exportEpisode?: (
    project: VideoProject,
    episodeId: string,
    options: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}
export interface VideoCreationService {
  command(request: VideoCommandRequest): Promise<any>;
  shutdown(): Promise<void>;
  syncJobs(): Promise<void>;
  store: ProjectStore;
}
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const str = (p: Record<string, unknown>, key: string) =>
  z.string().min(1).max(100000).parse(p[key]);
const num = (p: Record<string, unknown>, key: string) =>
  z.number().int().positive().parse(p[key]);
const clone = <T>(v: T): T => structuredClone(v);
export async function createVideoCreationService(
  deps: VideoServiceDeps,
): Promise<VideoCreationService> {
  const store = createProjectStore(deps.root);
  const ledger =
    deps.ledger ||
    (await import('./budgetLedger')).createBudgetLedger(
      path.join(path.dirname(deps.root), 'video-budget'),
    );
  deps.ledger = ledger;
  const creativeBudget = createCreativeBudgetStore(
    path.join(path.dirname(deps.root), 'video-creative-budget'),
  );
  const operations = new Map<string, AbortController>();
  const quotes = new Map<
    string,
    {
      quote: BatchQuote;
      projectVersion: number;
      projectId: string;
      episodeId: string;
      provider: any;
      requests: VideoRequest[];
      shotIds: string[];
    }
  >();
  const approvals = new Map<string, CostApproval>();
  const emit = (p: VideoProject, operation?: string) => {
    deps.onChanged?.({ projectId: p.id, version: p.version, operation });
    return p;
  };
  async function current(payload: Record<string, unknown>) {
    const project = await store.load(str(payload, 'projectId'));
    const episode = project.episodes.find((e) => e.id === payload.episodeId);
    return { project, episode };
  }
  function requireEpisode(e: Episode | undefined): Episode {
    if (!e) throw new Error('EPISODE_NOT_FOUND');
    return e;
  }
  function approvedEpisode(e: Episode) {
    if (!e.brief?.approvedAt) throw new Error('BRIEF_REQUIRED');
    if (!e.script?.approvedAt) throw new Error('SCRIPT_REQUIRED');
  }
  async function mutate(id: string, fn: (p: VideoProject) => VideoProject) {
    for (let i = 0; i < 4; i++) {
      const p = await store.load(id);
      try {
        return emit(await store.update(id, p.version, fn));
      } catch (error) {
        if ((error as Error).message !== 'VERSION_CONFLICT' || i === 3)
          throw error;
      }
    }
    throw new Error('VERSION_CONFLICT');
  }
  async function llm(payload: Record<string, unknown>, signal: AbortSignal) {
    if (payload.authorized !== true)
      throw new Error('COST_AUTHORIZATION_REQUIRED');
    const providerId = str(payload, 'llmProviderId');
    const projectId = str(payload, 'projectId');
    const episodeId = str(payload, 'episodeId');
    const maxRequests = z
      .number()
      .int()
      .min(1)
      .max(12)
      .parse(payload.maxRequests);
    const cap = z.number().int().nonnegative().parse(payload.capMinor),
      currency = str(payload, 'currency');
    await creativeBudget.authorize({
      projectId,
      episodeId,
      providerId,
      currency,
      capMinor: cap,
      maxRequests,
      newSession: payload.newCreativeBudget === true,
    });
    return deps.llm(providerId, {
      beforeRequest: async () => {
        signal.throwIfAborted();
        const { approval, number } = await creativeBudget.nextRequest(
          projectId,
          episodeId,
          providerId,
        );
        const quote = {
          currency,
          confidence: 'unknown' as const,
          capturedAt: new Date().toISOString(),
          components: [{ label: 'LLM request ' + number }],
        };
        await ledger.reserve(
          projectId,
          approval,
          quote,
          randomUUID(),
          undefined,
          'llm',
        );
      },
    });
  }
  async function op<T>(id: string, run: (signal: AbortSignal) => Promise<T>) {
    if (operations.has(id)) throw new Error('OPERATION_BUSY');
    const controller = new AbortController();
    operations.set(id, controller);
    try {
      return await run(controller.signal);
    } finally {
      operations.delete(id);
    }
  }
  async function command(raw: VideoCommandRequest): Promise<any> {
    const request = requestSchema.parse(raw);
    if (!commands.has(request.command)) throw new Error('INVALID_COMMAND');
    const p = request.payload || {};
    switch (request.command) {
      case 'list':
        return store.list();
      case 'create':
        return emit(
          await store.create(
            z
              .object({
                name: z.string().trim().min(1).max(200),
                kind: z.enum(['single', 'series']),
                idea: z.string().max(100000).optional(),
                language: z.string().optional(),
                targetDurationMs: z.number().int().positive().optional(),
                aspectRatio: z.string().optional(),
                audioMode: z.enum(['narration', 'tts', 'native']).optional(),
                style: z.string().optional(),
              })
              .parse(p) as ProjectDraft,
          ),
        );
      case 'load':
        return store.load(str(p, 'projectId'));
      case 'listLlmProviders':
        return deps.listLlmProviders();
      case 'creativeUsage':
        return creativeBudget.usage(
          str(p, 'projectId'),
          str(p, 'episodeId'),
          str(p, 'llmProviderId'),
        );
      case 'listProviders':
        return deps.providerSettings?.list() ?? [];
      case 'saveProvider': {
        if (!deps.providerSettings) throw new Error('ENGINE_UNAVAILABLE');
        return deps.providerSettings.save(
          p.draft as ProviderDraft,
          typeof p.secret === 'string' && p.secret ? p.secret : undefined,
        );
      }
      case 'deleteProvider':
        return deps.providerSettings.delete(str(p, 'providerId'));
      case 'testProvider': {
        const config = await deps.providerSettings.get(str(p, 'providerId'));
        return {
          verified: false,
          message: 'CONNECTION_TEST_REQUIRES_APPROVED_GENERATION',
          providerId: config.id,
        };
      }
      case 'addEpisode': {
        return emit(
          await store.update(
            str(p, 'projectId'),
            num(p, 'expectedVersion'),
            (project) => {
              if (project.kind !== 'series') throw new Error('SERIES_REQUIRED');
              project.episodes.push(
                createEpisode({
                  name:
                    typeof p.name === 'string'
                      ? p.name
                      : `Episode ${project.episodes.length + 1}`,
                  order: project.episodes.length + 1,
                  language: project.episodes[0]?.language,
                }),
              );
              return project;
            },
          ),
        );
      }
      case 'update':
        return emit(
          await store.update(
            str(p, 'projectId'),
            num(p, 'expectedVersion'),
            (project) => {
              const patch = z.record(z.unknown()).parse(p.patch);
              if (typeof patch.name === 'string')
                project.name = z.string().min(1).max(200).parse(patch.name);
              const episode = project.episodes.find(
                (e) => e.id === p.episodeId,
              );
              if (episode) {
                for (const key of [
                  'idea',
                  'originalScriptText',
                  'language',
                  'style',
                  'aspectRatio',
                ] as const)
                  if (patch[key] !== undefined)
                    episode[key] = z.string().max(100000).parse(patch[key]);
                if (patch.audioMode !== undefined)
                  episode.audioMode = z
                    .enum(['native', 'narration', 'tts'])
                    .parse(patch.audioMode);
                if (patch.targetDurationMs !== undefined)
                  episode.targetDurationMs = z
                    .number()
                    .int()
                    .positive()
                    .parse(patch.targetDurationMs);
                if (patch.script) {
                  const { scriptSchema } = require('./schemas');
                  const value = scriptSchema.parse(patch.script);
                  if (episode.script?.approvedAt) {
                    episode.scriptRevisions.push(clone(episode.script));
                    value.revisionId = randomUUID();
                    value.createdAt = new Date().toISOString();
                    delete value.approvedAt;
                    episode.shots.forEach((s) => (s.stale = true));
                  }
                  episode.script = value;
                }
                if (patch.brief) {
                  const { creativeBriefSchema } = require('./schemas');
                  const brief = creativeBriefSchema.parse({
                    ...(patch.brief as object),
                    revisionId: randomUUID(),
                    createdAt: new Date().toISOString(),
                    approvedAt: undefined,
                  });
                  episode.brief = brief;
                  if (episode.discovery) {
                    episode.discovery.draftRevision = brief;
                    episode.discovery.draftRevisions.push(clone(brief));
                    episode.discovery.status = 'review';
                    episode.discovery.version++;
                    const i = project.discoverySessions.findIndex(
                      (d) => d.id === episode.discovery!.id,
                    );
                    if (i >= 0)
                      project.discoverySessions[i] = episode.discovery;
                  }
                  if (episode.script?.approvedAt) {
                    if (
                      !episode.scriptRevisions.some(
                        (s) => s.revisionId === episode.script!.revisionId,
                      )
                    )
                      episode.scriptRevisions.push(clone(episode.script));
                    delete episode.script;
                  }
                  episode.shots.forEach((s) => (s.stale = true));
                }
                if (patch.approveScript === true) {
                  if (!episode.brief?.approvedAt || !episode.script)
                    throw new Error('BRIEF_REQUIRED');
                  for (const scene of episode.script.scenes) {
                    if (
                      scene.characterIds.some(
                        (id) =>
                          !project.characters.some(
                            (c) => c.id === id && c.confirmed,
                          ),
                      ) ||
                      scene.dialogues.some(
                        (d) => !scene.characterIds.includes(d.speakerId),
                      )
                    )
                      throw new Error('UNKNOWN_CHARACTER');
                    let location =
                      project.locations.find(
                        (l) => l.id === scene.locationId,
                      ) ||
                      project.locations.find((l) => l.name === scene.location);
                    if (!location) {
                      location = {
                        id: randomUUID(),
                        revisionId: randomUUID(),
                        createdAt: new Date().toISOString(),
                        name: scene.location,
                        description: scene.location,
                      };
                      project.locations.push(location);
                    }
                    location.approvedAt ??= new Date().toISOString();
                    scene.locationId = location.id;
                  }
                  let style = project.styles.find(
                    (v) => v.name === episode.style,
                  );
                  if (!style) {
                    style = {
                      id: randomUUID(),
                      revisionId: randomUUID(),
                      createdAt: new Date().toISOString(),
                      name: episode.style,
                      description: episode.style,
                    };
                    project.styles.push(style);
                  }
                  style.approvedAt ??= new Date().toISOString();
                  episode.script.approvedAt = new Date().toISOString();
                  episode.status = 'approved';
                }
                if (patch.shots) {
                  const shots = z
                    .array(z.unknown())
                    .max(500)
                    .parse(patch.shots) as Shot[];
                  if (shots.length !== episode.shots.length)
                    throw new Error('USE_STORYBOARD_TO_CHANGE_SHOT_COUNT');
                  episode.shots = episode.shots.map((old) => {
                    const edited = shots.find((s) => s.id === old.id);
                    if (!edited) throw new Error('SHOT_ID_IMMUTABLE');
                    const snapshot = clone(edited.snapshot);
                    if (hash(snapshot) !== hash(old.snapshot)) {
                      snapshot.revisionId = randomUUID();
                      snapshot.createdAt = new Date().toISOString();
                      snapshot.id = old.snapshot.id;
                      snapshot.characterBindings = clone(
                        old.snapshot.characterBindings,
                      );
                      snapshot.briefRevisionId = old.snapshot.briefRevisionId;
                      snapshot.scriptRevisionId = old.snapshot.scriptRevisionId;
                      delete snapshot.approvedAt;
                      return {
                        ...old,
                        snapshot,
                        snapshots: [...old.snapshots, clone(old.snapshot)],
                        stale: true,
                        selectedAttemptId: undefined,
                      };
                    }
                    return old;
                  });
                }
              }
              if (patch.characters) {
                const incoming = z
                  .array(z.unknown())
                  .max(100)
                  .parse(patch.characters) as Character[];
                project.characters = project.characters.map((old) => {
                  const edited = incoming.find((c) => c.id === old.id);
                  if (!edited) return old;
                  const result = clone(old);
                  result.name = z.string().min(1).parse(edited.name);
                  result.aliases = z.array(z.string()).parse(edited.aliases);
                  result.confirmed = edited.confirmed === true;
                  const revision = edited.revisions.find(
                    (r) => r.revisionId === edited.currentRevisionId,
                  );
                  const original = old.revisions.find(
                    (r) => r.revisionId === old.currentRevisionId,
                  )!;
                  if (revision && hash(revision) !== hash(original)) {
                    const visualChanged =
                      hash({
                        description: revision.identity.description,
                        age: revision.identity.age,
                        body: revision.identity.body,
                        distinguishingFeatures:
                          revision.identity.distinguishingFeatures,
                      }) !==
                      hash({
                        description: original.identity.description,
                        age: original.identity.age,
                        body: original.identity.body,
                        distinguishingFeatures:
                          original.identity.distinguishingFeatures,
                      });
                    const next = {
                      ...clone(revision),
                      revisionId: randomUUID(),
                      createdAt: new Date().toISOString(),
                      approvedAt: undefined,
                      referenceAssetIds: visualChanged
                        ? []
                        : [...original.referenceAssetIds],
                    };
                    result.revisions.push(next);
                    result.currentRevisionId = next.revisionId;
                    result.confirmed = false;
                    for (const ep of project.episodes)
                      for (const shot of ep.shots)
                        if (
                          shot.snapshot.characterBindings.some(
                            (b) => b.characterId === old.id,
                          )
                        )
                          shot.stale = true;
                  }
                  return result;
                });
              }
              return project;
            },
          ),
        );
      case 'importText':
        return emit(
          await store.update(
            str(p, 'projectId'),
            num(p, 'expectedVersion'),
            (project) => {
              const e = requireEpisode(
                project.episodes.find((e) => e.id === p.episodeId),
              );
              e.originalScriptText = str(p, 'text');
              return project;
            },
          ),
        );
      case 'startDiscovery':
      case 'answerDiscovery':
      case 'suggestRemaining':
      case 'confirmBrief': {
        if (request.command !== 'confirmBrief' && p.authorized !== true)
          throw new Error('COST_AUTHORIZATION_REQUIRED');
        const { project, episode } = await current(p);
        const e = requireEpisode(episode);
        return op(project.id, async (signal) => {
          const workflow = createDiscoveryWorkflow({
            store,
            llm:
              request.command === 'confirmBrief'
                ? {
                    complete: async () => {
                      throw new Error('UNEXPECTED_LLM_CALL');
                    },
                  }
                : await llm(p, signal),
          });
          if (request.command === 'startDiscovery')
            await workflow.startDiscovery(
              {
                projectId: project.id,
                episodeId: e.id,
                inputText:
                  typeof p.inputText === 'string'
                    ? p.inputText
                    : e.originalScriptText || e.idea,
                facts: {
                  language: e.language,
                  style: e.style,
                  targetDurationMs: e.targetDurationMs,
                  audioMode: e.audioMode,
                },
              },
              signal,
            );
          else {
            if (!e.discovery) throw new Error('DISCOVERY_REQUIRED');
            if (request.command === 'answerDiscovery') {
              const answer =
                typeof p.answer === 'string' ? p.answer : str(p, 'text');
              const field = e.discovery.currentQuestion?.targetField;
              await workflow.answerDiscovery(
                e.discovery.id,
                { text: answer, facts: field ? { [field]: answer } : {} },
                e.discovery.version,
                signal,
              );
            }
            if (request.command === 'suggestRemaining')
              await workflow.suggestRemaining(e.discovery.id, signal);
            if (request.command === 'confirmBrief')
              await workflow.confirmBrief(
                e.discovery.id,
                str(p, 'draftRevisionId'),
                e.discovery.version,
              );
          }
          return emit(await store.load(project.id));
        });
      }
      case 'cancelOperation':
        operations.get(str(p, 'projectId'))?.abort();
        return true;
      case 'quote': {
        const { project, episode } = await current(p);
        approvedEpisode(requireEpisode(episode));
        return quoteBatch(project, episode!, p);
      }
      case 'approveCost': {
        const record = quotes.get(str(p, 'quoteId'));
        if (!record) throw new Error('QUOTE_EXPIRED');
        const cap = num(p, 'capMinor');
        const currency = str(p, 'currency');
        if (currency !== record.quote.currency)
          throw new Error('CURRENCY_MISMATCH');
        if (record.quote.maxMinor !== undefined && cap < record.quote.maxMinor)
          throw new Error('BUDGET_EXCEEDED');
        const approval: CostApproval = {
          id: randomUUID(),
          fingerprint: record.quote.fingerprint,
          providerId: record.provider.id,
          modelId: record.provider.modelId,
          currency,
          capMinor: cap,
          unknownCeilingMinor:
            record.quote.confidence === 'unknown' ? cap : undefined,
          expiresAt: Date.now() + 3600000,
        };
        approvals.set(approval.id, approval);
        return { approvalId: approval.id };
      }
      default:
        return extended(request.command, p);
    }
  }
  async function quoteBatch(
    project: VideoProject,
    episode: Episode,
    p: Record<string, unknown>,
  ): Promise<BatchQuote> {
    if (!deps.getVideoAdapter || !deps.providerSettings)
      throw new Error('ENGINE_UNAVAILABLE');
    const provider = await deps.providerSettings.get(str(p, 'videoProviderId'));
    if (provider.kind !== 'video') throw new Error('VIDEO_PROVIDER_REQUIRED');
    const adapter = await deps.getVideoAdapter(
      provider.id,
      provider.revisionId,
    );
    const { compileVideoRequest } = await import('./promptCompiler');
    const { createAssetStore } = await import('./assetStore');
    const assets = createAssetStore(deps.root);
    const signal = new AbortController().signal;
    const shots = episode.shots.filter(
      (s) =>
        !Array.isArray(p.shotIds) || (p.shotIds as string[]).includes(s.id),
    );
    if (!shots.length) throw new Error('SHOT_REQUIRED');
    const requests: VideoRequest[] = [];
    const components: { label: string; minor?: number }[] = [];
    let amount = 0,
      unknown = false,
      currency = provider.pricing?.currency || 'USD';
    for (const shot of shots) {
      if (!shot.snapshot.approvedAt || shot.stale)
        throw new Error('SHOT_APPROVAL_REQUIRED');
      const base64: Record<string, string> = {};
      for (const binding of shot.snapshot.characterBindings)
        for (const assetId of binding.referenceAssetIds) {
          const a = project.assets.find((a) => a.id === assetId);
          if (!a) throw new Error('REFERENCE_REQUIRED');
          base64[assetId] = (
            await assets.readReference(project.id, a, signal)
          ).dataBase64;
        }
      const request = compileVideoRequest(
        shot.snapshot,
        project,
        adapter.capabilities(),
        {
          modelId: provider.modelId,
          requestId: randomUUID(),
          assetBase64: base64,
        },
      );
      requests.push(request);
      const cost = await adapter.quote(request, signal);
      if (cost.currency !== currency && components.length)
        throw new Error('CURRENCY_MISMATCH');
      currency = cost.currency;
      unknown ||= cost.confidence === 'unknown' || cost.maxMinor === undefined;
      amount += cost.maxMinor ?? 0;
      components.push({ label: shot.id, minor: cost.maxMinor });
    }
    const fingerprint = hash(
      requests.map((r) => ({
        fingerprint: r.fingerprint,
        requestId: r.requestId,
      })),
    );
    const quote: BatchQuote = {
      quoteId: randomUUID(),
      fingerprint,
      providerId: provider.id,
      modelId: provider.modelId,
      shotCount: shots.length,
      currency,
      maxMinor: unknown ? undefined : amount,
      confidence: unknown ? 'unknown' : 'estimate',
      capturedAt: new Date().toISOString(),
      components,
    };
    quotes.set(quote.quoteId, {
      quote,
      projectVersion: project.version,
      projectId: project.id,
      episodeId: episode.id,
      provider,
      requests,
      shotIds: shots.map((s) => s.id),
    });
    return quote;
  }
  async function extended(
    command: string,
    p: Record<string, unknown>,
  ): Promise<any> {
    if (command === 'pollStatus') {
      if (!deps.jobRunner) return [];
      await deps.jobRunner.pollStatus();
      await syncJobs();
      return store.load(str(p, 'projectId'));
    }
    if (command === 'cancel') {
      if (!deps.jobRunner) throw new Error('ENGINE_UNAVAILABLE');
      return deps.jobRunner.cancel(str(p, 'attemptId'));
    }
    if (command === 'reconcile') {
      if (!deps.jobRunner) throw new Error('ENGINE_UNAVAILABLE');
      return deps.jobRunner.reconcile(str(p, 'attemptId'), p.decision);
    }
    if (command === 'importBackup') {
      const { importProjectBackup } = await import('./backup');
      return emit(
        await importProjectBackup({
          source: str(p, 'sourcePath'),
          root: deps.root,
        }),
      );
    }
    const { project, episode } = await current(p);
    if (command === 'delete') {
      if (operations.has(project.id)) throw new Error('PROJECT_BUSY');
      if (deps.jobRunner) {
        const jobs = await deps.jobRunner.pollStatus();
        if (
          jobs.some(
            (j: any) =>
              j.projectId === project.id &&
              [
                'queued',
                'running',
                'submitting',
                'downloading',
                'unknown',
              ].includes(j.state),
          )
        )
          throw new Error('PROJECT_BUSY');
      }
      await fs.rm(path.join(deps.root, project.id), { recursive: true });
      return true;
    }
    if (command === 'assetPreview') {
      const asset = project.assets.find((a) => a.id === p.assetId);
      if (!asset) throw new Error('ASSET_NOT_FOUND');
      const { createAssetStore } = await import('./assetStore');
      const file = createAssetStore(deps.root).resolve(
        project.id,
        asset.relativePath,
      );
      if (asset.kind === 'image') {
        const bytes = await fs.readFile(file);
        if (bytes.length > 20 * 1024 * 1024)
          throw new Error('PREVIEW_TOO_LARGE');
        return {
          url: `data:${asset.mimeType};base64,${bytes.toString('base64')}`,
          asset,
        };
      }
      return { url: 'media://' + encodeURIComponent(file), asset };
    }
    if (command === 'backup') {
      const { exportProjectBackup } = await import('./backup');
      return exportProjectBackup({
        project,
        root: deps.root,
        destination: str(p, 'destinationPath'),
      });
    }
    const e = requireEpisode(episode);
    if (
      command === 'runScript' ||
      command === 'extractEntities' ||
      command === 'buildStoryboard'
    )
      return op(project.id, async (signal) => {
        const model = await llm(p, signal);
        if (command === 'runScript') {
          const { runScriptStep } = await import('./scriptWorkflow');
          const step =
            p.step || (p.mode === 'import' ? 'import-analysis' : 'script');
          const result = await runScriptStep(
            { step: step as any, project, episodeId: e.id },
            { llm: model },
            signal,
          );
          if (result.script)
            return emit(
              await store.update(project.id, project.version, (next) => {
                const ep = requireEpisode(
                  next.episodes.find((v) => v.id === e.id),
                );
                if (
                  ep.script &&
                  !ep.scriptRevisions.some(
                    (s) => s.revisionId === ep.script!.revisionId,
                  )
                )
                  ep.scriptRevisions.push(clone(ep.script));
                ep.script = result.script;
                ep.shots.forEach((s) => (s.stale = true));
                return next;
              }),
            );
          return { project, review: result };
        }
        if (command === 'extractEntities') {
          if (!e.script) throw new Error('SCRIPT_REQUIRED');
          if (e.script.approvedAt)
            throw new Error('EXTRACT_CAST_BEFORE_SCRIPT_APPROVAL');
          const { extractEntities, applyCharacterLinks } =
            await import('./characterResolver');
          const candidates = await extractEntities(
            e.script,
            { llm: model },
            signal,
          );
          return emit(
            await store.update(project.id, project.version, (next) => {
              const ids = new Set(next.characters.map((c) => c.id));
              next = applyCharacterLinks(
                next,
                candidates.characters.map((c) => ({
                  candidateId: c.id,
                  action: 'new',
                  name: c.name,
                  description: c.description,
                })),
              );
              for (const character of next.characters)
                if (!ids.has(character.id)) {
                  character.confirmed = false;
                  character.aliases =
                    candidates.characters.find((c) => c.name === character.name)
                      ?.aliases || [];
                }
              for (const location of candidates.locations)
                if (!next.locations.some((v) => v.name === location.name))
                  next.locations.push({
                    id: randomUUID(),
                    revisionId: randomUUID(),
                    createdAt: new Date().toISOString(),
                    name: location.name,
                    description: location.description,
                  });
              for (const prop of candidates.props)
                if (!next.props.some((v) => v.name === prop.name))
                  next.props.push({
                    id: randomUUID(),
                    revisionId: randomUUID(),
                    createdAt: new Date().toISOString(),
                    name: prop.name,
                    description: prop.description,
                  });
              return next;
            }),
          );
        }
        approvedEpisode(e);
        const { buildStoryboard } = await import('./storyboardWorkflow');
        const provider = await deps.providerSettings.get(
          str(p, 'videoProviderId'),
        );
        const adapter = await deps.getVideoAdapter!(
          provider.id,
          provider.revisionId,
        );
        const shots = await buildStoryboard(
          { project, episodeId: e.id, capabilities: adapter.capabilities() },
          { llm: model },
          signal,
        );
        return emit(
          await store.update(project.id, project.version, (next) => {
            const ep = requireEpisode(next.episodes.find((v) => v.id === e.id));
            if (ep.shots.some((s) => s.attempts.length))
              throw new Error('EXISTING_FOOTAGE_REQUIRES_NEW_EPISODE_REVISION');
            ep.shots = shots.map((shot: any, index: number) => ({
              id: shot.snapshot?.id || shot.id || randomUUID(),
              order: shot.order || index + 1,
              snapshot: shot.snapshot || shot,
              snapshots: [clone(shot.snapshot || shot)],
              attempts: [],
            }));
            return next;
          }),
        );
      });
    if (command === 'linkEntities')
      return emit(
        await store.update(project.id, num(p, 'expectedVersion'), (next) => {
          const c = next.characters.find((c) => c.id === p.characterId);
          if (!c) throw new Error('UNKNOWN_CHARACTER');
          if (p.targetCharacterId) {
            const target = next.characters.find(
              (c) => c.id === p.targetCharacterId,
            );
            if (!target || c.id === target.id)
              throw new Error('INVALID_CHARACTER_LINK');
            target.confirmed = true;
            target.aliases = [
              ...new Set([...target.aliases, c.name, ...c.aliases]),
            ];
            for (const ep of next.episodes) {
              if (ep.script && !ep.script.approvedAt) {
                for (const scene of ep.script.scenes) {
                  scene.characterIds = [
                    ...new Set(
                      scene.characterIds.map((id) =>
                        id === c.id ? target.id : id,
                      ),
                    ),
                  ];
                  scene.dialogues.forEach((d) => {
                    if (d.speakerId === c.id) d.speakerId = target.id;
                  });
                }
              }
            }
            c.confirmed = false;
            if (
              !next.episodes
                .flatMap((ep) => ep.shots)
                .some((shot) =>
                  [
                    shot.snapshot,
                    ...shot.snapshots,
                    ...shot.attempts.map((a) => a.snapshot),
                  ].some((snap) =>
                    snap.characterBindings.some((b) => b.characterId === c.id),
                  ),
                ) &&
              !next.episodes.some((ep) =>
                ep.scriptRevisions.some((sc) =>
                  sc.scenes.some((scene) => scene.characterIds.includes(c.id)),
                ),
              )
            )
              next.characters = next.characters.filter((v) => v.id !== c.id);
          } else {
            c.confirmed = p.confirmed === true;
            if (c.confirmed) {
              const revision = c.revisions.find(
                (value) => value.revisionId === c.currentRevisionId,
              );
              if (!revision) throw new Error('CHARACTER_REVISION_NOT_FOUND');
              if (
                revision.referenceAssetIds.some(
                  (id) => !next.assets.some((a) => a.id === id && a.approvedAt),
                )
              )
                throw new Error('REFERENCE_APPROVAL_REQUIRED');
              revision.approvedAt ??= new Date().toISOString();
            }
          }
          return next;
        }),
      );
    if (command === 'refreshShotBindings')
      return emit(
        await store.update(project.id, num(p, 'expectedVersion'), (next) => {
          const ep = requireEpisode(next.episodes.find((v) => v.id === e.id));
          approvedEpisode(ep);
          let changed = false;
          for (const shot of ep.shots) {
            const bindings = shot.snapshot.characterBindings.map((binding) => {
              const character = next.characters.find(
                (value) => value.id === binding.characterId,
              );
              const revision = character?.revisions.find(
                (value) => value.revisionId === character.currentRevisionId,
              );
              if (!character?.confirmed || !revision?.approvedAt)
                throw new Error('CHARACTER_NOT_APPROVED');
              if (!revision.referenceAssetIds.length)
                throw new Error('REFERENCE_REQUIRED');
              if (
                revision.referenceAssetIds.some(
                  (id) => !next.assets.some((a) => a.id === id && a.approvedAt),
                )
              )
                throw new Error('REFERENCE_APPROVAL_REQUIRED');
              return {
                ...binding,
                characterRevisionId: revision.revisionId,
                referenceAssetIds: [...revision.referenceAssetIds],
              };
            });
            if (hash(bindings) === hash(shot.snapshot.characterBindings))
              continue;
            const previous = clone(shot.snapshot);
            shot.snapshot = {
              ...previous,
              revisionId: randomUUID(),
              createdAt: new Date().toISOString(),
              approvedAt: undefined,
              characterBindings: bindings,
            };
            if (
              !shot.snapshots.some(
                (value) => value.revisionId === previous.revisionId,
              )
            )
              shot.snapshots.push(previous);
            shot.selectedAttemptId = undefined;
            shot.stale = true;
            changed = true;
          }
          if (!changed) throw new Error('SHOT_BINDINGS_CURRENT');
          return next;
        }),
      );
    if (command === 'approveShots')
      return emit(
        await store.update(project.id, num(p, 'expectedVersion'), (next) => {
          const ep = requireEpisode(next.episodes.find((v) => v.id === e.id));
          approvedEpisode(ep);
          const { validateShot } = require('./schemas');
          for (const shot of ep.shots) {
            if (
              shot.snapshot.characterBindings.some((binding) =>
                next.characters.find(
                  (character) =>
                    character.id === binding.characterId &&
                    character.currentRevisionId !== binding.characterRevisionId,
                ),
              )
            )
              throw new Error('CHARACTER_BINDING_OUTDATED');
            const errors = validateShot(shot.snapshot, next).filter(
              (v: any) => v.severity === 'blocking',
            );
            if (errors.length)
              throw new Error(errors.map((v: any) => v.code).join(', '));
            shot.snapshot.approvedAt ??= new Date().toISOString();
            shot.snapshots = shot.snapshots
              .filter((v) => v.revisionId !== shot.snapshot.revisionId)
              .concat(clone(shot.snapshot));
            shot.stale = false;
          }
          return next;
        }),
      );
    if (command === 'importReference')
      return op(project.id, async (signal) => {
        const { createAssetStore } = await import('./assetStore');
        const asset = await createAssetStore(deps.root).importReference(
          project.id,
          str(p, 'sourcePath'),
          signal,
        );
        return emit(
          await store.update(project.id, project.version, (next) => {
            if (!next.assets.some((a) => a.id === asset.id))
              next.assets.push(asset);
            return next;
          }),
        );
      });
    if (command === 'approveReference')
      return emit(
        await store.update(project.id, num(p, 'expectedVersion'), (next) => {
          const c = next.characters.find((c) => c.id === p.characterId),
            asset = next.assets.find(
              (a) => a.id === p.assetId && a.kind === 'image',
            );
          if (!c || !asset) throw new Error('REFERENCE_REQUIRED');
          asset.approvedAt ??= new Date().toISOString();
          const before = c.revisions.find(
            (r) => r.revisionId === c.currentRevisionId,
          )!;
          const reference = {
            ...clone(before),
            revisionId: randomUUID(),
            createdAt: new Date().toISOString(),
            approvedAt: new Date().toISOString(),
            referenceAssetIds: [
              ...new Set([...before.referenceAssetIds, asset.id]),
            ],
          };
          c.revisions.push(reference);
          c.currentRevisionId = reference.revisionId;
          for (const ep of next.episodes)
            for (const shot of ep.shots)
              if (
                shot.snapshot.characterBindings.some(
                  (b) => b.characterId === c.id,
                )
              )
                shot.stale = true;
          return next;
        }),
      );
    if (command === 'generateReference')
      return op(project.id, async (signal) => {
        if (p.authorized !== true)
          throw new Error('COST_AUTHORIZATION_REQUIRED');
        const c = project.characters.find((c) => c.id === p.characterId);
        if (!c || !c.confirmed)
          throw new Error('CHARACTER_CONFIRMATION_REQUIRED');
        const revision = c.revisions.find(
          (r) => r.revisionId === c.currentRevisionId,
        )!;
        const provider = await deps.providerSettings.get(
          str(p, 'imageProviderId'),
        );
        const adapter = await deps.getImageAdapter!(provider.id);
        const { createAssetStore } = await import('./assetStore');
        const assets = createAssetStore(deps.root);
        const references = [];
        for (const id of revision.referenceAssetIds) {
          const asset = project.assets.find((a) => a.id === id);
          if (!asset?.approvedAt) throw new Error('REFERENCE_REQUIRED');
          references.push(
            await assets.readReference(project.id, asset, signal),
          );
        }
        if (references.length && !adapter.capabilities().references)
          throw new Error('REFERENCE_CAPABILITY_REQUIRED');
        const image = {
          requestId: randomUUID(),
          fingerprint: '',
          prompt:
            typeof p.prompt === 'string'
              ? p.prompt
              : `Character reference portrait. ${c.name}: ${revision.identity.description}. Style: ${e.style}. No text, no watermark.`,
          modelId: provider.modelId,
          references,
        };
        image.fingerprint = hash(image);
        const quote = await adapter.quote(image, signal);
        const cap = num(p, 'capMinor'),
          currency = str(p, 'currency');
        const approval: CostApproval = {
          id: randomUUID(),
          providerId: provider.id,
          modelId: provider.modelId,
          fingerprint: image.fingerprint,
          currency,
          capMinor: cap,
          unknownCeilingMinor: cap,
          expiresAt: Date.now() + 600000,
        };
        const reservation = await deps.ledger.reserve(
          project.id,
          approval,
          quote,
          image.requestId,
          undefined,
          'image',
        );
        let result;
        try {
          result = await adapter.generate(image, signal);
        } catch (error) {
          if ((error as any).outcome === 'failed')
            await deps.ledger.release(reservation.id, 'not-submitted');
          throw error;
        }
        await deps.ledger.settle(reservation.id, result.actualCost);
        const temp = path.join(
          deps.root,
          project.id,
          `.image-${image.requestId}.tmp`,
        );
        await fs.writeFile(temp, result.bytes);
        try {
          const asset = await assets.importReference(project.id, temp, signal);
          return await mutate(project.id, (next) => {
            if (!next.assets.some((a) => a.id === asset.id))
              next.assets.push(asset);
            return next;
          });
        } finally {
          await fs.rm(temp, { force: true });
        }
      });
    if (command === 'startBatch') {
      if (!deps.jobRunner) throw new Error('ENGINE_UNAVAILABLE');
      const record = quotes.get(str(p, 'quoteId'));
      const approval = approvals.get(str(p, 'approvalId'));
      if (
        !record ||
        !approval ||
        record.projectId !== project.id ||
        record.episodeId !== e.id
      )
        throw new Error('APPROVAL_REQUIRED');
      if (record.projectVersion !== project.version)
        throw new Error('QUOTE_STALE');
      if (approval.fingerprint !== record.quote.fingerprint)
        throw new Error('APPROVAL_MISMATCH');
      const jobs = await deps.jobRunner.start({
        projectId: project.id,
        episodeId: e.id,
        provider: record.provider,
        approval,
        requests: record.requests,
        shotIds: record.shotIds,
        fingerprint: record.quote.fingerprint,
        snapshots: record.shotIds.map((id) =>
          clone(e.shots.find((s) => s.id === id)!.snapshot),
        ),
      });
      const ids = jobs.map((j: any) => (typeof j === 'string' ? j : j.id));
      await mutate(project.id, (next) => {
        const ep = requireEpisode(next.episodes.find((v) => v.id === e.id));
        record.shotIds.forEach((id, index) => {
          const shot = ep.shots.find((s) => s.id === id)!;
          if (!shot.attempts.some((a) => a.id === ids[index]))
            shot.attempts.push({
              id: ids[index],
              snapshot: clone(shot.snapshot),
              snapshotHash: hash(shot.snapshot),
              providerId: record.provider.id,
              modelId: record.provider.modelId,
              providerConfigRevisionId: record.provider.revisionId,
              state: 'queued',
              artifacts: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
        });
        ep.status = 'production';
        return next;
      });
      quotes.delete(record.quote.quoteId);
      await syncJobs();
      return store.load(project.id);
    }
    if (command === 'selectTake')
      return emit(
        await store.update(project.id, num(p, 'expectedVersion'), (next) => {
          const ep = requireEpisode(next.episodes.find((v) => v.id === e.id));
          const shot = ep.shots.find((s) => s.id === p.shotId),
            attempt = shot?.attempts.find((a) => a.id === p.attemptId);
          if (
            !shot ||
            !attempt ||
            !attempt.artifacts.length ||
            !['review', 'accepted'].includes(attempt.state)
          )
            throw new Error('TAKE_NOT_READY');
          const outdatedBinding = shot.snapshot.characterBindings.some(
            (binding) =>
              next.characters.find(
                (character) =>
                  character.id === binding.characterId &&
                  character.currentRevisionId !== binding.characterRevisionId,
              ),
          );
          if (
            attempt.snapshot.revisionId !== shot.snapshot.revisionId ||
            outdatedBinding
          ) {
            if (p.keepOld !== true) throw new Error('STALE_TAKE');
            shot.keepOldDecision = {
              attemptId: attempt.id,
              acceptedAt: new Date().toISOString(),
              reason:
                typeof p.reason === 'string'
                  ? p.reason
                  : 'User explicitly kept previous revision',
            };
          } else delete shot.keepOldDecision;
          attempt.state = 'accepted';
          attempt.reviewedAt = new Date().toISOString();
          shot.selectedAttemptId = attempt.id;
          shot.stale = false;
          return next;
        }),
      );
    if (command === 'export') {
      if (!deps.exportEpisode) throw new Error('EXPORT_UNAVAILABLE');
      approvedEpisode(e);
      return op(project.id, async (signal) => {
        let reservation: any;
        if (e.audioMode !== 'native') {
          if (p.audioAuthorized !== true)
            throw new Error('COST_AUTHORIZATION_REQUIRED');
          const currency = str(p, 'currency'),
            cap = num(p, 'capMinor'),
            approval: CostApproval = {
              id: randomUUID(),
              fingerprint: hash([
                e.id,
                e.shots.map((s) => s.selectedAttemptId),
                p.dubbingConfig,
              ]),
              providerId: 'tts',
              modelId: 'tts',
              currency,
              capMinor: cap,
              unknownCeilingMinor: cap,
              expiresAt: Date.now() + 3600000,
            };
          reservation = await ledger.reserve(
            project.id,
            approval,
            {
              currency,
              confidence: 'unknown',
              capturedAt: new Date().toISOString(),
              components: [{ label: 'TTS export' }],
            },
            randomUUID(),
            undefined,
            'audio',
          );
        }
        const result: any = await deps.exportEpisode!(project, e.id, p, signal);
        if (reservation) await ledger.settle(reservation.id, undefined);
        if (result.asset)
          await mutate(project.id, (next) => {
            next.assets.push(result.asset);
            if (result.subtitleAsset) next.assets.push(result.subtitleAsset);
            const ep = next.episodes.find((v) => v.id === e.id)!;
            ep.status = 'exported';
            return next;
          });
        return result;
      });
    }
    throw new Error(`INVALID_COMMAND: ${command}`);
  }
  async function syncJobs() {
    if (!deps.jobRunner) return;
    const jobs = deps.jobStore
      ? await deps.jobStore.list()
      : await deps.jobRunner.pollStatus();
    for (const summary of await store.list()) {
      const project = await store.load(summary.id);
      let changed = false;
      for (const job of jobs.filter(
        (j: any) => j.projectId === project.id && j.snapshot && j.shotId,
      )) {
        const shot = project.episodes
          .flatMap((ep) => ep.shots)
          .find((s) => s.id === job.shotId);
        if (shot && !shot.attempts.some((a) => a.id === job.id)) {
          shot.attempts.push({
            id: job.id,
            snapshot: job.snapshot,
            snapshotHash: hash(job.snapshot),
            providerId: job.provider.id,
            modelId: job.provider.modelId,
            providerConfigRevisionId: job.provider.revisionId,
            remoteJobId: job.remoteJobId,
            ledgerReservationId: job.reservationId,
            state: job.state,
            artifacts: job.artifact ? [job.artifact] : [],
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          });
          changed = true;
        }
      }
      for (const ep of project.episodes)
        for (const shot of ep.shots)
          for (const attempt of shot.attempts) {
            const job = jobs.find((j: any) => j.id === attempt.id);
            if (!job) continue;
            const artifact = job.artifact || job.asset;
            const state = job.state === 'completed' ? 'review' : job.state;
            if (attempt.state === 'accepted') continue;
            if (
              state !== attempt.state ||
              job.remoteJobId !== attempt.remoteJobId ||
              (artifact && !attempt.artifacts.some((a) => a.id === artifact.id))
            ) {
              changed = true;
              attempt.state = state;
              attempt.remoteJobId = job.remoteJobId;
              attempt.updatedAt = new Date().toISOString();
              attempt.error = job.error;
              if (artifact) {
                attempt.artifacts = [artifact];
                if (!project.assets.some((a) => a.id === artifact.id))
                  project.assets.push(artifact);
              }
            }
          }
      if (changed)
        emit(await store.update(project.id, project.version, () => project));
    }
  }
  return {
    command,
    store,
    syncJobs,
    async shutdown() {
      for (const op of operations.values()) op.abort();
    },
  };
}
