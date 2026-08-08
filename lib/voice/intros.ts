import agentIntros from "@/ElevenLabsAgent/intros.json";

const FALLBACK_INTROS = ["Hi, I'm here to help — what's going on?"];

/**
 * Per intros.json: true per-call variety has to come from the caller side,
 * passed as a session-start override, since the agent-level first_message
 * is static. Picked once per call so the greeting isn't identical every time.
 */
export function pickRandomIntro(): string {
  const intros = agentIntros.intros?.length ? agentIntros.intros : FALLBACK_INTROS;
  return intros[Math.floor(Math.random() * intros.length)];
}
