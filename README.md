# 🌿 NatureBuddy — a nature-expert Telegram bot

A Telegram chatbot that answers questions about the natural world — plants,
animals, fungi, birds, geology, ecology — and **identifies photos** you send it.
It does real research (web search + fetch) before answering.

It's powered by **Claude Managed Agents** (Anthropic hosts the agent loop, the
research tools, and the sandbox) and a tiny **Cloudflare Worker + Durable
Object** that bridges Telegram to the agent.

## Architecture

```
Telegram  ──webhook──▶  Cloudflare Worker  ──▶  Durable Object (one per chat)
                         (verify + route)         │
                                                   ├─ maps chat → a persistent
                                                   │  Managed Agent *session*
                                                   │  (conversation memory)
                                                   ├─ acks Telegram instantly,
                                                   │  then polls via DO *alarms*
                                                   ▼
                                   Anthropic Managed Agents API
                                   (Agent: NatureBuddy + prebuilt toolset:
                                    web_search, web_fetch, bash, read, …)
```

- **Webhook, not polling.** Telegram pushes updates to `/telegram/webhook`,
  verified by a secret header.
- **Durable Object per chat.** Holds the chat's long-lived agent session, so
  conversation memory is free. Because a research run can take minutes (far
  longer than a webhook may stay open), the DO acks Telegram in <1s and uses
  **DO alarms** to poll the session and stream replies back as they arrive.
- **Images.** A sent photo is downloaded from Telegram, uploaded via the Files
  API, mounted into the agent's container as a session resource, and read by the
  agent's `read` tool (which can view images).

## Files

| Path | Purpose |
|---|---|
| `src/index.ts` | Worker entry: routes, webhook auth, fan-out to the DO |
| `src/chat-session.ts` | Durable Object: per-chat session + alarm-driven run loop |
| `src/anthropic.ts` | Managed Agents REST client (sessions, events, files) |
| `src/telegram.ts` | Telegram Bot API client |
| `scripts/setup.mjs` | One-time: create the Agent + Environment, write IDs to `wrangler.jsonc` |
| `scripts/set-webhook.mjs` | Register / delete the Telegram webhook |

## Setup & deploy

Prereqs: Node 18+, a Cloudflare account, an Anthropic API key, a Telegram bot
token (from [@BotFather](https://t.me/BotFather)).

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

Then open Telegram, find your bot, send `/start`, and chat. Send a photo to get
an identification.

Useful: `npm run set-webhook -- --info` (inspect), `-- --delete` (remove).

## Local development

```bash
cp .dev.vars.example .dev.vars     # fill in real secrets (gitignored)
ANTHROPIC_API_KEY=sk-ant-... npm run setup
npm run dev                        # wrangler dev on http://127.0.0.1:8787
```

`/healthz` shows config. Simulate a Telegram update (the secret must match
`.dev.vars`):

```bash
curl -X POST http://127.0.0.1:8787/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: <TELEGRAM_SECRET_TOKEN>' \
  -d '{"update_id":1,"message":{"message_id":1,"chat":{"id":<YOUR_CHAT_ID>},"text":"What is a tardigrade?"}}'
```

To receive the reply on Telegram during local dev, use a real `chat.id` (message
the bot once and read it from `https://api.telegram.org/bot<token>/getUpdates`,
with the webhook unset) and expose `wrangler dev` over a tunnel.

## Configuration

Non-secret (`wrangler.jsonc` → `vars`, set by `npm run setup`):
`AGENT_ID`, `ENVIRONMENT_ID`, `ANTHROPIC_MODEL` (default
`claude-haiku-4-5-20251001`).

Secrets (`wrangler secret put` / `.dev.vars`): `ANTHROPIC_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN`.

Re-running `npm run setup` is idempotent: it reuses the Agent/Environment by
name and re-applies the system prompt, so edit the prompt in `scripts/setup.mjs`
and re-run to update the agent.

## Notes & limitations

- Replies are sent as plain text (no Telegram Markdown) to avoid parser errors
  on the agent's free-form prose.
- The DO polls one page of session events (`limit=1000`). A single chat's
  session would need ~100+ turns to approach that; for very long-lived chats,
  rotating the session would be the next step.
- Model is `claude-haiku-4-5-20251001` (per the testing requirement). Change
  `ANTHROPIC_MODEL` and re-run `npm run setup` to use a more capable model.
