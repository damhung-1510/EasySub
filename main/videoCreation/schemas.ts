import { z } from 'zod';
import type {
  VideoProject,
  ShotSnapshot,
  ValidationIssue,
} from '../../types/videoProject';
const id = z.string().min(1).max(200);
const revision = {
  revisionId: id,
  createdAt: z.string(),
  approvedAt: z.string().optional(),
};
const dialogue = z.object({
  id,
  speakerId: id,
  text: z.string(),
  emotion: z.string().optional(),
});
export const sceneSchema = z.object({
  id,
  location: z.string(),
  locationId: id.optional(),
  time: z.string(),
  characterIds: z.array(id),
  action: z.string(),
  dialogues: z.array(dialogue),
  narration: z.string(),
  sound: z.string(),
  durationMs: z.number().int().positive(),
});
export const scriptSchema = z.object({
  ...revision,
  id,
  scenes: z.array(sceneSchema),
  outline: z.array(z.string()).optional(),
  originalText: z.string().optional(),
  promptVersion: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
});
export const creativeBriefSchema = z.object({
  ...revision,
  objective: z.string(),
  audience: z.string(),
  premise: z.string(),
  conflict: z.string(),
  characters: z.string(),
  relationships: z.string(),
  world: z.string(),
  locations: z.string(),
  language: z.string(),
  dialogueTone: z.string(),
  ending: z.string(),
  style: z.string(),
  targetDurationMs: z.number().int().positive(),
  audioMode: z.enum(['native', 'tts', 'narration']),
  assumptions: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
});
const creativeFieldSchema = z.enum([
  'objective',
  'audience',
  'premise',
  'conflict',
  'characters',
  'relationships',
  'world',
  'locations',
  'language',
  'dialogueTone',
  'ending',
  'style',
  'targetDurationMs',
  'audioMode',
]);
const decisionSchema = z
  .object({
    field: creativeFieldSchema,
    value: z.union([z.string(), z.number()]),
    source: z.enum(['user', 'import', 'suggested']),
    confirmed: z.boolean(),
    sourceTurnId: id,
  })
  .strict();
const questionSchema = z
  .object({
    id,
    targetField: creativeFieldSchema,
    text: z.string().max(2000),
    rationale: z.string().max(1000),
  })
  .strict();
