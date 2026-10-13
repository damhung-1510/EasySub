import type { VideoProject, ValidationIssue } from '../../types/videoProject';
import { validateShot } from './schemas';
export type ContinuityIssue = ValidationIssue;
export function validateContinuity(
  project: VideoProject,
  episodeId: string,
): ContinuityIssue[] {
  const episode = project.episodes.find((e) => e.id === episodeId);
  if (!episode) throw new Error('EPISODE_NOT_FOUND');
  const issues: ContinuityIssue[] = [];
  for (const scene of episode.script?.scenes || []) {
    for (const id of scene.characterIds)
      if (!project.characters.some((c) => c.id === id && c.confirmed))
        issues.push({
          code: 'UNKNOWN_CHARACTER',
          message: `Confirm character ${id}`,
          severity: 'blocking',
          sceneId: scene.id,
          action: 'Link or create the character',
        });
    for (const dialogue of scene.dialogues)
      if (
        !scene.characterIds.includes(dialogue.speakerId) ||
        !project.characters.some((c) => c.id === dialogue.speakerId)
      )
        issues.push({
          code: 'UNKNOWN_SPEAKER',
          message: `Unknown speaker ${dialogue.speakerId}`,
          severity: 'blocking',
          sceneId: scene.id,
          action: 'Confirm speaker linkage',
        });
    const words =
      scene.dialogues.reduce(
        (n, d) => n + d.text.trim().split(/\s+/).length,
        0,
      ) + scene.narration.trim().split(/\s+/).filter(Boolean).length;
    if (words > (scene.durationMs / 1000) * 3.5)
      issues.push({
        code: 'DIALOGUE_TOO_LONG',
        message: 'Dialogue or narration exceeds the estimated scene slot',
        severity: 'blocking',
        sceneId: scene.id,
        action: 'Shorten speech or extend the scene',
      });
  }
  for (const shot of episode.shots)
    issues.push(...validateShot(shot.snapshot, project));
  return issues;
}
