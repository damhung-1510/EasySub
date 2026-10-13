import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import { parseVideoProject } from './schemas';
import { assertApprovedRevisionsUnchanged } from './revisions';
import { markChangedSnapshotsStale } from './dependencies';
import type {
  ProjectDraft,
  ProjectStore,
  VideoProject,
  Episode,
  ProjectSummary,
} from '../../types/videoProject';
const queues = new Map<string, Promise<unknown>>();
export function createEpisode(
  input: {
    name?: string;
    idea?: string;
    order?: number;
    language?: string;
    targetDurationMs?: number;
    aspectRatio?: string;
    audioMode?: Episode['audioMode'];
    style?: string;
  } = {},
): Episode {
  return {
    id: randomUUID(),
    name: input.name || 'Episode 1',
    order: input.order || 1,
    idea: input.idea || '',
    scriptRevisions: [],
    shots: [],
    targetDurationMs: input.targetDurationMs || 60000,
    language: input.language || 'vi',
    audioMode: input.audioMode || 'narration',
    aspectRatio: input.aspectRatio || '16:9',
    style: input.style || 'cinematic',
    status: 'draft',
  };
}
export interface ProjectStoreOptions {
  write?: typeof atomicReplaceTextFile;
}
export function createProjectStore(
  root: string,
  options: ProjectStoreOptions = {},
): ProjectStore {
  root = path.resolve(root);
  const write = options.write || atomicReplaceTextFile;
  const directory = (id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('INVALID_PROJECT_ID');
    return path.join(root, id);
  };
  const manifest = (id: string) => path.join(directory(id), 'project.json');
  const readSafe = async (id: string, name: string) => {
    const dir = await fs.lstat(directory(id));
    if (dir.isSymbolicLink() || !dir.isDirectory())
      throw new Error('UNSAFE_PROJECT_PATH');
    const file = path.join(directory(id), name);
    if ((await fs.lstat(file)).isSymbolicLink())
      throw new Error('UNSAFE_PROJECT_PATH');
    const parsed = parseVideoProject(
      JSON.parse(await fs.readFile(file, 'utf8')),
    );
    if (parsed.id !== id) throw new Error('PROJECT_IDENTITY_MISMATCH');
    return parsed;
  };
  const load = async (id: string): Promise<VideoProject> => {
    try {
      return await readSafe(id, 'project.json');
    } catch (error) {
      if (error instanceof Error && error.message === 'UNSAFE_PROJECT_PATH')
        throw error;
      try {
        return await readSafe(id, 'project.last-good.json');
      } catch (backupError) {
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' &&
          (backupError as NodeJS.ErrnoException).code === 'ENOENT'
        )
          throw new Error('PROJECT_NOT_FOUND');
        throw new Error('PROJECT_RECOVERY_REQUIRED');
      }
    }
  };
  return {
    load,
    async create(input: ProjectDraft) {
      const time = new Date().toISOString();
      const p: VideoProject = {
        id: randomUUID(),
        name: input.name.trim(),
        kind: input.kind,
        schemaVersion: 1,
        version: 1,
        createdAt: time,
        updatedAt: time,
        episodes: [createEpisode(input)],
        characters: [],
        assets: [],
        canon: [],
        locations: [],
        props: [],
        styles: [],
        discoverySessions: [],
        confirmedBriefRevisions: [],
      };
      parseVideoProject(p);
      await fs.mkdir(directory(p.id), { recursive: true });
      await write(manifest(p.id), JSON.stringify(p, null, 2));
      return structuredClone(p);
    },
    async update(id, expectedVersion, mutate) {
      const key = manifest(id);
      const previous = queues.get(key) || Promise.resolve();
      const operation = previous
        .catch(() => {})
        .then(async () => {
          const before = await load(id);
          if (before.version !== expectedVersion)
            throw new Error('VERSION_CONFLICT');
          const draft = mutate(structuredClone(before));
          if (
            draft.id !== before.id ||
            draft.schemaVersion !== before.schemaVersion ||
            draft.createdAt !== before.createdAt
          )
            throw new Error('PROJECT_IDENTITY_IMMUTABLE');
          assertApprovedRevisionsUnchanged(before, draft);
          markChangedSnapshotsStale(before, draft);
          const after = parseVideoProject({
            ...draft,
            version: before.version + 1,
            updatedAt: new Date().toISOString(),
          });
          await write(
            path.join(directory(id), 'project.last-good.json'),
            JSON.stringify(before, null, 2),
          );
          await write(key, JSON.stringify(after, null, 2));
          return structuredClone(after);
        });
      queues.set(key, operation);
      try {
        return await operation;
      } finally {
        if (queues.get(key) === operation) queues.delete(key);
      }
    },
    async list() {
      await fs.mkdir(root, { recursive: true });
      const summaries: ProjectSummary[] = [];
      for (const dir of await fs.readdir(root, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        try {
          const p = await load(dir.name);
          summaries.push({
            id: p.id,
            name: p.name,
            kind: p.kind,
            version: p.version,
            updatedAt: p.updatedAt,
            episodeCount: p.episodes.length,
          });
        } catch {
          summaries.push({
            id: dir.name,
            name: dir.name,
            kind: 'single',
            version: 0,
            updatedAt: '',
            episodeCount: 0,
            recoverableError: 'PROJECT_RECOVERY_REQUIRED',
          });
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}
