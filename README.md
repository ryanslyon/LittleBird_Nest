# Cardinal — a nature-expert Telegram bot

A Telegram chatbot that answers questions about the natural world, identifies
photos you send it, and surfaces real iNaturalist sightings near you as you
walk — powered by **Claude Managed Agents** and **Cloudflare Workers**.

## Overview

Cardinal is a Telegram bot for exploring and learning about the outdoors. Ask
it about plants, animals, fungi, birds, geology, or ecology and it does real
research (web search + fetch) before answering; send it a photo and it
identifies what's in it. Share your location and it queries the iNaturalist
API for verified observations within 100 ft, filtering out anything you've
already seen. Tell it you're starting a walk and it opens a "journey" that
groups your observations together, prompts you for a voice-memo recap when
you're done, transcribes it, and saves a condensed experience log.

It's built for anyone curious about what's actually living around them —
naturalists, hikers, students, or a parent walking with kids — who wants a
low-friction way to get expert-quality answers and real citizen-science data
without leaving a chat window.

## Educational Context

*(Fill in for your program/course — placeholder based on the CFA GenAI
Toolmaking residency context.)* Cardinal pairs generative AI with real
citizen-science data (iNaturalist) to support field-based environmental
science and ecology education — e.g., prompting close observation on a nature
walk, reinforcing species identification skills, and giving students a
low-effort way to log and reflect on field observations via voice memo.

## Architecture

Cardinal is two independently deployable Cloudflare Workers: the Telegram bot
(this repo's root) and an iNaturalist MCP server (`mcp-inaturalist/`) that the
agent calls as a tool. See [docs/architecture.md](docs/architecture.md) for
the full system design and [docs/mcp-server.md](docs/mcp-server.md) for the
MCP tool reference.

```
Telegram ──webhook──▶ Cloudflare Worker ──▶ Durable Object (one per chat)
                                              │
                                              ├─ persistent Managed Agent session
                                              ├─ acks Telegram instantly, polls via DO alarm
                                              ▼
                                  Anthropic Managed Agents API (Agent: Cardinal)
                                              │
                                              ▼
                                  inat-mcp Worker ──▶ iNaturalist API + D1
```

## Installation

### Prerequisites

- Node 18+
- A Cloudflare account
- An Anthropic API key
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

### Steps

```bash
npm install

# 1) Create the Managed Agent + Environment (writes IDs into wrangler.jsonc).
ANTHROPIC_API_KEY=sk-ant-... npm run setup

# 2) Set the three secrets in Cloudflare.
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET_TOKEN   # any long random [A-Za-z0-9_-] string

# 3) Deploy. Note the printed https://nature-bot.<subdomain>.workers.dev URL.
npm run deploy

# 4) Point Telegram at the deployed Worker.
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_SECRET_TOKEN=<same as step 2> \
WEBHOOK_URL=https://nature-bot.<subdomain>.workers.dev/telegram/webhook \
  npm run set-webhook
```

The `mcp-inaturalist/` Worker (iNaturalist tool server) is deployed
separately — see [docs/mcp-server.md](docs/mcp-server.md).

## Usage

Open Telegram, find your bot, send `/start`, and chat. Send a photo for an
identification, share your location for nearby sightings, or say "starting a
walk" / "heading home" to bracket a journey.

```bash
npm run set-webhook -- --info    # inspect the current webhook
npm run set-webhook -- --delete  # remove it
```

For local development and sample request payloads, see
[examples/telegram-webhook-payloads.md](examples/telegram-webhook-payloads.md):

```bash
cp .dev.vars.example .dev.vars     # fill in real secrets (gitignored)
ANTHROPIC_API_KEY=sk-ant-... npm run setup
npm run dev                        # wrangler dev on http://127.0.0.1:8787
```

## Tests & CI/CD

```bash
npm test          # vitest unit tests
npm run typecheck # tsc --noEmit
npm run build:check  # wrangler deploy --dry-run (offline bundle validation)
```

GitHub Actions (`.github/workflows/`):
- **`ci.yml`** — runs on every push/PR: typecheck → unit tests → build dry-run. No secrets needed.
- **`deploy.yml`** — runs on push to `main` (and manual dispatch): typecheck → tests → `wrangler deploy`.

Required repo secrets for the deploy workflow (Settings → Secrets and
variables → Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A token with **Workers Scripts: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

The Worker's application secrets (`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_SECRET_TOKEN`) live in Cloudflare via `wrangler secret put` and
persist across deploys — rotate them there, not through GitHub.

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for
guidelines.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for
details.

## Credits and Acknowledgments

Developed as part of the CFA GenAI Toolmaking for the Arts Residency at
Carnegie Mellon University, supported by the College of Fine Arts and the
Frank-Ratchye STUDIO for Creative Inquiry.
