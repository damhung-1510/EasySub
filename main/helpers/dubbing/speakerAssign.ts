import {
  speakerIdsForCues,
  type SpeakerDiarizationSegment,
  type TimedSubtitleCue,
} from '../speakerDiarization/alignment';
import {
  createDefaultSpeaker,
  normalizeSpeakerIds,
  normalizeSpeakerRoster,
  type ProofreadDataFileV2,
} from '../../../types/proofreadData';
import type { DubbingSpeaker } from '../../../types/dubbing';
import { alignSidecarCues } from './speakerMetadata';

export interface CueSpeakerAssignment {
  speakerIds: number[];
  primarySpeakerId?: number;
}

/** Map diarization segments onto dubbing cues; the first id is the primary speaker. */
export function assignSpeakersToCues(
  cues: readonly TimedSubtitleCue[],
  segments: SpeakerDiarizationSegment[],
): CueSpeakerAssignment[] {
  return speakerIdsForCues([...cues], segments).map((ids) => {
    const speakerIds = normalizeSpeakerIds(ids);
    return speakerIds.length
      ? { speakerIds, primarySpeakerId: speakerIds[0] }
      : { speakerIds: [] };
  });
}

/** Roster in order of first appearance, with per-speaker cue counts, as the workbench lists it. */
export function buildDubbingSpeakers(
  cues: ReadonlyArray<{ startMs: number; endMs: number }>,
  assignments: readonly CueSpeakerAssignment[],
  roster: ProofreadDataFileV2['speakers'] = [],
): DubbingSpeaker[] {
  const known = new Map(roster.map((speaker) => [speaker.id, speaker]));
  const order: number[] = [];
  const stats = new Map<
    number,
    { cueCount: number; totalDurationMs: number }
  >();
  assignments.forEach((assignment, index) => {
    for (const id of assignment.speakerIds) {
      if (!stats.has(id)) {
        stats.set(id, { cueCount: 0, totalDurationMs: 0 });
        order.push(id);
      }
      const entry = stats.get(id)!;
      entry.cueCount += 1;
      entry.totalDurationMs += Math.max(
        0,
        cues[index].endMs - cues[index].startMs,
      );
    }
  });
  return order.map((id) => {
    const info = known.get(id) ?? createDefaultSpeaker(id);
    return {
      id,
      name: info.displayName,
      color: info.color,
      ...stats.get(id)!,
    };
  });
}

/**
 * Write automatic assignments into a sidecar. Cues the user assigned by hand
 * keep their speakers; cues without a safe pairing are left untouched.
 */
export function applyAssignmentsToSidecar(
  data: ProofreadDataFileV2,
  cues: ReadonlyArray<{ startMs: number; endMs: number }>,
  assignments: readonly CueSpeakerAssignment[],
): ProofreadDataFileV2 {
  const aligned = alignSidecarCues(cues, data.cues);
  const next = data.cues.map((cue) => ({ ...cue }));
  aligned.forEach((sidecarIndex, index) => {
    if (sidecarIndex === undefined) return;
    const target = next[sidecarIndex];
    if (target.speakerAssignmentSource === 'manual') return;
    const assignment = assignments[index];
    delete target.speakerIds;
    delete target.primarySpeakerId;
    if (assignment?.speakerIds.length) {
      target.speakerIds = [...assignment.speakerIds];
      target.primarySpeakerId = assignment.primarySpeakerId;
    }
  });
  return {
    ...data,
    meta: { ...data.meta, updatedAt: new Date().toISOString() },
    speakers: normalizeSpeakerRoster(data.speakers, next),
    cues: next,
  };
}
