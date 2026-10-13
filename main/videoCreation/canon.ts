import { randomUUID } from 'crypto';
import type { VideoProject, CanonEvent } from '../../types/videoProject';
export interface CanonDelta {
  episodeId: string;
  scriptRevisionId: string;
  events: {
    description: string;
    characterIds: string[];
    effectiveFrom?: number;
  }[];
}
export function acceptCanonDelta(
  project: VideoProject,
  delta: CanonDelta,
  expectedVersion: number,
): VideoProject {
  if (project.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
  const next = structuredClone(project);
  const episode = next.episodes.find((e) => e.id === delta.episodeId);
  if (!episode) throw new Error('EPISODE_NOT_FOUND');
  const script = [
    ...episode.scriptRevisions,
    ...(episode.script ? [episode.script] : []),
  ].find((s) => s.revisionId === delta.scriptRevisionId);
  if (!script?.approvedAt) throw new Error('SCRIPT_NOT_APPROVED');
  for (const event of delta.events) {
    if (!event.description.trim()) throw new Error('EMPTY_CANON_EVENT');
    if (
      event.characterIds.some((id) => !next.characters.some((c) => c.id === id))
    )
      throw new Error('UNKNOWN_CHARACTER');
    const effectiveFrom = event.effectiveFrom ?? episode.order + 1;
    if (effectiveFrom <= episode.order)
      throw new Error('CANON_TIMELINE_INVALID');
    next.canon.push({
      id: randomUUID(),
      episodeId: episode.id,
      episodeOrder: episode.order,
      effectiveFrom,
      scriptRevisionId: script.revisionId,
      description: event.description,
      characterIds: event.characterIds,
      acceptedAt: new Date().toISOString(),
    });
  }
  return next;
}
export function canonForEpisode(
  project: VideoProject,
  episodeId: string,
): CanonEvent[] {
  const episode = project.episodes.find((e) => e.id === episodeId);
  if (!episode) throw new Error('EPISODE_NOT_FOUND');
  return project.canon.filter(
    (e) => e.episodeOrder < episode.order && e.effectiveFrom <= episode.order,
  );
}
