import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CostApproval,
  ImageAdapter,
  MediaAsset,
  ImageRequest,
} from '../../types/videoProvider';
import type { VideoProject } from '../../types/videoProject';
import type { AssetStore } from './assetStore';
import type { BudgetLedger } from './budgetLedger';
export interface CharacterImageInput {
  projectId: string;
  characterId: string;
  characterRevisionId: string;
  view: 'portrait' | 'full-body' | 'profile' | 'variant';
  prompt: string;
  requestId: string;
  providerId: string;
  modelId: string;
  fingerprint: string;
  portrait?: MediaAsset;
  approval: CostApproval;
}
export interface ImageWorkflowDeps {
  adapter: ImageAdapter;
  assets: AssetStore;
  ledger: BudgetLedger;
  tempRoot: string;
}
export interface ReferenceCandidate {
  id: string;
  projectId: string;
  characterId: string;
  characterRevisionId: string;
  view: CharacterImageInput['view'];
  asset: MediaAsset;
  requestId: string;
  reservationId: string;
}
export async function generateCharacterReference(
  input: CharacterImageInput,
  deps: ImageWorkflowDeps,
  signal: AbortSignal,
): Promise<ReferenceCandidate> {
  signal.throwIfAborted();
  const references = [];
  if (input.view !== 'portrait') {
    if (!input.portrait?.approvedAt) throw Error('APPROVED_PORTRAIT_REQUIRED');
    if (!deps.adapter.capabilities().references)
      throw Error('REFERENCE_CAPABILITY_REQUIRED');
    references.push(
      await deps.assets.readReference(input.projectId, input.portrait, signal),
    );
  }
  const request: ImageRequest = {
    requestId: input.requestId,
    fingerprint: input.fingerprint,
    prompt: input.prompt,
    modelId: input.modelId,
    references,
  };
  const quote = await deps.adapter.quote(request, signal);
  const reservation = await deps.ledger.reserve(
    input.projectId,
    input.approval,
    quote,
    input.requestId,
    {
      fingerprint: input.fingerprint,
      providerId: input.providerId,
      modelId: input.modelId,
    },
    'image',
  );
  let result;
  try {
    result = await deps.adapter.generate(request, signal);
  } catch (error) {
    if ((error as { outcome?: string }).outcome === 'failed')
      await deps.ledger.release(reservation.id, 'not-submitted');
    throw error;
  }
  await deps.ledger.settle(reservation.id, result.actualCost);
  await fs.mkdir(deps.tempRoot, { recursive: true });
  const file = path.join(deps.tempRoot, '.image-' + randomUUID() + '.partial');
  try {
    await fs.writeFile(file, result.bytes, { signal, flag: 'wx' });
    const asset = await deps.assets.importReference(
      input.projectId,
      file,
      signal,
    );
    return {
      id: randomUUID(),
      projectId: input.projectId,
      characterId: input.characterId,
      characterRevisionId: input.characterRevisionId,
      view: input.view,
      asset,
      requestId: input.requestId,
      reservationId: reservation.id,
    };
  } finally {
    await fs.rm(file, { force: true });
  }
}
export function approveReference(
  project: VideoProject,
  candidate: ReferenceCandidate,
): VideoProject {
  if (candidate.projectId !== project.id) throw Error('PROJECT_MISMATCH');
  const next = structuredClone(project);
  const character = next.characters.find((c) => c.id === candidate.characterId);
  if (!character) throw Error('UNKNOWN_CHARACTER');
  const before = character.revisions.find(
    (r) => r.revisionId === candidate.characterRevisionId,
  );
  if (!before) throw Error('CHARACTER_REVISION_NOT_FOUND');
  const now = new Date().toISOString();
  const asset = { ...candidate.asset, approvedAt: now };
  const existing = next.assets.find((a) => a.id === asset.id);
  if (existing) existing.approvedAt = now;
  else next.assets.push(asset);
  const revision = {
    ...structuredClone(before),
    revisionId: randomUUID(),
    createdAt: now,
    approvedAt: now,
    referenceAssetIds: [...new Set([...before.referenceAssetIds, asset.id])],
  };
  character.revisions.push(revision);
  character.currentRevisionId = revision.revisionId;
  for (const episode of next.episodes)
    for (const shot of episode.shots)
      if (
        shot.snapshot.characterBindings.some(
          (binding) => binding.characterId === character.id,
        )
      )
        shot.stale = true;
  return next;
}
