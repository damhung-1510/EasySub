import type { DiscoverySession } from '../../../types/creativeDiscovery';
export function buildDiscoveryContext(session: DiscoverySession) {
  return {
    inputText: session.inputText,
    confirmed: session.decisions.filter((d) => d.confirmed),
    suggestions: session.decisions.filter((d) => !d.confirmed),
    recentTurns: session.turns
      .slice(-8)
      .map((t) => ({ role: t.role, text: t.text })),
    answeredTurns: session.turns.filter((t) => t.role === 'user').length,
  };
}
