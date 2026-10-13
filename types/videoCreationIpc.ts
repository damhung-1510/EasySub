import type { VideoProject, ProjectSummary, MediaAsset } from './videoProject';
import type { ProviderPublicConfig, CostQuote } from './videoProvider';
export type VideoCommand =
  | 'list'
  | 'create'
  | 'load'
  | 'update'
  | 'addEpisode'
  | 'delete'
  | 'importText'
  | 'startDiscovery'
  | 'answerDiscovery'
  | 'suggestRemaining'
  | 'confirmBrief'
  | 'runScript'
  | 'extractEntities'
  | 'linkEntities'
  | 'generateReference'
  | 'importReference'
  | 'approveReference'
  | 'buildStoryboard'
  | 'refreshShotBindings'
  | 'approveShots'
  | 'quote'
  | 'approveCost'
  | 'startBatch'
  | 'pollStatus'
  | 'cancel'
  | 'reconcile'
  | 'selectTake'
  | 'export'
  | 'backup'
  | 'importBackup'
  | 'assetPreview'
  | 'listProviders'
  | 'saveProvider'
  | 'deleteProvider'
  | 'testProvider'
  | 'listLlmProviders'
  | 'creativeUsage'
  | 'cancelOperation';
export interface VideoCommandRequest {
  command: VideoCommand;
  payload?: Record<string, unknown>;
}
export interface VideoChangedEvent {
  projectId?: string;
  version?: number;
  attemptId?: string;
  operation?: string;
}
export interface BatchQuote extends CostQuote {
  quoteId: string;
  fingerprint: string;
  providerId: string;
  modelId: string;
  shotCount: number;
}
export interface VideoCommandInput extends Record<
  VideoCommand,
  Record<string, unknown>
> {}
export interface VideoCommandOutput {
  list: ProjectSummary[];
  create: VideoProject;
  load: VideoProject;
  update: VideoProject;
  addEpisode: VideoProject;
  listProviders: ProviderPublicConfig[];
  quote: BatchQuote;
  approveCost: { approvalId: string };
  [command: string]: unknown;
}
export interface LlmProviderOption {
  id: string;
  name: string;
  modelId: string;
}
export interface AssetPreview {
  url: string;
  asset: MediaAsset;
}
