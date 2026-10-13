import type { AttemptState } from '../../types/videoProject';
const transitions: Record<AttemptState, AttemptState[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['submitting', 'cancelled'],
  submitting: [
    'queued',
    'running',
    'downloading',
    'failed',
    'unknown',
    'cancelled',
  ],
  queued: ['running', 'downloading', 'failed', 'cancelled'],
  running: ['downloading', 'failed', 'cancelled'],
  downloading: ['review', 'failed'],
  review: ['accepted'],
  accepted: [],
  failed: ['downloading'],
  unknown: ['queued', 'failed', 'cancelled'],
  cancelled: [],
};
export function transitionJob(from: AttemptState, to: AttemptState) {
  if (from !== to && !transitions[from]?.includes(to))
    throw Error('INVALID_JOB_TRANSITION:' + from + '->' + to);
  return to;
}
export function isActiveJob(state: AttemptState) {
  return ['submitting', 'queued', 'running', 'downloading', 'unknown'].includes(
    state,
  );
}
