import type { ServiceRecord } from "@/content/schema";
import { createMockTransport } from "./mockTransport";
import type { VoiceTransport } from "./types";

/**
 * The only place that decides which transport is used. To go live, add one
 * file implementing VoiceTransport over @elevenlabs/react and return it here
 * when mode is "live" and an agent id is configured. No component changes.
 */
export function resolveTransport(mode: "live" | "mock", service: ServiceRecord): VoiceTransport {
  if (mode === "mock") {
    return createMockTransport(service, "Simulated call for this demo.");
  }

  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!agentId) {
    return createMockTransport(
      service,
      "No live agent is configured yet (NEXT_PUBLIC_ELEVENLABS_AGENT_ID is unset) — this call is simulated."
    );
  }

  // No live transport implemented yet. Falls back to the mock even when an
  // agent id is present, until a VoiceTransport over @elevenlabs/react lands.
  return createMockTransport(
    service,
    "A live agent id is configured, but no live transport is wired up yet — this call is simulated."
  );
}
