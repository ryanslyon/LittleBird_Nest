#!/usr/bin/env node
// Registers the iNaturalist MCP server with the NatureBuddy Managed Agent.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const BETA = "managed-agents-2026-04-01";
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) { console.error("ERROR: set ANTHROPIC_API_KEY"); process.exit(1); }

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
  return JSON.parse(text);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(
  (await readFile(join(root, "wrangler.jsonc"), "utf8"))
    .replace(/\/\/[^\n]*/g, "")  // strip comments
    .replace(/,(\s*[}\]])/g, "$1") // strip trailing commas
);
const agentId = cfg.vars.AGENT_ID;

const existing = await api(`/v1/agents/${agentId}`);
console.log("Current mcp_servers:", JSON.stringify(existing.mcp_servers));

const mcpUrl = "https://inat-mcp.ryanshen10.workers.dev/mcp";
const alreadyAdded = (existing.mcp_servers || []).some(s => s.url === mcpUrl);

if (alreadyAdded) {
  console.log("MCP server already registered.");
} else {
  const updated = await api(`/v1/agents/${agentId}`, {
    method: "POST",
    body: JSON.stringify({
      name: existing.name,
      model: existing.model?.id,
      system: existing.system,
      tools: [
        ...(existing.tools || []),
        { type: "mcp_toolset", mcp_server_name: "inaturalist" },
      ],
      mcp_servers: [
        ...(existing.mcp_servers || []),
        { type: "url", url: mcpUrl, name: "inaturalist" },
      ],
      version: existing.version,
    }),
  });
  console.log("✅ MCP server registered. Agent version:", updated.version);
  console.log("   mcp_servers:", JSON.stringify(updated.mcp_servers));
}
