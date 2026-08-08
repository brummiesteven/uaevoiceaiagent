# Submission video

`AlHammadi-submission.mp4` — 5m15s, 1920×1080. Answers the six submission questions in
order. Upload to Loom as-is.

Narration is ElevenLabs (voice: Kate Mercer). The demo section is **real captured audio
from the running agent**, including its live `get_dubai_indicator` tool call — not a
re-recording of a transcript.

## Rebuilding it

```bash
python3 -m http.server 8124        # serve slides.html
node render-frames.mjs             # slides -> frames/*.png at 1920x1080
# narration: POST each narration-script.json section to ElevenLabs TTS -> audio/*.mp3
# then pair each frame with its clip and concat with ffmpeg
```

Two things that will bite you if you redo this:

- **`ffmpeg` eats stdin.** Inside a `while read` loop it swallows every other line. Use
  `ffmpeg -nostdin`.
- Capture agent audio over the conversational WebSocket
  (`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…`). Output is `pcm_16000`,
  so convert with `ffmpeg -f s16le -ar 16000 -ac 1`.

## Known gap

The demo section is one exchange (~25s), not the three the brief's "~2 min" implies. Two
further captures failed against the clock. The script and pipeline are here, so adding
them is a rerun rather than a rebuild.
