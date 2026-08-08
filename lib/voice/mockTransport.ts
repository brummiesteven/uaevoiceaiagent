import type { ServiceRecord } from "@/content/schema";
import { answerQuestion } from "./mockAnswers";
import type { CallState, VoiceTransport, VoiceTransportEvents } from "./types";

const AUTO_DEMO_DELAY_MS = 2200;

let turnSeq = 0;
function nextTurnId() {
  turnSeq += 1;
  return `mock-turn-${turnSeq}-${Date.now()}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * A real state machine, not a static screenshot: connecting → active, then
 * — once, never again — auto-asks one of the service's own example
 * questions shortly after connecting, so the flow is demoable hands-free
 * with no live agent configured. Reveals the answer word by word so
 * partial transcripts are exercised.
 */
export function createMockTransport(service: ServiceRecord, mockReason: string): VoiceTransport {
  let events: VoiceTransportEvents | null = null;
  let active = false;
  let demoAsked = false;
  let volumeTimer: ReturnType<typeof setInterval> | null = null;
  let demoTimer: ReturnType<typeof setTimeout> | null = null;
  let speakToken = 0;

  function setState(state: CallState) {
    events?.onStateChange(state);
  }

  function startAmbientVolume() {
    stopAmbientVolume();
    let t = 0;
    volumeTimer = setInterval(() => {
      t += 1;
      const wobble = 0.3 + Math.sin(t / 2.5) * 0.18 + Math.random() * 0.15;
      events?.onVolume(Math.max(0, Math.min(1, wobble)));
    }, 130);
  }

  function stopAmbientVolume() {
    if (volumeTimer) clearInterval(volumeTimer);
    volumeTimer = null;
    events?.onVolume(0);
  }

  function clearAutoDemo() {
    if (demoTimer) clearTimeout(demoTimer);
    demoTimer = null;
  }

  async function speakWordByWord(text: string) {
    const token = ++speakToken;
    const id = nextTurnId();
    const words = text.split(" ");
    let built = "";
    events?.onSpeakingChange(true);
    for (let i = 0; i < words.length; i += 1) {
      if (token !== speakToken || !active) return;
      built += (i === 0 ? "" : " ") + words[i];
      events?.onTurn({ id, speaker: "agent", text: built, final: i === words.length - 1 });
      await sleep(65 + Math.random() * 35);
    }
    if (token === speakToken) events?.onSpeakingChange(false);
  }

  async function runExchange(question: string | undefined) {
    if (!active || !question) return;
    events?.onTurn({ id: nextTurnId(), speaker: "caller", text: question, final: true });
    await sleep(500);
    if (!active) return;

    const answer = answerQuestion(service, question);
    await speakWordByWord(answer.text);
    if (!active) return;

    if (answer.citation) events?.onCitation(answer.citation);
  }

  function armAutoDemo() {
    clearAutoDemo();
    if (demoAsked) return;
    demoTimer = setTimeout(() => {
      if (!active || demoAsked) return;
      demoAsked = true;
      void runExchange(service.exampleQuestions[0]);
    }, AUTO_DEMO_DELAY_MS);
  }

  return {
    isMock: true,
    mockReason,

    async start(nextEvents) {
      events = nextEvents;
      active = true;
      demoAsked = false;
      speakToken += 1;

      setState("connecting");
      await sleep(600);
      if (!active) return;

      events.onConversationId(`mock-${service.slug}-${Date.now()}`);
      setState("active");
      startAmbientVolume();
      armAutoDemo();
    },

    async stop() {
      active = false;
      speakToken += 1;
      clearAutoDemo();
      stopAmbientVolume();
      events?.onSpeakingChange(false);
      setState("idle");
    },
  };
}
