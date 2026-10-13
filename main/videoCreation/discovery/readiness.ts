import type {
  CreativeBriefDraft,
  CreativeReadiness,
} from '../../../types/creativeDiscovery';
export function evaluateCreativeReadiness(
  brief: CreativeBriefDraft,
): CreativeReadiness {
  const blockingIssues: { field: string; message: string }[] = [];
  for (const field of [
    'premise',
    'objective',
    'audience',
    'conflict',
    'characters',
    'world',
    'language',
    'ending',
  ] as const)
    if (!brief[field].trim())
      blockingIssues.push({ field, message: `Clarify ${field}` });
  for (const issue of brief.unresolvedIssues)
    blockingIssues.push({ field: 'unresolvedIssues', message: issue });
  return {
    ready: blockingIssues.length === 0,
    blockingIssues,
    suggestions: brief.assumptions.length
      ? ['Review suggested assumptions before approval']
      : [],
  };
}
