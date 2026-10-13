import { randomUUID, createHash } from 'crypto';
import type { VideoProject, ShotSnapshot } from '../../types/videoProject';
import { stableStringify } from './revisions';
export interface RevisionRef {
  kind:
    'script' | 'brief' | 'character' | 'location' | 'style' | 'prop' | 'asset';
  id: string;
  revisionId: string;
}
export function snapshotHash(snapshot: ShotSnapshot): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}
export function affectedShots(
  project: VideoProject,
  changed: RevisionRef[],
): string[] {
  return project.episodes
    .flatMap((e) => e.shots)
    .filter((s) =>
      changed.some((ref) => {
        const snap = s.snapshot;
        switch (ref.kind) {
          case 'script':
            return snap.scriptRevisionId === ref.revisionId;
          case 'brief':
            return snap.briefRevisionId === ref.revisionId;
          case 'character':
            return snap.characterBindings.some(
              (b) =>
                b.characterId === ref.id &&
                b.characterRevisionId === ref.revisionId,
            );
          case 'location':
            return snap.locationRevisionId === ref.revisionId;
          case 'style':
            return snap.styleRevisionId === ref.revisionId;
          case 'prop':
            return snap.propRevisionIds?.includes(ref.revisionId);
          case 'asset':
            return snap.characterBindings.some((b) =>
              b.referenceAssetIds.includes(ref.id),
            );
        }
      }),
    )
    .map((s) => s.id);
}
export function migrateShots(
  project: VideoProject,
  shotIds: string[],
  mutate: (snapshot: ShotSnapshot) => ShotSnapshot,
): VideoProject {
  const next = structuredClone(project);
  for (const id of shotIds) {
    const shot = next.episodes.flatMap((e) => e.shots).find((s) => s.id === id);
    if (!shot) throw new Error('SHOT_NOT_FOUND');
    const original = structuredClone(shot.snapshot);
    if (!shot.snapshots.some((s) => s.revisionId === original.revisionId))
      shot.snapshots.push(original);
    const snapshot = mutate(structuredClone(original));
    snapshot.revisionId = randomUUID();
    snapshot.createdAt = new Date().toISOString();
    delete snapshot.approvedAt;
    shot.snapshot = snapshot;
    shot.snapshots.push(structuredClone(snapshot));
    shot.stale = true;
    delete shot.selectedAttemptId;
    delete shot.keepOldDecision;
  }
  return next;
}
export function markChangedSnapshotsStale(
  before: VideoProject,
  after: VideoProject,
): void {
  for (const e of after.episodes)
    for (const shot of e.shots) {
      const old = before.episodes
        .flatMap((e) => e.shots)
        .find((s) => s.id === shot.id);
      const productionInput = (snapshot: ShotSnapshot) => {
        const { approvedAt, ...inputs } = snapshot;
        return stableStringify(inputs);
      };
      if (
        old &&
        productionInput(old.snapshot) !== productionInput(shot.snapshot)
      ) {
        shot.stale = true;
        delete shot.selectedAttemptId;
        delete shot.keepOldDecision;
      }
    }
}
