/**
 * Renders the caller side of the audio personas to real audio with ElevenLabs TTS,
 * and mixes in background noise when a noise bed is available.
 *
 *   npm run test:adversarial:audio
 *
 * Text simulation cannot catch an audio-layer failure: a code-switched sentence and a
 * dog barking over the caller both break at the transcription layer, before the LLM
 * ever sees a turn. Play these files into the live agent through the widget.
 *
 * Noise beds are not committed. Drop a file at scripts/adversarial/noise/<name>.mp3
 * (cafe.mp3, dog-bark.mp3) and it gets mixed in with ffmpeg if ffmpeg is installed;
 * otherwise the clean caller audio is still written.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { personas } from "./personas";

const API = "https://api.elevenlabs.io/v1";
const OUT_DIR = path.join(process.cwd(), "scripts", "adversarial", "results", "audio");
const NOISE_DIR = path.join(process.cwd(), "scripts", "adversarial", "noise");
const VOICE_ID = process.env.ELEVENLABS_CALLER_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";

async function tts(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const response = await fetch(`${API}/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      // Multilingual: one of the personas switches language mid-sentence.
      model_id: "eleven_multilingual_v2",
      output_format: "mp3_44100_128",
    }),
  });
  if (!response.ok) {
    throw new Error(`text-to-speech failed (${response.status}): ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function mixNoise(cleanFile: string, noiseFile: string, outFile: string) {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      cleanFile,
      "-i",
      noiseFile,
      "-filter_complex",
      // Noise at -12dB: audible, and still transcribable by a good STT stack.
      "[1:a]volume=0.25[n];[0:a][n]amix=inputs=2:duration=first:dropout_transition=0",
      outFile,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  const targets = personas.filter((p) => p.audio);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ffmpeg = hasFfmpeg();

  for (const persona of targets) {
    process.stdout.write(`Rendering ${persona.id} — ${persona.audio!.note}\n`);
    const clean = path.join(OUT_DIR, `${persona.id}.clean.mp3`);
    fs.writeFileSync(clean, await tts(persona.firstMessage));
    process.stdout.write(`  wrote ${path.relative(process.cwd(), clean)}\n`);

    const noise = path.join(NOISE_DIR, `${persona.audio!.noise}.mp3`);
    if (persona.audio!.noise === "none") continue;
    if (!fs.existsSync(noise)) {
      process.stdout.write(`  no noise bed at ${path.relative(process.cwd(), noise)} — skipped mix\n`);
      continue;
    }
    if (!ffmpeg) {
      process.stdout.write("  ffmpeg not installed — skipped mix\n");
      continue;
    }
    const mixed = path.join(OUT_DIR, `${persona.id}.noisy.mp3`);
    mixNoise(clean, noise, mixed);
    process.stdout.write(`  wrote ${path.relative(process.cwd(), mixed)}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
