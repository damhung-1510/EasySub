import type {
  CreativeBriefDraft,
  ConfirmedCreativeBrief,
  DiscoverySession,
} from './creativeDiscovery';
export type AudioMode = 'narration' | 'tts' | 'native';
export interface Revision {
  revisionId: string;
  createdAt: string;
  approvedAt?: string;
}
export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'blocking' | 'warning';
  sceneId?: string;
  shotId?: string;
  action?: string;
}
export interface MediaAsset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'subtitle';
  relativePath: string;
  sha256: string;
  mimeType: string;
  bytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  createdAt: string;
  approvedAt?: string;
}
export interface Dialogue {
  id: string;
  speakerId: string;
  text: string;
  emotion?: string;
}
export interface Scene {
  id: string;
  location: string;
  locationId?: string;
  time: string;
  characterIds: string[];
  action: string;
  dialogues: Dialogue[];
  narration: string;
  sound: string;
  durationMs: number;
}
export interface ScriptRevision extends Revision {
  id: string;
  scenes: Scene[];
  outline?: string[];
  originalText?: string;
  promptVersion?: string;
  assumptions?: string[];
}
export interface CharacterIdentity {
  description: string;
  age?: string;
  body?: string;
  distinguishingFeatures?: string[];
  personality?: string;
  motivation?: string;
  speakingStyle?: string;
  immutableTraits?: string[];
  relationships?: { characterId: string; description: string }[];
}
export interface CharacterRevision extends Revision {
  identity: CharacterIdentity;
  referenceAssetIds: string[];
  voice?: { providerId: string; voiceId: string; language: string };
}
export interface AppearanceVariant extends Revision {
  id: string;
  name: string;
  description: string;
  referenceAssetIds: string[];
}
export interface Character {
  id: string;
  name: string;
  aliases: string[];
  revisions: CharacterRevision[];
  currentRevisionId: string;
  variants: AppearanceVariant[];
  confirmed: boolean;
  episodeStates?: { episodeId: string; description: string }[];
}
export interface WorldEntity extends Revision {
  id: string;
  name: string;
  description: string;
}
export interface CharacterBinding {
  characterId: string;
  characterRevisionId: string;
  appearanceVariantId?: string;
  referenceAssetIds: string[];
}
export interface ShotSnapshot extends Revision {
  id: string;
  briefRevisionId: string;
  scriptRevisionId: string;
  sceneId: string;
  characterBindings: CharacterBinding[];
  locationRevisionId?: string;
  styleRevisionId?: string;
  propRevisionIds?: string[];
  prompt: string;
  durationMs: number;
  audioMode: AudioMode;
  aspectRatio: string;
  resolution: string;
  purpose?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  environment?: string;
  continuityIn?: string;
  continuityOut?: string;
  dialogues?: Dialogue[];
  narration?: string;
}
export type AttemptState =
  | 'draft'
  | 'ready'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'downloading'
  | 'review'
  | 'accepted'
  | 'failed'
  | 'unknown'
  | 'cancelled';
export interface GenerationAttempt {
  id: string;
  snapshot: ShotSnapshot;
  snapshotHash: string;
  providerId: string;
  modelId: string;
  providerConfigRevisionId: string;
  remoteJobId?: string;
  state: AttemptState;
  artifacts: MediaAsset[];
  ledgerReservationId?: string;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string };
  reviewedAt?: string;
}
export interface Shot {
  id: string;
  order: number;
  snapshot: ShotSnapshot;
  snapshots: ShotSnapshot[];
  attempts: GenerationAttempt[];
  selectedAttemptId?: string;
  stale?: boolean;
  keepOldDecision?: { attemptId: string; acceptedAt: string; reason: string };
}
export interface Episode {
  id: string;
  name: string;
  order: number;
  idea: string;
  originalScriptText?: string;
  discovery?: DiscoverySession;
  brief?: CreativeBriefDraft | ConfirmedCreativeBrief;
  script?: ScriptRevision;
  scriptRevisions: ScriptRevision[];
  shots: Shot[];
  status?: 'draft' | 'review' | 'approved' | 'production' | 'exported';
  targetDurationMs: number;
  language: string;
  audioMode: AudioMode;
  aspectRatio: string;
  style: string;
}
export interface CanonEvent {
  id: string;
  episodeId: string;
  episodeOrder: number;
  effectiveFrom: number;
  scriptRevisionId: string;
  description: string;
  characterIds: string[];
  acceptedAt: string;
}
export interface VideoProject {
  id: string;
  name: string;
  kind: 'single' | 'series';
  schemaVersion: 1;
  version: number;
  createdAt: string;
  updatedAt: string;
  episodes: Episode[];
  characters: Character[];
  assets: MediaAsset[];
  canon: CanonEvent[];
  locations: WorldEntity[];
  props: WorldEntity[];
  styles: WorldEntity[];
  discoverySessions: DiscoverySession[];
  confirmedBriefRevisions: ConfirmedCreativeBrief[];
  resumeRemoteJobs?: boolean;
}
export interface ProjectDraft {
  name: string;
  kind: 'single' | 'series';
  idea?: string;
  language?: string;
  targetDurationMs?: number;
  aspectRatio?: string;
  audioMode?: AudioMode;
  style?: string;
}
export interface ProjectSummary {
  id: string;
  name: string;
  kind: VideoProject['kind'];
  version: number;
  updatedAt: string;
  episodeCount: number;
  recoverableError?: string;
}
export interface ProjectStore {
  create(input: ProjectDraft): Promise<VideoProject>;
  load(id: string): Promise<VideoProject>;
  update(
    id: string,
    expectedVersion: number,
    mutate: (project: VideoProject) => VideoProject,
  ): Promise<VideoProject>;
  list(): Promise<ProjectSummary[]>;
}
