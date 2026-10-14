import type {
  ProviderProtocolProfile,
  JsonValue,
} from './videoProviderProfile';
import type { MediaAsset } from './videoProject';
export type { MediaAsset } from './videoProject';
export type ProviderProtocol =
  | 'veo-gemini'
  | 'seedance-ark'
  | 'custom-async-json'
  | 'gemini-image'
  | 'openai-image';
export interface Money {
  currency: string;
  minor: number;
}
export interface CostQuote {
  currency: string;
  maxMinor?: number;
  confidence: 'exact' | 'upperBound' | 'estimate' | 'unknown';
  capturedAt: string;
  components: { label: string; minor?: number }[];
}
export interface PricingOverride {
  currency: string;
  minorPerSecond?: number;
  minorPerImage?: number;
  source: string;
  capturedAt: string;
}
export interface VideoCapabilities {
  text: boolean;
  image: boolean;
  references: boolean;
  maxReferences: number;
  durationsMs: number[];
  aspectRatios: string[];
  resolutions: string[];
  audio: boolean;
  seed: boolean;
  cancel: boolean;
  concurrency: number;
  verified?: boolean;
}
export interface ImageCapabilities {
  references: boolean;
  maxReferences: number;
  verified?: boolean;
}
export interface ProviderDraft {
  id?: string;
  expectedVersion?: number;
  name: string;
  kind: 'video' | 'image';
  protocol: ProviderProtocol;
  baseUrl: string;
  modelId: string;
  modelVersion?: string;
  authMode: 'none' | 'bearer' | 'header';
  authHeader?: string;
  timeoutMs: number;
  concurrency: number;
  accountId?: string;
  allowLocalHttp?: boolean;
  allowedAssetOrigins?: string[];
  capabilities?: VideoCapabilities;
  pricing?: PricingOverride;
  profile?: ProviderProtocolProfile;
  parameters?: Record<string, JsonValue>;
}
export interface ProviderConfig extends Omit<
  ProviderDraft,
  'id' | 'expectedVersion'
> {
  id: string;
  version: number;
  revisionId: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  verifiedAt?: string;
}
export interface ProviderPublicConfig extends ProviderConfig {
  hasCredential: boolean;
  credentialPersistence: 'encrypted' | 'session' | 'none';
}
export interface ProviderConnectionResult {
  providerId: string;
  status: 'ok' | 'failed' | 'inconclusive';
  code:
    | 'READ_ONLY_CONNECTION_OK'
    | 'CREDENTIAL_REQUIRED'
    | 'NO_SAFE_READ_ONLY_CHECK'
    | 'INVALID_GEMINI_BASE_URL'
    | 'AUTH_FAILED'
    | 'ENDPOINT_NOT_FOUND'
    | 'RATE_LIMIT'
    | 'UNEXPECTED_RESPONSE'
    | 'CONNECTION_UNAVAILABLE';
}
export interface ReferenceInput {
  assetId: string;
  mimeType: string;
  dataBase64?: string;
  relativePath?: string;
  sha256?: string;
  role?: 'reference' | 'firstFrame';
}
export interface VideoRequest {
  requestId: string;
  fingerprint: string;
  prompt: string;
  modelId: string;
  durationMs: number;
  aspectRatio: string;
  resolution: string;
  references: ReferenceInput[];
  audioMode: 'native' | 'narration' | 'tts';
  seed?: number;
}
export interface ImageRequest {
  requestId: string;
  fingerprint: string;
  prompt: string;
  modelId: string;
  references: ReferenceInput[];
  aspectRatio?: string;
}
export interface RemoteJob {
  id: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  resultUrl?: string;
  actualCost?: Money;
  error?: { code: string; message: string };
  retryAfterMs?: number;
}
export interface CancelResult {
  supported: boolean;
  cancelled: boolean;
  remoteState?: string;
}
export interface ImageResult {
  bytes: Buffer;
  mimeType: string;
  actualCost?: Money;
}
export interface VideoAdapter {
  capabilities(): VideoCapabilities;
  quote(request: VideoRequest, signal: AbortSignal): Promise<CostQuote>;
  submit(request: VideoRequest, signal: AbortSignal): Promise<RemoteJob>;
  poll(remoteId: string, signal: AbortSignal): Promise<RemoteJob>;
  cancel?(remoteId: string, signal: AbortSignal): Promise<CancelResult>;
  download(
    job: RemoteJob,
    destination: string,
    signal: AbortSignal,
  ): Promise<MediaAsset>;
}
export interface ImageAdapter {
  capabilities(): ImageCapabilities;
  quote(request: ImageRequest, signal: AbortSignal): Promise<CostQuote>;
  generate(request: ImageRequest, signal: AbortSignal): Promise<ImageResult>;
}
export interface CostApproval {
  id: string;
  fingerprint: string;
  providerId: string;
  modelId: string;
  currency: string;
  capMinor: number;
  expiresAt: number;
  unknownCeilingMinor?: number;
}
export interface Reservation {
  id: string;
  projectId: string;
  approvalId: string;
  requestId: string;
  currency: string;
  reservedMinor: number;
  state: 'reserved' | 'settled' | 'released';
  actualMinor?: number;
  category?: 'llm' | 'image' | 'video' | 'audio' | 'export';
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public outcome: 'failed' | 'unknown' = 'failed',
    public retryable = false,
    public retryAfterMs?: number,
    public remoteJobId?: string,
  ) {
    super(code + ': ' + message);
    this.name = 'ProviderError';
  }
}
