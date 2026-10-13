import { createHash } from 'crypto';
import type { ShotSnapshot, VideoProject } from '../../types/videoProject';
import type {
  VideoCapabilities,
  VideoRequest,
  ReferenceInput,
} from '../../types/videoProvider';
import { validateShot } from './schemas';
import { stableStringify } from './revisions';
export interface CompileOptions {
  modelId: string;
  requestId?: string;
  assetBase64?: Record<string, string>;
}
export function compileVideoRequest(
  shot: ShotSnapshot,
  project: VideoProject,
  caps: VideoCapabilities,
  options: CompileOptions,
): VideoRequest {
  if (!options?.modelId) throw new Error('MODEL_REQUIRED');
  const issues = validateShot(shot, project);
  if (issues.length) throw new Error(`${issues[0].code}: ${issues[0].message}`);
  if (!caps.text) throw new Error('TEXT_INPUT_UNSUPPORTED');
  if (!caps.durationsMs.includes(shot.durationMs))
    throw new Error('UNSUPPORTED_DURATION');
  if (!caps.aspectRatios.includes(shot.aspectRatio))
    throw new Error('UNSUPPORTED_ASPECT_RATIO');
  if (!caps.resolutions.includes(shot.resolution))
    throw new Error('UNSUPPORTED_RESOLUTION');
  if (shot.audioMode === 'native' && !caps.audio)
    throw new Error('NATIVE_AUDIO_UNSUPPORTED');
  const referenceIds = [
    ...new Set(shot.characterBindings.flatMap((b) => b.referenceAssetIds)),
  ];
  if (referenceIds.length && !caps.references)
    throw new Error('REFERENCE_INPUT_UNSUPPORTED');
  if (referenceIds.length > caps.maxReferences)
    throw new Error('REFERENCE_LIMIT');
  const references: ReferenceInput[] = referenceIds.map((id) => {
    const asset = project.assets.find((a) => a.id === id)!;
    return {
      assetId: id,
      mimeType: asset.mimeType,
      relativePath: asset.relativePath,
      sha256: asset.sha256,
      role: 'reference',
      ...(options.assetBase64?.[id]
        ? { dataBase64: options.assetBase64[id] }
        : {}),
    };
  });
  const identities = shot.characterBindings.map((b) => {
    const c = project.characters.find((c) => c.id === b.characterId)!;
    const r = c.revisions.find((r) => r.revisionId === b.characterRevisionId)!;
    const v = c.variants.find((v) => v.id === b.appearanceVariantId);
    return `[${c.id}]: ${r.identity.description}${r.identity.immutableTraits?.length ? '; Keep: ' + r.identity.immutableTraits.join(', ') : ''}${v ? '; Appearance: ' + v.description : ''}`;
  });
  const location = project.locations.find(
    (l) => l.revisionId === shot.locationRevisionId,
  )!;
  const style = project.styles.find(
    (s) => s.revisionId === shot.styleRevisionId,
  )!;
  const lines = [
    shot.prompt,
    'Location: ' + location.description,
    'Style: ' + style.description,
    ...identities,
    shot.action && 'Action: ' + shot.action,
    shot.camera && 'Camera: ' + shot.camera,
    shot.lighting && 'Lighting: ' + shot.lighting,
    shot.environment && 'Environment: ' + shot.environment,
    shot.continuityIn && 'Continuity in: ' + shot.continuityIn,
    shot.continuityOut && 'Continuity out: ' + shot.continuityOut,
    shot.audioMode === 'native'
      ? 'Dialogue: ' +
        JSON.stringify(shot.dialogues || []) +
        ' Narration: ' +
        (shot.narration || '')
      : 'Generate footage for separate narration; no spoken dialogue.',
  ];
  const prompt = lines.filter(Boolean).join('\n').trim();
  const input = {
    prompt,
    modelId: options.modelId,
    durationMs: shot.durationMs,
    aspectRatio: shot.aspectRatio,
    resolution: shot.resolution,
    references,
    audioMode: shot.audioMode,
  };
  const fingerprint = createHash('sha256')
    .update(
      stableStringify({
        ...input,
        references: references.map(({ dataBase64, ...ref }) => ref),
        snapshotRevisionId: shot.revisionId,
      }),
    )
    .digest('hex');
  return {
    ...input,
    fingerprint,
    requestId: options.requestId || `${shot.id}:${shot.revisionId}`,
  };
}
