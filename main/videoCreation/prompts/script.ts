export const SCRIPT_PROMPT_VERSION = 'script-workflow-1';
export const SCRIPT_PROMPTS = {
  brief:
    'Create a production brief from the confirmed creative brief; keep confirmed decisions unchanged.',
  outline:
    'Create a rich beat outline with opening, development, climax and ending. Preserve confirmed creative choices.',
  script:
    'Write a detailed film script with scene IDs, location/time, character IDs, action, dialogues linked to speaker IDs, emotion, narration, sound and durationMs. Use stable cast IDs from context, or explicit candidate IDs for new characters. Preserve confirmed creative choices.',
  'import-analysis':
    'Analyze the original screenplay without rewriting it. Preserve every original action and dialogue. Add structured scene data and list inferred or missing facts.',
  review:
    'Review story motivation, continuity, unresolved speakers and production feasibility. Return issues with severity and proposed actions. Never modify approved content.',
} as const;
