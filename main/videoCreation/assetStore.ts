import fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { MediaAsset, ReferenceInput } from '../../types/videoProvider';
import { validateMedia } from './mediaProbe';
export function createAssetStore(root: string) {
  function projectRoot(projectId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw Error('INVALID_PROJECT_ID');
    return path.resolve(root, projectId);
  }
  function resolve(projectId: string, relativePath: string) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.split('/').includes('..') ||
      !relativePath.startsWith('assets/')
    )
      throw Error('ASSET_PATH_ESCAPE');
    const base = projectRoot(projectId);
    const file = path.resolve(base, relativePath);
    if (!file.startsWith(base + path.sep)) throw Error('ASSET_PATH_ESCAPE');
    let candidate = base;
    for (const segment of ['', ...path.relative(base, file).split(path.sep)]) {
      if (segment) candidate = path.join(candidate, segment);
      try {
        if (lstatSync(candidate).isSymbolicLink())
          throw Error('ASSET_PATH_ESCAPE');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return file;
  }
  async function safeDirectory(projectId: string) {
    resolve(projectId, 'assets/.safety');
    const directory = path.join(projectRoot(projectId), 'assets');
    await fs.mkdir(directory, { recursive: true });
    const actualRoot = await fs.realpath(root);
    const actual = await fs.realpath(directory);
    if (actual !== path.join(actualRoot, projectId, 'assets'))
      throw Error('ASSET_PATH_ESCAPE');
    return directory;
  }
  async function importMedia(
    projectId: string,
    source: string,
    kind: 'image' | 'video',
    signal: AbortSignal,
  ): Promise<MediaAsset> {
    const info = await validateMedia(source, kind, signal);
    const bytes = await fs.readFile(source, { signal });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
    }[info.mimeType];
    const relativePath = 'assets/' + sha256 + extension;
    const directory = await safeDirectory(projectId);
    const destination = resolve(projectId, relativePath);
    const temp = path.join(directory, '.' + randomUUID() + '.partial');
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx', signal });
      signal.throwIfAborted();
      const existing = await fs.lstat(destination).catch(() => null);
      if (existing?.isSymbolicLink()) throw Error('ASSET_PATH_ESCAPE');
      await fs.rename(temp, destination);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
    return {
      id: sha256,
      kind,
      relativePath,
      sha256,
      mimeType: info.mimeType,
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
      width: info.width,
      height: info.height,
      ...(kind === 'video' ? { durationMs: info.durationMs } : {}),
    };
  }
  return {
    resolve,
    importMedia,
    importReference: (projectId: string, source: string, signal: AbortSignal) =>
      importMedia(projectId, source, 'image', signal),
    async readReference(
      projectId: string,
      asset: MediaAsset,
      signal: AbortSignal,
    ): Promise<ReferenceInput> {
      const file = resolve(projectId, asset.relativePath);
      const actual = await fs.realpath(file);
      const expectedRoot = await fs.realpath(projectRoot(projectId));
      if (!actual.startsWith(expectedRoot + path.sep))
        throw Error('ASSET_PATH_ESCAPE');
      const bytes = await fs.readFile(file, { signal });
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
        throw Error('ASSET_HASH_MISMATCH');
      return {
        assetId: asset.id,
        mimeType: asset.mimeType,
        dataBase64: bytes.toString('base64'),
        relativePath: asset.relativePath,
        sha256: asset.sha256,
      };
    },
  };
}
export type AssetStore = ReturnType<typeof createAssetStore>;
