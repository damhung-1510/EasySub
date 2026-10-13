import type { AudioMode, Revision } from './videoProject';
export type CreativeField =
  | 'objective'
  | 'audience'
  | 'premise'
  | 'conflict'
  | 'characters'
  | 'relationships'
  | 'world'
  | 'locations'
  | 'language'
  | 'dialogueTone'
  | 'ending'
  | 'style'
  | 'targetDurationMs'
  | 'audioMode';
export interface CreativeDecision {
  field: CreativeField;
  value: string | number;
  source: 'user' | 'import' | 'suggested';
  confirmed: boolean;
  sourceTurnId: string;
}
export interface DiscoveryQuestion {
  id: string;
  targetField: CreativeField;
  text: string;
  rationale: string;
}
export interface DiscoveryTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  questions: DiscoveryQuestion[];
  createdAt: string;
  decisions: CreativeDecision[];
  offerSummary?: boolean;
}
export interface CreativeBriefDraft extends Revision {
  objective: string;
  audience: string;
  premise: string;
  conflict: string;
  characters: string;
  relationships: string;
  world: string;
  locations: string;
  language: string;
  dialogueTone: string;
  ending: string;
  style: string;
  targetDurationMs: number;
  audioMode: AudioMode;
  assumptions: string[];
  unresolvedIssues: string[];
}
export interface ConfirmedCreativeBrief extends CreativeBriefDraft {
  approvedAt: string;
}
export interface DiscoverySession {
  id: string;
  projectId: string;
  episodeId: string;
  inputText: string;
  version: number;
  turns: DiscoveryTurn[];
  decisions: CreativeDecision[];
  currentQuestion?: DiscoveryQuestion;
  draftRevision?: CreativeBriefDraft;
  draftRevisions: CreativeBriefDraft[];
  status: 'draft' | 'clarifying' | 'review' | 'confirmed';
  usage: { requests: number; inputTokens: number; outputTokens: number };
  createdAt: string;
  updatedAt: string;
}
export interface CreativeReadiness {
  ready: boolean;
  blockingIssues: { field: string; message: string }[];
  suggestions: string[];
}
export interface DiscoveryAnswer {
  text: string;
  facts?: Partial<Record<CreativeField, string | number>>;
}
