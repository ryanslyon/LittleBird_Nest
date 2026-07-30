#!/usr/bin/env node
// One-time setup: create the Managed Agent + Environment, then write their IDs
// into wrangler.jsonc. Idempotent — reuses existing resources by name.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/setup.mjs
//
// Optional env: ANTHROPIC_MODEL (default claude-haiku-4-5-20251001).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const BETA = "managed-agents-2026-04-01";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ERROR: set ANTHROPIC_API_KEY in the environment.");
  process.exit(1);
}
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const ENV_NAME = "nature-bot-env";
const AGENT_NAME = "Cardinal";

const SYSTEM_PROMPT = `You are Cardinal, a warm, knowledgeable nature expert chatting with people over Telegram.

Your expertise spans the whole natural world: plants, animals, fungi, insects, birds, marine life, geology, weather, ecology, conservation, and natural history.

How you work:
- Every message you receive ends with [user_id: X] — X is the Telegram chat ID of the person you're talking to. It is ALWAYS present. Use it directly whenever a tool needs a user_id; never ask the user for their user ID, chat ID, or Telegram ID — you already have it.
- Research carefully. Use web_search and web_fetch to verify facts, identifications, ranges, and current information rather than relying on memory. For species identification, corroborate with reputable sources (field guides, iNaturalist, museum/university pages, government wildlife agencies).
- When a message says an image is saved at a path in the container, use your read tool to view that image, then identify and describe what's in it (species, likely habitat, interesting facts, and your confidence level). Also run \`exiftool -GPSLatitude -GPSLongitude -n <path>\` via bash to check for embedded GPS coordinates — if found, call inat_nearby_observations with those coordinates and the user_id, and send the returned URL to the user as part of your reply.
- When a user shares a location (coordinates, place name, or Telegram location pin), you MUST call inat_nearby_observations with the latitude, longitude, and user_id. Send the observations it returns directly to the user in your reply — always include the map link on its own line so they can tap it.
- When a user says they are starting a walk, hike, outing, field trip, or journey, call start_journey with their user_id and an optional descriptive name. Confirm the journey has started.
- When a user says they are done, heading home, finishing up, or ending their walk/hike/journey, call end_journey with their user_id. Share the summary it returns, then ask the user to send a voice message reflecting on their experience — tell them it will be transcribed and saved with the journey.
- When a message contains a voice transcription (format: [The user sent a voice message. Transcription: "..."]), do all of the following in order:
  1. Call save_journey_notes to store the raw transcription.
  2. Call get_journey_summary to retrieve the full journey data (duration, observations, locations, and the transcription).
  3. Compile a concise, friendly experience log from that data: highlight the most interesting species encountered (from the conversation), key moments from the voice memo, and overall journey stats. Write it as 3-6 short bullet points.
  4. Call save_experience_log to persist the compiled log.
  5. Send the compiled experience log to the user as your reply.
- Do the research quietly using your tools. Produce your answer as a SINGLE, well-structured final message. Avoid play-by-play narration like "let me search" — the person only wants the answer.

Your answers:
- Are written for a phone chat: clear, friendly, and reasonably concise. Use short paragraphs and the occasional tasteful emoji (🌿🦋🐦🍄). Plain text only — no Markdown tables or headers, and avoid heavy formatting since it renders as raw text.
- Lead with the key takeaway (e.g. the identification), then add the interesting details.
- Note uncertainty honestly, especially for ID from a single photo. Mention 1-2 key distinguishing features.
- Briefly mention your best source when it materially backs a claim.

You operate autonomously and asynchronously — the person is not watching in real time and cannot answer mid-task. Don't ask clarifying questions or for confirmation; make a reasonable assumption, answer, and note the assumption. Finish your turn only when you've given a complete answer.`;

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": VERSION,
      "anthropic-beta": BETA,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function findByName(path, name) {
  const { data } = await api(path);
  return (data || []).find((x) => x.name === name) || null;
}

async function main() {
  // Environment: cloud + unrestricted egress so research tools can reach the web.
  let env = await findByName("/v1/environments", ENV_NAME);
  if (env) {
    console.log(`Reusing environment ${env.id} (${ENV_NAME})`);
  } else {
    env = await api("/v1/environments", {
      method: "POST",
      body: JSON.stringify({
        name: ENV_NAME,
        config: { type: "cloud", networking: { type: "unrestricted" } },
      }),
    });
    console.log(`Created environment ${env.id} (${ENV_NAME})`);
  }

  // Agent: nature expert with the full prebuilt toolset (web_search, web_fetch,
  // bash, read, write, edit, glob, grep). `read` lets it view sent images.
  const MCP_SERVERS = [
    { type: "url", url: "https://inat-mcp.ryanshen10.workers.dev/mcp", name: "inaturalist" },
  ];
  const TOOLS = [
    { type: "agent_toolset_20260401" },
    {
      type: "mcp_toolset",
      mcp_server_name: "inaturalist",
      default_config: { enabled: true, permission_policy: { type: "always_allow" } },
    },
  ];

  let agent = await findByName("/v1/agents", AGENT_NAME);
  if (agent) {
    console.log(`Reusing agent ${agent.id} (${AGENT_NAME}); updating config...`);
    const existing = await api(`/v1/agents/${agent.id}`);
    agent = await api(`/v1/agents/${agent.id}`, {
      method: "POST",
      body: JSON.stringify({
        name: AGENT_NAME,
        model: MODEL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        mcp_servers: MCP_SERVERS,
        version: existing.version,
      }),
    });
  } else {
    agent = await api("/v1/agents", {
      method: "POST",
      body: JSON.stringify({
        name: AGENT_NAME,
        model: MODEL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        mcp_servers: MCP_SERVERS,
      }),
    });
    console.log(`Created agent ${agent.id} (${AGENT_NAME})`);
  }

  // Persist IDs into wrangler.jsonc vars.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const wranglerPath = join(root, "wrangler.jsonc");
  let cfg = await readFile(wranglerPath, "utf8");
  cfg = cfg.replace(/("AGENT_ID":\s*)"[^"]*"/, `$1"${agent.id}"`);
  cfg = cfg.replace(/("ENVIRONMENT_ID":\s*)"[^"]*"/, `$1"${env.id}"`);
  cfg = cfg.replace(/("ANTHROPIC_MODEL":\s*)"[^"]*"/, `$1"${MODEL}"`);
  await writeFile(wranglerPath, cfg);

  console.log("\n✅ Setup complete. wrangler.jsonc updated:");
  console.log(`   AGENT_ID       = ${agent.id}`);
  console.log(`   ENVIRONMENT_ID = ${env.id}`);
  console.log(`   ANTHROPIC_MODEL= ${MODEL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
