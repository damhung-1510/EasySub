import test from 'node:test';
import assert from 'node:assert/strict';
const load = () =>
  import('../../main/videoCreation/audioBridge').catch(() => ({}) as any);
test('speech cues occupy measured shot slots and retain stable speaker IDs', async () => {
  const api = await load();
  assert.equal(typeof api.buildSpeechCues, 'function', 'speech bridge missing');
  const cues = api.buildSpeechCues([
    {
      shotId: 'a',
      startMs: 0,
      durationMs: 1000,
      snapshot: { narration: 'Hello', dialogues: [] },
    },
    {
      shotId: 'b',
      startMs: 1000,
      durationMs: 2000,
      snapshot: {
        narration: '',
        dialogues: [{ speakerId: 'character-a', text: 'Good morning' }],
      },
    },
  ]);
  assert.equal(cues[1].startMs, 1000);
  assert.equal(cues[1].endMs, 3000);
  assert.equal(cues[1].speakerId, 'character-a');
});
test('missing role voice fails before TTS requests', async () => {
  const api = await load();
  assert.equal(
    typeof api.validateVoiceAssignments,
    'function',
    'voice validation missing',
  );
  assert.throws(
    () =>
      api.validateVoiceAssignments([{ speakerId: 'a', text: 'Hello' }], [], {
        voice: 'narrator',
        engine: { kind: 'cloud', providerId: 'p' },
      }),
    /VOICE_REQUIRED/,
  );
});
