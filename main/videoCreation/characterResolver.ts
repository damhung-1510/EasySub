import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { VideoProject, ScriptRevision } from '../../types/videoProject';
import {
  requestStructured,
  type StructuredLlm,
  type LlmBoundary,
} from './llmAdapter';
export interface CharacterCandidate {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  sourceSceneIds: string[];
  inferred: boolean;
}
export interface EntityCandidates {
  characters: CharacterCandidate[];
  locations: {
    name: string;
    description: string;
    sourceSceneIds: string[];
    inferred: boolean;
  }[];
  props: {
    name: string;
    description: string;
    sourceSceneIds: string[];
    inferred: boolean;
  }[];
}
export interface LinkProposal {
  candidateId: string;
  characterIds: string[];
  needsConfirmation: true;
}
export interface LinkDecision {
  candidateId: string;
  action: 'new' | 'link' | 'ignore';
  characterId?: string;
  name?: string;
  description?: string;
}
export function proposeCharacterLinks(
  candidates: CharacterCandidate[],
  project: VideoProject,
): LinkProposal[] {
  return candidates.map((c) => ({
    candidateId: c.id,
    characterIds: project.characters
      .filter((existing) =>
        [existing.name, ...existing.aliases].some((name) =>
          [c.name, ...c.aliases].some(
            (alias) =>
              alias.trim().toLocaleLowerCase() ===
              name.trim().toLocaleLowerCase(),
          ),
        ),
      )
      .map((c) => c.id),
    needsConfirmation: true,
  }));
}
export function applyCharacterLinks(
  project: VideoProject,
  decisions: LinkDecision[],
): VideoProject {
  const next = structuredClone(project);
  const mapping = new Map<string, string>();
  for (const d of decisions) {
    if (d.action === 'ignore') continue;
    let character = next.characters.find((c) => c.id === d.characterId);
    if (d.action === 'link') {
      if (!character) throw new Error('UNKNOWN_CHARACTER');
      if (d.name && d.name !== character.name) {
        character.aliases = [
          ...new Set([...character.aliases, character.name]),
        ];
        character.name = d.name;
      }
      character.confirmed = true;
    } else {
      const revisionId = randomUUID();
      character = {
        id: randomUUID(),
        name: d.name || 'Unnamed character',
        aliases: [],
        revisions: [
          {
            revisionId,
            createdAt: new Date().toISOString(),
            identity: { description: d.description || '' },
            referenceAssetIds: [],
          },
        ],
        currentRevisionId: revisionId,
        variants: [],
        confirmed: true,
      };
      next.characters.push(character);
    }
    mapping.set(d.candidateId, character.id);
  }
  // Approved scripts remain immutable. Draft scenes and speakers receive confirmed IDs.
  for (const episode of next.episodes) {
    if (episode.script && !episode.script.approvedAt) {
      for (const scene of episode.script.scenes) {
        scene.characterIds = scene.characterIds.map(
          (id) => mapping.get(id) || id,
        );
        for (const d of scene.dialogues)
          d.speakerId = mapping.get(d.speakerId) || d.speakerId;
      }
    }
  }
  return next;
}
export async function extractEntities(
  script: ScriptRevision,
  deps: { llm: StructuredLlm; boundary?: LlmBoundary },
  signal: AbortSignal,
): Promise<EntityCandidates> {
  const base = z.object({
    name: z.string(),
    description: z.string(),
    sourceSceneIds: z.array(z.string()),
    inferred: z.boolean(),
  });
  const schema = z.object({
    characters: z.array(
      base.extend({ id: z.string(), aliases: z.array(z.string()) }),
    ),
    locations: z.array(base),
    props: z.array(base),
  });
  const { value } = await requestStructured(
    deps.llm,
    'Extract characters, locations and props from story data. Mark any inferred attribute. Never invent confirmed facts. Use existing speaker candidate IDs. Return only schema JSON.',
    script,
    schema,
    signal,
    deps.boundary,
  );
  for (const item of [...value.characters, ...value.locations, ...value.props])
    if (
      item.sourceSceneIds.some((id) => !script.scenes.some((s) => s.id === id))
    )
      throw new Error('UNKNOWN_SOURCE_SCENE');
  return value as EntityCandidates;
}
