import type { ServiceRecord } from "@/content/schema";
import { answerQuestion } from "./mockAnswers";
import type { CallState, TranscriptTurn, VoiceTransport, VoiceTransportEvents } from "./types";

const IDLE_PROMPT_DELAY_MS = 4000;

let turnSeq = 0;
function nextTurnId() {
  turnSeq += 1;
  return `turn-${turnSeq}-${Date.now()}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * A real state machine, not a static screenshot: emits
 * connecting → listening → thinking → speaking → listening, drives a
 * wobbling volume signal, and reveals text word by word so partial
 * transcripts are exercised. Nudges with one of the service's own example
 * questions if nobody asks anything within 4s — and only ever does that
 * once, so it can't talk over someone.
 */
export function createMockTransport(service: ServiceRecord, mockReason: string): VoiceTransport {
  let events: VoiceTransportEvents | null = null;
  let active = false;
  let hasAskedSomething = false;
  let hasAutoPrompted = false;
  let volumeTimer: ReturnType<typeof setInterval> | null = null;
  let idleProbeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAnswerText = "";
  let speakToken = 0;

  function setState(state: CallState) {
    events?.onStateChange(state);
  }

  function startVolumeWobble() {
    stopVolumeWobble();
    let t = 0;
    volumeTimer = setInterval(() => {
      t += 1;
      const wobble = 0.35 + Math.sin(t / 2.2) * 0.22 + Math.random() * 0.18;
      events?.onVolume(Math.max(0, Math.min(1, wobble)));
    }, 120);
  }

  function stopVolumeWobble() {
    if (volumeTimer) clearInterval(volumeTimer);
    volumeTimer = null;
    events?.onVolume(0);
  }

  function armIdlePrompt() {
    clearIdlePrompt();
    if (hasAskedSomething || hasAutoPrompted) return;
    idleProbeTimer = setTimeout(() => {
      if (!active || hasAskedSomething || hasAutoPrompted) return;
      const question = service.exampleQuestions[0];
      if (question) {
        hasAutoPrompted = true;
        void handleQuestion(question);
      }
    }, IDLE_PROMPT_DELAY_MS);
  }

  function clearIdlePrompt() {
    if (idleProbeTimer) clearTimeout(idleProbeTimer);
    idleProbeTimer = null;
  }

  async function speakWordByWord(text: string, speed: "normal" | "slower" = "normal") {
    const token = ++speakToken;
    const id = nextTurnId();
    const words = text.split(" ");
    let built = "";
    const perWordDelay = speed === "slower" ? 190 : 70;
    for (let i = 0; i < words.length; i += 1) {
      if (token !== speakToken || !active) return false;
      built += (i === 0 ? "" : " ") + words[i];
      events?.onTurn({ id, speaker: "agent", text: built, final: i === words.length - 1 });
      await sleep(perWordDelay + Math.random() * 40);
    }
    if (token !== speakToken || !active) return false;
    lastAnswerText = text;
    return true;
  }

  async function handleQuestion(question: string) {
    if (!active) return;
    hasAskedSomething = true;
    clearIdlePrompt();
    stopVolumeWobble();

    events?.onTurn({ id: nextTurnId(), speaker: "caller", text: question, final: true });

    setState("thinking");
    await sleep(850 + Math.random() * 450);
    if (!active) return;

    const answer = answerQuestion(service, question);
    setState("speaking");
    const completed = await speakWordByWord(answer.text);
    if (!active || !completed) return;

    if (answer.citation) {
      events?.onCitation(answer.citation);
    }

    setState("listening");
    startVolumeWobble();
    armIdlePrompt();
  }

  return {
    isMock: true,
    mockReason,

    async start(nextEvents) {
      events = nextEvents;
      active = true;
      hasAskedSomething = false;
      hasAutoPrompted = false;

      setState("connecting");
      await sleep(650);
      if (!active) return;

      events.onConversationId(`mock-${service.slug}-${Date.now()}`);
      setState("listening");
      startVolumeWobble();
      armIdlePrompt();
    },

    async stop() {
      active = false;
      clearIdlePrompt();
      stopVolumeWobble();
      setState("idle");
    },

    interrupt() {
      if (!active) return;
      clearIdlePrompt();
      speakToken += 1; // cancels any in-flight speakWordByWord
      setState("listening");
      startVolumeWobble();
      armIdlePrompt();
    },

    repeatLast(opts) {
      if (!active || !lastAnswerText) return;
      clearIdlePrompt();
      stopVolumeWobble();
      setState("speaking");
      void speakWordByWord(lastAnswerText, opts?.slower ? "slower" : "normal").then((completed) => {
        if (!active || !completed) return;
        setState("listening");
        startVolumeWobble();
        armIdlePrompt();
      });
    },

    ask(question) {
      void handleQuestion(question);
    },
  };
}
