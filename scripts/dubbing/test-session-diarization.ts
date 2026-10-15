import assert from 'node:assert/strict';
import {
  applyAssignmentsToSidecar,
  assignSpeakersToCues,
  buildDubbingSpeakers,
} from '../../main/helpers/dubbing/speakerAssign';
import {
  dubbingMultiVoiceEnabled,
  missingDubbingSpeakerVoiceIds,
} from '../../types/dubbing';
import type { ProofreadDataFileV2 } from '../../types/proofreadData';

// Two speakers: A talks 0-4s, B talks 4-8s (sherpa ids are zero-based, seconds).
const segments = [
  { start: 0, end: 4, speaker: 0 },
  { start: 4, end: 8, speaker: 1 },
];
const cues = [
  { startMs: 0, endMs: 2000, text: 'a1' },
  { startMs: 2000, endMs: 4000, text: 'a2' },
  { startMs: 4500, endMs: 7000, text: 'b1' },
  { startMs: 9000, endMs: 10000, text: 'silence' },
];

const assignments = assignSpeakersToCues(cues, segments);
assert.deepEqual(
  assignments.map((a) => a.speakerIds),
  [[1], [1], [2], []],
  'ids become one-based; uncovered cue stays unassigned',
);
assert.equal(assignments[2].primarySpeakerId, 2);
assert.equal(assignments[3].primarySpeakerId, undefined);

const speakers = buildDubbingSpeakers(cues, assignments);
assert.deepEqual(
  speakers.map((s) => [s.id, s.cueCount, s.totalDurationMs]),
  [
    [1, 2, 4000],
    [2, 1, 2500],
  ],
);

const sidecar = {
  version: 2,
  meta: {},
  speakers: [],
  cues: [
    { id: '1', startMs: 0, endMs: 2000, source: 'a1', target: 'x' },
    {
      id: '2',
      startMs: 2000,
      endMs: 4000,
      source: 'a2',
      target: 'x',
      speakerIds: [5],
      primarySpeakerId: 5,
      speakerAssignmentSource: 'manual',
    },
    { id: '3', startMs: 4500, endMs: 7000, source: 'b1', target: 'x' },
    {
      id: '4',
      startMs: 9000,
      endMs: 10000,
      source: 's',
      target: 'x',
      speakerIds: [9],
      primarySpeakerId: 9,
    },
  ],
} as unknown as ProofreadDataFileV2;

const updated = applyAssignmentsToSidecar(sidecar, cues, assignments);
assert.deepEqual(updated.cues[0].speakerIds, [1]);
assert.deepEqual(updated.cues[1].speakerIds, [5], 'manual assignment kept');
assert.deepEqual(updated.cues[2].speakerIds, [2]);
assert.equal(updated.cues[3].speakerIds, undefined, 'stale auto value cleared');
assert.deepEqual(
  updated.speakers.map((s) => s.id).sort(),
  [1, 2, 5],
  'roster covers every referenced speaker',
);
assert.equal(sidecar.cues[0].speakerIds, undefined, 'input is not mutated');

// Fewer sidecar cues than parsed cues and different timing: no safe pairing.
const unpaired = applyAssignmentsToSidecar(
  { ...sidecar, cues: sidecar.cues.slice(0, 2) } as ProofreadDataFileV2,
  cues.map((c) => ({ ...c, startMs: c.startMs + 1, endMs: c.endMs + 1 })),
  assignments,
);
assert.equal(unpaired.cues[0].speakerIds, undefined);

// Per-speaker voices are on for sessions saved before the switch existed.
assert.equal(dubbingMultiVoiceEnabled({}), true);
assert.equal(dubbingMultiVoiceEnabled(undefined), true);
assert.equal(dubbingMultiVoiceEnabled({ multiVoice: true }), true);
assert.equal(dubbingMultiVoiceEnabled({ multiVoice: false }), false);
assert.deepEqual(
  missingDubbingSpeakerVoiceIds(
    [
      { id: 1, cueCount: 2 },
      { id: 2, cueCount: 1 },
    ],
    {},
  ),
  [1, 2],
  'two speakers without voices are missing while the switch is on',
);

console.log('session diarization units OK');
