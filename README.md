# Cardinal — Little Bird's Field Companion

A Telegram chatbot that lets a child (or anyone exploring outdoors) turn a
walk into an ecological story — powered by **Claude Managed Agents** and
**Cloudflare Workers**. Cardinal is the phone-based "Field Buddy" prototype
of **Little Bird**'s **Field Companion** component: it supports noticing and
collection during a walk without turning the child's attention toward a
screen for its own sake.

## Overview

[Little Bird](https://miro.com/app/board/uXjVGq8ZIm4=/) is a play-based
ecological sensing and storytelling system that helps children understand
relationships within the places they explore. Rather than asking "What did
you find?", Little Bird asks "What did your walk make visible?" — children
collect experiences (objects, sounds, photos, voice notes), and the system
quietly gathers context and uses AI to translate those observations into
ecological relationships, narratives, and an accumulating memory of a place.

Cardinal is the piece of that system a child actually carries and talks to
during a walk. Its inputs mirror the Field Companion's design — words,
photographs, and voice notes standing in for sketches and physical
traces — and its process mirrors the Field Buddy workflow: it proposes an
identification, checks whether the item is new to the local journey log, and
tags what it finds, rather than making the child perform data entry. Send it
a photo and it identifies what's in it (with real research via web search +
fetch); share your location and it checks iNaturalist for verified sightings
within 100 ft you haven't already logged; say you're starting a walk and it
opens a "journey" that groups your collections together; say you're done and
it asks for a spoken recap, transcribes it, and hands back a condensed
experience log. Where the design calls for deliberately simple feedback (a
catch signal, a chirp) so the technology stays secondary to exploration,
today's Telegram prototype answers conversationally instead — a trade made to
keep the interaction legible and testable while the physical Field Companion
device remains conceptual.

It's designed initially for school-age learners, educators, and architecture
students, and built for anyone curious about what's actually living around
them who wants a low-friction way to notice, collect, and remember a place.

## Educational Context

Little Bird is being piloted in Fall 2026 in an Advanced Option Studio in
Carnegie Mellon's School of Architecture, led by resident Heather Bizon
*(course title, number, and enrollment TBC)*. Students use the project both
as a design framework and as a critical case study for working with
generative AI, ecological data, site observation, and multispecies
representation.

Within that studio, and for any classroom or field program that adopts it,
Cardinal supports learners in:

- noticing environmental transitions and describing observations with more specificity;
- reasoning about relationships among organisms, materials, weather, habitat, and human activity;
- distinguishing a direct observation from an AI-generated interpretation;
- recognizing uncertainty and asking follow-up questions rather than accepting a single automated answer; and
- understanding how individual walks (journeys) can contribute to a shared, accumulating picture of a place.

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

Mapped onto Little Bird's eight-part infrastructure system (Field Companion →
Community Station → Journey Database → Ecological Context Layer →
Translation Engine → Visual Language Engine → Community Archive → Return
Journey), this repo implements the **Field Companion** — specifically its
phone-based "Field Buddy" prototype format, which the design doc groups with
an Analog Bucket alternative for lower-tech collection. Supporting that role
end-to-end also required building thin, early slices of three downstream
components: a **Journey Database** (Cloudflare D1) to check whether an item
is new to the local log, an **Ecological Context Layer** (iNaturalist) to
filter against an ecosystem database, and a lightweight **AI Translation
Engine** (the agent's system prompt and journey-summary tools) to turn raw
observations into an identification and a narrative. The Community Station
(QR / Photo Booth handoff), full Visual Language Engine, Community Archive,
and Return Journey flow remain design concepts outside this repo.

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

## Prototype Demonstrations

Screenshots for each capability go in [`assets/`](assets/)
<br>
**Ask a question and get researched answers**
<br>
**Identify a photo**
<br>
![`assets/2606_LittleBird_gif_Cardinal_Demo_01.gif`](assets/2606_LittleBird_gif_Cardinal_Demo_01.gif)
<br>
**Nearby iNaturalist sightings from a shared location**
<br>
![`assets/2606_LittleBird_gif_Cardinal_Demo_02.gif`](assets/2606_LittleBird_gif_Cardinal_Demo_02.gif)
<br>
**Starting and ending a journey**
<br>
**Voice memo → transcription → journey notes**
<br>
![`assets/2606_LittleBird_gif_Cardinal_Demo_03.gif`](assets/2606_LittleBird_gif_Cardinal_Demo_03.gif)
<br>

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

Resident: Heather Bizon, Architecture, Carnegie Mellon University.

*[TO CONFIRM: names and roles of student research assistants, collaborators,
ecological or technical consultants, and test participants.]*

Developed as part of the CFA GenAI Toolmaking for the Arts Residency at
Carnegie Mellon University, supported by the College of Fine Arts and the
Frank-Ratchye STUDIO for Creative Inquiry.
