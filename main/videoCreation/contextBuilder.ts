import type {
  VideoProject,
  Character,
  CanonEvent,
} from '../../types/videoProject';
export interface ScriptContext {
  episodeId: string;
  idea: string;
  originalScriptText?: string;
  brief: unknown;
  characters: Character[];
  canon: CanonEvent[];
  language: string;
  style: string;
  targetDurationMs: number;
  audioMode: string;
}
export function buildScriptContext(
  project: VideoProject,
  episodeId: string,
  maxCharacters = 60000,
): ScriptContext {
  const episode = project.episodes.find((e) => e.id === episodeId);
  if (!episode) throw new Error('EPISODE_NOT_FOUND');
  const sceneCast = new Set(
    episode.script?.scenes.flatMap((s) => s.characterIds) || [],
  );
  const mentioned = project.characters.filter(
    (c) =>
      sceneCast.has(c.id) ||
      [c.name, ...c.aliases].some(
        (n) =>
          n.length > 0 &&
          (episode.idea.includes(n) ||
            episode.originalScriptText?.includes(n) ||
            (JSON.stringify(episode.brief) || '').includes(n)),
      ),
  );
  const canon = project.canon.filter(
    (e) => e.effectiveFrom <= episode.order && e.episodeOrder < episode.order,
  );
  const context: ScriptContext = {
    episodeId,
    idea: episode.idea,
    originalScriptText: episode.originalScriptText,
    brief: episode.brief,
    characters: mentioned,
    canon,
    language: episode.language,
    style: episode.style,
    targetDurationMs: episode.targetDurationMs,
    audioMode: episode.audioMode,
  };
  if (JSON.stringify(context).length > maxCharacters)
    throw new Error(
      'CONTEXT_TOO_LARGE: split the episode or select a smaller scene scope',
    );
  return context;
}
