import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { parseVideoProject } from './schemas';
import { atomicReplaceTextFile } from '../helpers/atomicFile';
import type { VideoProject } from '../../types/videoProject';
function assetPath(root: string, relative: string) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.split('/').some((v) => v === '..')
  )
    throw new Error('UNSAFE_ASSET_PATH');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error('UNSAFE_ASSET_PATH');
  return target;
}
async function verifiedAsset(
  base: string,
  asset: VideoProject['assets'][number],
) {
  const file = assetPath(base, asset.relativePath);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('INVALID_ASSET');
  const real = await fs.realpath(file);
  if (!real.startsWith((await fs.realpath(base)) + path.sep))
    throw new Error('UNSAFE_ASSET_PATH');
  const data = await fs.readFile(file);
  if (
    data.length !== asset.bytes ||
    createHash('sha256').update(data).digest('hex') !== asset.sha256
  )
    throw new Error('ASSET_HASH_MISMATCH');
  return data;
}
export async function exportProjectBackup(input: {
  project: VideoProject;
  root: string;
  destination: string;
  signal?: AbortSignal;
}) {
  const project = parseVideoProject(input.project);
  // Parse and rebuild the manifest to strip unknown fields, credentials, and remote URLs.
  const base = path.join(input.root, project.id);
  await fs.mkdir(input.destination, { recursive: true });
  if ((await fs.readdir(input.destination)).length)
    throw new Error('BACKUP_DIRECTORY_NOT_EMPTY');
  try {
    for (const asset of project.assets) {
      input.signal?.throwIfAborted();
      const data = await verifiedAsset(base, asset);
      const out = assetPath(input.destination, asset.relativePath);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, data, { flag: 'wx' });
    }
    const copy = structuredClone(project);
    copy.resumeRemoteJobs = false;
    for (const episode of copy.episodes)
      for (const shot of episode.shots)
        for (const attempt of shot.attempts) {
          delete attempt.remoteJobId;
          delete attempt.ledgerReservationId;
        }
    await atomicReplaceTextFile(
      path.join(input.destination, 'project.json'),
      JSON.stringify(copy, null, 2),
    );
    return input.destination;
  } catch (error) {
    await fs.rm(input.destination, { recursive: true, force: true });
    throw error;
  }
}
export async function importProjectBackup(input: {
  source: string;
  root: string;
  signal?: AbortSignal;
}): Promise<VideoProject> {
  const raw = await fs.readFile(
    path.join(input.source, 'project.json'),
    'utf8',
  );
  if (raw.length > 20 * 1024 * 1024) throw new Error('MANIFEST_TOO_LARGE');
  const project = parseVideoProject(JSON.parse(raw));
  const newId = randomUUID();
  await fs.mkdir(input.root, { recursive: true });
  const staged = await fs.mkdtemp(path.join(input.root, '.restore-'));
  try {
    for (const asset of project.assets) {
      input.signal?.throwIfAborted();
      const data = await verifiedAsset(input.source, asset);
      const target = assetPath(staged, asset.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    }
    project.id = newId;
    project.version = 1;
    project.resumeRemoteJobs = false;
    project.createdAt = new Date().toISOString();
    project.updatedAt = project.createdAt;
    for (const session of project.discoverySessions) session.projectId = newId;
    for (const ep of project.episodes) {
      if (ep.discovery) ep.discovery.projectId = newId;
      for (const shot of ep.shots)
        for (const a of shot.attempts) {
          delete a.remoteJobId;
          delete a.ledgerReservationId;
          if (
            ['running', 'submitting', 'queued', 'downloading'].includes(a.state)
          )
            a.state = 'unknown';
        }
    }
    await atomicReplaceTextFile(
      path.join(staged, 'project.json'),
      JSON.stringify(project, null, 2),
    );
    await fs.rename(staged, path.join(input.root, newId));
    return project;
  } finally {
    await fs.rm(staged, { recursive: true, force: true });
  }
}
export function collectUnreferencedAssets(project: VideoProject) {
  const referenced = new Set<string>();
  for (const c of project.characters) {
    for (const r of c.revisions)
      r.referenceAssetIds.forEach((id) => referenced.add(id));
    for (const v of c.variants)
      v.referenceAssetIds.forEach((id) => referenced.add(id));
  }
  for (const ep of project.episodes)
    for (const shot of ep.shots) {
      for (const snap of [shot.snapshot, ...shot.snapshots])
        for (const binding of snap.characterBindings)
          binding.referenceAssetIds.forEach((id) => referenced.add(id));
      for (const a of shot.attempts) {
        a.artifacts.forEach((v) => referenced.add(v.id));
        for (const b of a.snapshot.characterBindings)
          b.referenceAssetIds.forEach((id) => referenced.add(id));
      }
    }
  return project.assets.filter((a) => !referenced.has(a.id)).map((a) => a.id);
}
