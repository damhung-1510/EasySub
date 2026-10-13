import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type {
  ProviderConfig,
  VideoRequest,
  CostApproval,
  MediaAsset,
} from '../../types/videoProvider';
import type { AttemptState, ShotSnapshot } from '../../types/videoProject';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
export interface StoredVideoJob {
  id: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  snapshot?: ShotSnapshot;
  provider: ProviderConfig;
  request: VideoRequest;
  approval: CostApproval;
  state: AttemptState;
  reservationId?: string;
  remoteJobId?: string;
  artifact?: MediaAsset;
  localCancelled?: boolean;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}
export function createJobStore(root: string) {
  const file = path.join(root, 'jobs.json');
  let tail = Promise.resolve();
  async function read(): Promise<StoredVideoJob[]> {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(raw)) throw Error('INVALID_JOB_STORE');
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  function write<T>(action: (jobs: StoredVideoJob[]) => T) {
    const operation = tail.then(async () => {
      const jobs = await read();
      const result = action(jobs);
      await fs.mkdir(root, { recursive: true });
      await atomicReplaceTextFile(file, JSON.stringify(jobs));
      return structuredClone(result);
    });
    tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  return {
    async list(projectId?: string) {
      await tail;
      return (await read()).filter(
        (j) => !projectId || j.projectId === projectId,
      );
    },
    async get(id: string) {
      await tail;
      const job = (await read()).find((j) => j.id === id);
      if (!job) throw Error('JOB_NOT_FOUND');
      return structuredClone(job);
    },
    create(job: StoredVideoJob) {
      return write((jobs) => {
        if (
          jobs.some(
            (j) =>
              j.id === job.id || j.request.requestId === job.request.requestId,
          )
        )
          throw Error('JOB_EXISTS');
        const stored = structuredClone(job);
        stored.request.references = stored.request.references.map(
          ({ dataBase64: _, ...reference }) => reference,
        );
        jobs.push(stored);
        return stored;
      });
    },
    update(id: string, mutate: (job: StoredVideoJob) => StoredVideoJob) {
      return write((jobs) => {
        const index = jobs.findIndex((j) => j.id === id);
        if (index < 0) throw Error('JOB_NOT_FOUND');
        const job = mutate(structuredClone(jobs[index]));
        if (
          job.id !== id ||
          job.request.requestId !== jobs[index].request.requestId ||
          job.provider.revisionId !== jobs[index].provider.revisionId ||
          job.request.fingerprint !== jobs[index].request.fingerprint ||
          !isDeepStrictEqual(job.request, jobs[index].request) ||
          !isDeepStrictEqual(job.provider, jobs[index].provider) ||
          !isDeepStrictEqual(job.snapshot, jobs[index].snapshot) ||
          !isDeepStrictEqual(job.approval, jobs[index].approval) ||
          job.projectId !== jobs[index].projectId ||
          job.shotId !== jobs[index].shotId ||
          job.episodeId !== jobs[index].episodeId
        )
          throw Error('IMMUTABLE_JOB_INPUT');
        jobs[index] = { ...job, updatedAt: new Date().toISOString() };
        return jobs[index];
      });
    },
  };
}
export type JobStore = ReturnType<typeof createJobStore>;
