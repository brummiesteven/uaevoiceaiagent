# Setup — from nothing to a working voice agent

Written for someone who has not done this before. Follow it top to bottom and it works.
Roughly 15 minutes. Every step says what you should see, so you know it worked before
moving on.

You need a Mac or Linux machine, an ElevenLabs account, and a terminal.

---

## Step 1 — Install the two things you need

**Node.js** (runs the server). Check whether you already have it:

```bash
node --version
```

If that prints `v20` or higher, skip ahead. If it says "command not found", install from
<https://nodejs.org> — take the LTS version — then close and reopen your terminal.

**cloudflared** (puts your server on the public internet so ElevenLabs can reach it):

```bash
brew install cloudflared          # macOS
```

Not on macOS? See <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

Check it worked:

```bash
cloudflared --version
```

---

## Step 2 — Get the server running on your machine

From the repo root:

```bash
cd MCPServer
npm install
npm start
```

Wait about 10 seconds. You should see something like:

```
[boot] hydrating catalogue from data.dubai …
[boot] 598 datasets, 76 entities, 9 indicators, 10 services, 20 tools (10 voice) — via live in 3390ms
[ready] MCP on http://localhost:8787/mcp  ·  health http://localhost:8787/health
```

Once you see `[ready]`, it's working. **Leave this terminal window open** — closing it
stops the server.

> Boot time varies a lot, because data.dubai is slow and inconsistent. Anywhere from 3
> to 90 seconds is normal. If it takes longer than two minutes, press `Ctrl+C` and run
> `npm start` again.

Open a **second terminal window** for everything from here on.

---

## Step 3 — Check it's actually working

In your second terminal:

```bash
cd MCPServer
npm run smoke
```

You want to see `13 passed, 0 failed` at the bottom. If anything fails, jump to
[Troubleshooting](#troubleshooting).

---

## Step 4 — Put it on the internet

ElevenLabs runs in the cloud, so it cannot reach `localhost` on your laptop. This gives
your local server a public web address.

In your **second** terminal:

```bash
cloudflared tunnel --url http://localhost:8787
```

Among the output you'll see a box containing an address like:

```
https://motivation-scanner-only-registered.trycloudflare.com
```

**Copy that address.** Leave this terminal open too — closing it kills the connection.

> The address is random and **changes every time you restart the tunnel.** That's normal.
> Step 6 shows how to update it when it changes.

Give it about 30 seconds before using it. Immediately after startup it isn't reachable
yet, and it returns an error page that looks like a real failure but isn't.

---

## Step 5 — Get your ElevenLabs key and create an agent

1. Sign in at <https://elevenlabs.io>
2. Click your profile (bottom left) → **API Keys** → create one → copy it.
   It starts with `sk_`.
3. Go to **Agents** and create a new agent. Give it any name.
4. Open the agent and copy its ID from the address bar — it starts with `agent_`.

Now, in a **third** terminal:

```bash
cd MCPServer
cp .env.example .env
```

Open `.env` in any text editor and paste your two values in:

```
ELEVENLABS_API_KEY=sk_your_actual_key_here
AGENT_ID=agent_your_actual_id_here
```

Save and close.

> `.env` holds a password, effectively. It is deliberately excluded from git — never
> paste your key into a chat, a commit, or a screenshot.

---

## Step 6 — Connect the server to your agent

One command does the whole thing. Use the address you copied in step 4:

```bash
node scripts/reconnect.js https://your-address.trycloudflare.com
```

You should see:

```
✓ server healthy — 598 datasets, 20 tools
✓ detached old integration from agent
✓ created integration abc123
✓ agent re-attached
✓ ElevenLabs can see 10 tools

Ready. Talk to the agent at:
  https://elevenlabs.io/app/talk-to?agent_id=agent_...
```

That last line is your agent. **Open it and start talking.**

**Run this same command any time the tunnel address changes** — it handles everything:
checks the server is healthy first, unhooks the old address, registers the new one, and
reattaches it. Takes about 20 seconds.

---

## Step 7 — Give the agent its instructions

A fresh agent has no personality and no idea when to use the tools. Open
[`agent-prompt.md`](agent-prompt.md) in this folder, copy the system prompt, and paste it
into your agent's **System Prompt** field in the ElevenLabs dashboard.

Two settings matter more than they look:

- **LLM** — use a strong model (`claude-sonnet-5` is what this was tested against).
  Weaker ones don't reliably call tools, and an agent that doesn't call tools makes the
  answer up instead of admitting it doesn't know.
- **Temperature** — keep it low (0.1–0.4). This is government data; you do not want
  creative.

`agent-prompt.md` also explains *why* each rule is there — several exist because of
specific ways these tools behave, so read it before rewriting anything.

---

## Checking it really works

Ask it: **"How many people live in Dubai?"**

A correct answer mentions roughly **4.74 million** and credits the Dubai Data and
Statistics Establishment.

Now look at the terminal running the server. You should see a line like:

```
[req] POST /mcp/voice ua="ElevenLabs/1.0"
```

**That line is the proof.** It means the agent really called your server. If you get a
plausible answer but *no* such line appears, the agent is making the answer up — go to
Troubleshooting.

Other things worth trying:

- "I use a wheelchair and I'm moving to Dubai. What help can I get getting around?"
- "What will my electricity bill be if I use 3000 units a month?"
- "What data does Dubai publish about real estate?"

---

## Troubleshooting

**The agent answers but the server shows no `[req]` line.**
It's inventing answers. Either the tools aren't attached (re-run step 6 and check it says
"ElevenLabs can see 10 tools"), or MCP is switched off for your workspace. In ElevenLabs
go to **Integrations** and enable custom MCP servers — it's off by default, and when it's
off the agent silently ignores your tools rather than showing an error.

**"Cannot find module" when starting.**
You skipped `npm install`, or you're in the wrong folder. You need to be inside
`MCPServer`.

**The tunnel address shows a Cloudflare error page.**
Wait 30 seconds after starting the tunnel and try again. It isn't reachable immediately.

**`reconnect.js` says "server healthy" check failed.**
The server in terminal one has stopped, or the tunnel in terminal two has. Both need to
be running.

**Everything worked, now it doesn't.**
Almost always the tunnel dropped — laptop sleep is the usual cause. Restart it (step 4)
and re-run step 6 with the new address. **Turn off sleep before any demo.**

**`npm run smoke` fails on the search tests.**
The server can't reach data.dubai. Check your internet, then restart the server.

---

## Demo-day checklist

1. Start the server, leave the terminal open.
2. Start the tunnel, leave that terminal open.
3. `node scripts/reconnect.js <address>`
4. `npm run smoke` — expect 13 passed.
5. Ask it one real question and watch for the `[req]` line.
6. **Disable laptop sleep.**

If it breaks between rehearsal and demo, steps 2 and 3 fix it in under a minute.