export const discoverySessionSchema = z
  .object({
    id,
    projectId: id,
    episodeId: id,
    inputText: z.string().max(1024 * 1024),
    version: z.number().int().positive(),
    turns: z.array(
      z
        .object({
          id,
          role: z.enum(['user', 'assistant']),
          text: z.string().max(1024 * 1024),
          questions: z.array(questionSchema).max(1),
          createdAt: z.string(),
          decisions: z.array(decisionSchema),
          offerSummary: z.boolean().optional(),
        })
        .strict(),
    ),
    decisions: z.array(decisionSchema),
    currentQuestion: questionSchema.optional(),
    draftRevision: creativeBriefSchema.optional(),
    draftRevisions: z.array(creativeBriefSchema),
    status: z.enum(['draft', 'clarifying', 'review', 'confirmed']),
    usage: z.object({
      requests: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const assetSchema = z.object({
  id,
  kind: z.enum(['image', 'video', 'audio', 'subtitle']),
  relativePath: z
    .string()
    .refine(
      (p) =>
        !p.startsWith('/') &&
        !p.includes('\\') &&
        !p.split('/').includes('..') &&
        !p.includes(':') &&
        p.length > 0,
      'UNSAFE_ASSET_PATH',
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  approvedAt: z.string().optional(),
  durationMs: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
export const shotSnapshotSchema = z.object({
  ...revision,
  id,
  briefRevisionId: id,
  scriptRevisionId: id,
  sceneId: id,
  characterBindings: z.array(
    z.object({
      characterId: id,
      characterRevisionId: id,
      appearanceVariantId: id.optional(),
      referenceAssetIds: z.array(id),
    }),
  ),
  locationRevisionId: id.optional(),
  styleRevisionId: id.optional(),
  propRevisionIds: z.array(id).optional(),
  prompt: z.string(),
  durationMs: z.number().int().positive(),
  audioMode: z.enum(['native', 'tts', 'narration']),
  aspectRatio: z.string(),
  resolution: z.string(),
  purpose: z.string().optional(),
  action: z.string().optional(),
  camera: z.string().optional(),
  lighting: z.string().optional(),
  environment: z.string().optional(),
  continuityIn: z.string().optional(),
  continuityOut: z.string().optional(),
  dialogues: z.array(dialogue).optional(),
  narration: z.string().optional(),
});
const identity = z.object({
  description: z.string(),
  age: z.string().optional(),
  body: z.string().optional(),
  distinguishingFeatures: z.array(z.string()).optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  speakingStyle: z.string().optional(),
  immutableTraits: z.array(z.string()).optional(),
  relationships: z
    .array(z.object({ characterId: id, description: z.string() }))
    .optional(),
});
const characterSchema = z.object({
  id,
  name: z.string(),
  aliases: z.array(z.string()),
  revisions: z.array(
    z.object({
      ...revision,
      identity,
      referenceAssetIds: z.array(id),
      voice: z
        .object({ providerId: id, voiceId: id, language: z.string() })
        .optional(),
    }),
  ),
  currentRevisionId: id,
  variants: z.array(
    z.object({
      ...revision,
      id,
      name: z.string(),
      description: z.string(),
      referenceAssetIds: z.array(id),
    }),
  ),
  confirmed: z.boolean(),
  episodeStates: z
    .array(z.object({ episodeId: id, description: z.string() }))
    .optional(),
});
const world = z.object({
  ...revision,
  id,
  name: z.string(),
  description: z.string(),
});
const projectSchema = z
  .object({
    id,
    name: z.string().min(1),
    kind: z.enum(['single', 'series']),
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    episodes: z.array(
      z.object({
        id,
        name: z.string(),
        order: z.number().int().positive(),
        idea: z.string(),
        originalScriptText: z.string().optional(),
        discovery: discoverySessionSchema.optional(),
        brief: creativeBriefSchema.optional(),
        script: scriptSchema.optional(),
        scriptRevisions: z.array(scriptSchema),
        shots: z.array(
          z.object({
            id,
            order: z.number().int().nonnegative(),
            snapshot: shotSnapshotSchema,
            snapshots: z.array(shotSnapshotSchema),
            attempts: z.array(
              z.object({
                id,
                snapshot: shotSnapshotSchema,
                snapshotHash: z.string(),
                providerId: id,
                modelId: id,
                providerConfigRevisionId: id,
                remoteJobId: id.optional(),
                state: z.enum([
                  'draft',
                  'ready',
                  'submitting',
                  'queued',
                  'running',
                  'downloading',
                  'review',
                  'accepted',
                  'failed',
                  'unknown',
                  'cancelled',
                ]),
                artifacts: z.array(assetSchema),
                ledgerReservationId: id.optional(),
                createdAt: z.string(),
                updatedAt: z.string(),
                error: z
                  .object({ code: z.string(), message: z.string() })
                  .optional(),
                reviewedAt: z.string().optional(),
              }),
            ),
            selectedAttemptId: id.optional(),
            stale: z.boolean().optional(),
            keepOldDecision: z
              .object({
                attemptId: id,
                acceptedAt: z.string(),
                reason: z.string(),
              })
              .optional(),
          }),
        ),
        status: z
          .enum(['draft', 'review', 'approved', 'production', 'exported'])
          .optional(),
        targetDurationMs: z.number().positive(),
        language: z.string(),
        audioMode: z.enum(['native', 'tts', 'narration']),
        aspectRatio: z.string(),
        style: z.string(),
      }),
    ),
    characters: z.array(characterSchema),
    assets: z.array(assetSchema),
    canon: z.array(
      z.object({
        id,
        episodeId: id,
        episodeOrder: z.number(),
        effectiveFrom: z.number(),
        scriptRevisionId: id,
        description: z.string(),
        characterIds: z.array(id),
        acceptedAt: z.string(),
      }),
    ),
    locations: z.array(world),
    props: z.array(world),
    styles: z.array(world),
    discoverySessions: z.array(discoverySessionSchema),
    confirmedBriefRevisions: z.array(
      creativeBriefSchema.extend({ approvedAt: z.string() }),
    ),
    resumeRemoteJobs: z.boolean().optional(),
  })
  .strict();
export function parseVideoProject(raw: unknown): VideoProject {
  if (!raw || (raw as { schemaVersion?: number }).schemaVersion !== 1)
    throw new Error('UNSUPPORTED_SCHEMA');
  const value = projectSchema.parse(raw) as VideoProject;
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_ID');
  };
  unique(value.episodes.map((e) => e.id));
  unique(value.characters.map((c) => c.id));
  unique(value.assets.map((a) => a.id));
  for (const c of value.characters)
    if (!c.revisions.some((r) => r.revisionId === c.currentRevisionId))
      throw new Error('UNKNOWN_CHARACTER_REVISION');
  for (const e of value.episodes) {
    unique(e.shots.map((s) => s.id));
    if (e.script) {
      unique(e.script.scenes.map((s) => s.id));
      unique(e.script.scenes.flatMap((s) => s.dialogues.map((d) => d.id)));
    }
    for (const shot of e.shots) {
      unique(shot.attempts.map((a) => a.id));
      if (
        shot.selectedAttemptId &&
        !shot.attempts.some((a) => a.id === shot.selectedAttemptId)
      )
        throw new Error('UNKNOWN_ATTEMPT');
    }
    if (
      e.discovery &&
      (e.discovery.projectId !== value.id || e.discovery.episodeId !== e.id)
    )
      throw new Error('UNKNOWN_DISCOVERY_EPISODE');
    if (
      e.originalScriptText &&
      e.script?.originalText &&
      e.originalScriptText !== e.script.originalText
    )
      throw new Error('ORIGINAL_SCRIPT_CHANGED');
  }
  unique(value.canon.map((event) => event.id));
  for (const event of value.canon) {
    const episode = value.episodes.find((e) => e.id === event.episodeId);
    const source =
      episode &&
      [
        ...episode.scriptRevisions,
        ...(episode.script ? [episode.script] : []),
      ].find((s) => s.revisionId === event.scriptRevisionId);
    if (!source?.approvedAt) throw new Error('CANON_SOURCE_NOT_APPROVED');
    if (
      event.episodeOrder !== episode!.order ||
      event.effectiveFrom <= event.episodeOrder
    )
      throw new Error('CANON_TIMELINE_INVALID');
    if (
      event.characterIds.some(
        (id) => !value.characters.some((c) => c.id === id),
      )
    )
      throw new Error('UNKNOWN_CANON_CHARACTER');
  }
  for (const session of value.discoverySessions)
    if (
      session.projectId !== value.id ||
      !value.episodes.some((e) => e.id === session.episodeId)
    )
      throw new Error('UNKNOWN_DISCOVERY_EPISODE');
  return value;
}
export function validateShot(
  shot: ShotSnapshot,
  project: VideoProject,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({
      code,
      message,
      severity: 'blocking',
      sceneId: shot.sceneId,
      shotId: shot.id,
    });
  const script = project.episodes
    .flatMap((e) => [
      ...(e.scriptRevisions || []),
      ...(e.script ? [e.script] : []),
    ])
    .find((s) => s.revisionId === shot.scriptRevisionId);
  for (const b of shot.characterBindings) {
    const c = project.characters.find((c) => c.id === b.characterId);
    if (!c) {
      add('UNKNOWN_CHARACTER', b.characterId);
      continue;
    }
    const rev = c.revisions.find((r) => r.revisionId === b.characterRevisionId);
    if (!rev?.approvedAt || !c.confirmed) add('CHARACTER_NOT_APPROVED', c.name);
    if (
      b.appearanceVariantId &&
      !c.variants.some((v) => v.id === b.appearanceVariantId && v.approvedAt)
    )
      add('UNKNOWN_APPEARANCE_VARIANT', b.appearanceVariantId);
    if (!b.referenceAssetIds.length) add('REFERENCE_REQUIRED', c.name);
    const permittedRefs = new Set([
      ...(rev?.referenceAssetIds || []),
      ...(c.variants.find((v) => v.id === b.appearanceVariantId)
        ?.referenceAssetIds || []),
    ]);
    for (const ref of b.referenceAssetIds)
      if (!permittedRefs.has(ref)) add('REFERENCE_BINDING_MISMATCH', ref);
    for (const ref of b.referenceAssetIds)
      if (
        !project.assets.some(
          (a) => a.id === ref && a.kind === 'image' && a.approvedAt,
        )
      )
        add('REFERENCE_NOT_APPROVED', ref);
  }
  if (!script?.approvedAt)
    add('SCRIPT_NOT_APPROVED', 'Approve the pinned script');
  if (!script?.scenes.some((s) => s.id === shot.sceneId))
    add('UNKNOWN_SCENE', shot.sceneId);
  if (
    !project.confirmedBriefRevisions.some(
      (b) => b.revisionId === shot.briefRevisionId,
    )
  )
    add('BRIEF_NOT_APPROVED', shot.briefRevisionId);
  for (const d of shot.dialogues || [])
    if (!shot.characterBindings.some((b) => b.characterId === d.speakerId))
      add('UNKNOWN_SPEAKER', d.speakerId);
  if (
    shot.locationRevisionId &&
    !project.locations.some(
      (l) => l.revisionId === shot.locationRevisionId && l.approvedAt,
    )
  )
    add('UNKNOWN_LOCATION', shot.locationRevisionId);
  if (!shot.locationRevisionId)
    add('LOCATION_REVISION_REQUIRED', 'Pin the approved scene location');
  if (!shot.styleRevisionId)
    add('STYLE_REVISION_REQUIRED', 'Pin the approved style');
  if (
    shot.styleRevisionId &&
    !project.styles.some(
      (style) => style.revisionId === shot.styleRevisionId && style.approvedAt,
    )
  )
    add('UNKNOWN_STYLE', shot.styleRevisionId);
  const scene = script?.scenes.find((s) => s.id === shot.sceneId);
  if (
    shot.locationRevisionId &&
    scene?.locationId &&
    !project.locations.some(
      (l) =>
        l.id === scene.locationId && l.revisionId === shot.locationRevisionId,
    )
  )
    add('LOCATION_BINDING_MISMATCH', shot.locationRevisionId);
  return issues;
}
