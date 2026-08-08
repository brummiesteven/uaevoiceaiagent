"use client";

import type { ReactNode } from "react";
import { ConversationProvider } from "@elevenlabs/react";

/**
 * useConversation (used in lib/voice/useVoiceCall.ts) throws if it isn't
 * rendered under this provider — mounted once at the root so every page
 * can use the voice console without wiring it per-page.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}
