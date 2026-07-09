# Architecture

Cardinal is two independently deployable Cloudflare Workers:

1. **`nature-bot`** (repo root) — the Telegram-facing bot. Bridges Telegram to
   an Anthropic Managed Agent session.
2. **`inat-mcp`** (`mcp-inaturalist/`) — a stateless MCP server the agent calls
   as a tool to query iNaturalist observations and manage journeys.

```
Telegram  ──webhook──▶  Cloudflare Worker (nature-bot)  ──▶  Durable Object (one per chat)
                         (verify + route)                     │
                                                                ├─ maps chat → a persistent
                                                                │  Managed Agent *session*
                                                                │  (conversation memory)
                                                                ├─ acks Telegram instantly,
                                                                │  then polls via DO *alarms*
                                                                ▼
                                              Anthropic Managed Agents API
                                              (Agent: Cardinal + prebuilt toolset:
                                               web_search, web_fetch, bash, read, …
                                               + mcp_toolset → inat-mcp)
                                                                │
                                                                ▼
                                                  inat-mcp Worker (MCP over HTTP)
                                                  ──▶ iNaturalist API (JWT auth)
                                                  ──▶ D1 (seen observations, journeys)
```

## `nature-bot` (Telegram bridge)

- **Webhook, not polling.** Telegram pushes updates to `/telegram/webhook`,
  verified by a secret header (`x-telegram-bot-api-secret-token`).
- **Durable Object per chat.** Holds the chat's long-lived agent session, so
  conversation memory is free. Because a research run can take minutes (far
  longer than a webhook may stay open), the DO acks Telegram in <1s and uses
  **DO alarms** to poll the session and stream replies back as they arrive.
- **Images.** A sent photo is downloaded from Telegram, uploaded via the Files
  API, mounted into the agent's container as a session resource, and read by
  the agent's `read` tool (which can view images).
- **Location.** A shared Telegram location pin is forwarded to the agent as
  coordinates plus the sender's chat ID, which the agent uses to call the
  `inat_nearby_observations` MCP tool.
- **Voice.** A voice message is downloaded and transcribed via Workers AI
  Whisper (`@cf/openai/whisper`), then forwarded to the agent as text.
  Transcripts are deduplicated to filter out Whisper's tendency to loop short
  phrases on quiet/short audio (`deduplicateTranscript` in
  `src/chat-session.ts`).
- **Tool confirmation.** MCP tool calls default to requiring explicit
  approval; the bot auto-confirms (`always_allow` permission policy +
  `confirmToolUse`) so the agent can proceed without user interaction.
- **Access control.** `ALLOWED_CHAT_IDS` (comma-separated) gates who can use
  the bot; unauthorized chats are acked but silently dropped.

### Files

| Path | Purpose |
|---|---|
| `src/index.ts` | Worker entry: routes, webhook auth, fan-out to the DO |
| `src/chat-session.ts` | Durable Object: per-chat session + alarm-driven run loop, voice/location/image handling |
| `src/anthropic.ts` | Managed Agents REST client (sessions, events, files, tool confirmation) |
| `src/telegram.ts` | Telegram Bot API client |
| `src/access.ts` | Allowlist + per-chat rate limiting |
| `src/cursor.ts` | Event-cursor math for the poll loop |
| `scripts/setup.mjs` | Create/update the Agent + Environment, write IDs to `wrangler.jsonc` |
| `scripts/set-webhook.mjs` | Register / delete the Telegram webhook |
| `scripts/add-mcp.mjs` | Attach the MCP server to the agent |

## `inat-mcp` (MCP server)

A stateless HTTP JSON-RPC server (no SDK — the `@modelcontextprotocol/sdk`
adds an `execution.taskSupport` field to tool definitions that the Anthropic
platform can't parse, so this is a raw implementation). See
[docs/mcp-server.md](mcp-server.md) for the tool reference.

- Queries the iNaturalist API with a JWT bearer token (avoids Cloudflare's
  shared-IP rate limiting).
- Filters to `geoprivacy=open&taxon_geoprivacy=open` so sensitive-species
  coordinates (obscured to a ~22 km grid) don't leak into a 100 ft radius query.
- Tracks per-chat "seen" observations and journeys in D1 so repeat location
  checks only surface new sightings.

## Data model (D1: `inat-seen-obs`)

```sql
CREATE TABLE seen_observations (
  chat_id TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  latitude REAL,
  longitude REAL,
  journey_id INTEGER REFERENCES journeys(id),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, observation_id)
);

CREATE TABLE journeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  name TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  notes TEXT,           -- raw voice-memo transcription
  experience_log TEXT   -- agent-condensed summary of the journey
);
```

## Notes & limitations

- Replies are sent as plain text (no Telegram Markdown) to avoid parser errors
  on the agent's free-form prose.
- The DO polls one page of session events (`limit=1000`). A single chat's
  session would need ~100+ turns to approach that; for very long-lived chats,
  rotating the session would be the next step.
- Model is `claude-haiku-4-5-20251001` by default. Change `ANTHROPIC_MODEL`
  in `wrangler.jsonc` and re-run `npm run setup` to use a different model.
