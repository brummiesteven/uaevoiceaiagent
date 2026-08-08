# Setup

Two ways to run this. Pick one, follow that section only.

## Which one?

| | **A — Cloudflare** | **B — Local + tunnel** |
|---|---|---|
| Speed from ElevenLabs | **1.4s** avg | 4.0s avg |
| Setup | ~5 min | ~15 min |
| Laptop must stay on | No | **Yes** |
| URL changes | Never | **Every restart** |
| Data | Snapshot, refreshed on deploy | Live, re-read every boot |
| Needs | Cloudflare account (free) | Nothing |

**Demoing? Use A.** It's nearly 3× faster and the URL never moves.

**Changing tool code? Use B.** Restart and test instantly, no deploy step.

---

# Option A — Cloudflare Worker

Runs at Cloudflare's edge. No laptop, no tunnel, no rotating URL.

### 1. Install and log in

```bash
cd MCPServer
npm install
npx wrangler login
```

A browser opens. Authorise it.

### 2. Deploy

```bash
npm run deploy:worker
```

You'll get a URL like `https://alhammadi-mcp.<your-subdomain>.workers.dev`.

> First deploy only: if it says you need a `workers.dev` subdomain, open the link it
> prints, pick any name, then run the command again. Allow ~30 seconds after that for the
> certificate — until then you'll see TLS errors, which are expected and pass.

### 3. Check it

```bash
curl https://<your-url>/health
npm run smoke -- https://<your-url>/mcp
```

Expect `13 passed, 0 failed`.

Now go to **Connecting ElevenLabs** below.

### The one limitation

**The catalogue is baked into the Worker at deploy time, not fetched live.**

data.dubai's firewall rejects datacenter IPs — verified against the JSON API, not just the
web pages — so a Worker can never fetch it. It doesn't need to: the catalogue was always
loaded once at startup and answered from memory. On Cloudflare it simply ships inside the
bundle (137 KB gzipped).

In practice that means **refreshing the data is a deploy**:

```bash
npm start              # pulls the live catalogue, writes the snapshot, then Ctrl+C
npm run deploy:worker  # bundles the new snapshot and ships it
```

The catalogue changes rarely, so this is a weekly job at most.

---

# Option B — Local + tunnel

Runs on your machine. ElevenLabs reaches it through a Cloudflare tunnel.

### 1. Install

```bash
cd MCPServer
npm install
brew install cloudflared     # macOS
```

### 2. Start the server — leave this window open

```bash
npm start
```

Wait for:

```
[boot] 598 datasets, 76 entities, 9 indicators, 10 services, 20 tools (10 voice)
[ready] MCP on http://localhost:8787/mcp
```

> Boot takes anywhere from 3 to 90 seconds — data.dubai is slow and inconsistent. Over two
> minutes, `Ctrl+C` and retry.

### 3. Start the tunnel — second window, leave it open too

```bash
cloudflared tunnel --region us --url http://localhost:8787
```

Copy the `https://….trycloudflare.com` address it prints.

> `--region us` matters: without it the tunnel may exit via Singapore while ElevenLabs runs
> in the US, which measurably slows every call.
>
> Wait ~30 seconds before using the URL. Straight after startup it returns an error page
> that looks like a real failure but isn't.

### 4. Connect it

```bash
node scripts/reconnect.js https://<your-tunnel-url>
```

This health-checks the server, then repoints the agent. **Re-run it every time the tunnel
restarts** — the URL is different each time.

### Before you present

- **Turn off laptop sleep.** Sleep kills the tunnel.
- Start both windows early and leave them alone.

---

# Connecting ElevenLabs

Same for both options.

### 1. Get your credentials

1. Sign in at [elevenlabs.io](https://elevenlabs.io)
2. Profile (bottom left) → **API Keys** → create one. Starts with `sk_`.
3. **Agents** → create an agent → copy its ID from the address bar. Starts with `agent_`.

```bash
cp .env.example .env
```

Put both values in `.env`. It's git-ignored — never paste a key into chat or a commit.

### 2. Point the agent at your server

```bash
node scripts/reconnect.js https://<your-url>
```

Works for either option. It prints a link to talk to your agent.

### 3. Give the agent its prompt

Copy the system prompt from [`agent-prompt.md`](agent-prompt.md) into the agent's **System
Prompt** field.

Two settings matter more than they look:

- **LLM** — use a strong model (`claude-sonnet-5` is what this was tested against). Weaker
  ones don't reliably call tools, and an agent that doesn't call tools invents the answer.
- **Temperature** — 0.1 to 0.4. Government data. Not creative.

### 4. Prove it works

Ask: **"How many people live in Dubai?"**

A correct answer says roughly **4.74 million** and credits the Dubai Data and Statistics
Establishment.

Then check the server is really being called:

- **Option A:** `npx wrangler tail` in another window — you'll see the request
- **Option B:** the server window shows `[req] POST /mcp/voice ua="ElevenLabs/1.0"`

**If you get a plausible answer but no request appears, the agent is making it up.** See
below.

---

# Troubleshooting

**Answers arrive but nothing hits the server.**
The agent is inventing them. Either the tools aren't attached — re-run `reconnect.js` and
check it says "ElevenLabs can see 10 tools" — or MCP is off for your workspace. In
ElevenLabs, **Integrations → enable custom MCP servers**. It's off by default and fails
silently.

**Answers take 20–30 seconds.**
You're on Option B with a tunnel exiting far from ElevenLabs. Restart with `--region us`,
or switch to Option A.

**`Cannot find module`.**
You skipped `npm install`, or you're not in `MCPServer`.

**Tunnel URL shows a Cloudflare error page.**
Wait 30 seconds after starting the tunnel.

**`reconnect.js` says the health check failed.**
The server or the tunnel has stopped. Both windows need to stay open.

**It worked, now it doesn't.**
The tunnel dropped — usually laptop sleep. Restart it and re-run `reconnect.js`.

**Smoke tests fail on search.**
Option B can't reach data.dubai. Check your connection and restart.
