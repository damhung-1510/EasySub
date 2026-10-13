import { randomUUID } from 'crypto';
import type { VideoProject } from '../../types/videoProject';
export function newRevision<T extends object>(
  value: T,
): T & { revisionId: string; createdAt: string } {
  return {
    ...structuredClone(value),
    revisionId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}
export function approveRevision<T extends { approvedAt?: string }>(
  value: T,
): T {
  return {
    ...structuredClone(value),
    approvedAt: value.approvedAt ?? new Date().toISOString(),
  };
}
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function approved(
  value: unknown,
  out = new Map<string, string>(),
): Map<string, string> {
  if (!value || typeof value !== 'object') return out;
  const o = value as Record<string, unknown>;
  if ((o.approvedAt || o.acceptedAt) && (o.revisionId || o.id)) {
    const key = String(o.revisionId || o.id);
    const str = stableStringify(o);
    if (out.has(key) && out.get(key) !== str)
      throw new Error('APPROVED_REVISION_IMMUTABLE');
    out.set(key, str);
  }
  for (const v of Object.values(o)) approved(v, out);
  return out;
}
export function assertApprovedRevisionsUnchanged(
  before: VideoProject,
  after: VideoProject,
): void {
  const old = approved(before),
    next = approved(after);
  for (const [key, value] of old)
    if (next.get(key) !== value) throw new Error('APPROVED_REVISION_IMMUTABLE');
  for (const episode of before.episodes) {
    const current = after.episodes.find((e) => e.id === episode.id);
    if (
      episode.originalScriptText &&
      current?.originalScriptText !== episode.originalScriptText
    )
      throw new Error('ORIGINAL_SCRIPT_IMMUTABLE');
  }
}
