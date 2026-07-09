# iNaturalist MCP Server (`mcp-inaturalist/`)

A stateless MCP server, deployed as its own Cloudflare Worker, exposed to the
Cardinal agent as an `mcp_toolset`. See
[docs/architecture.md](architecture.md) for how it fits into the overall
system.

## Tools

| Tool | Purpose |
|---|---|
| `inat_nearby_observations` | Fetches recent iNaturalist observations within 100 ft of a given lat/lng that this user hasn't been shown before. Auto-links results to the user's active journey, if any. |
| `start_journey` | Starts a new journey for the user, grouping subsequent observations by time and location. Ends any previously active journey. |
| `end_journey` | Ends the user's active journey and returns a summary (duration, observation count, locations visited). |
| `save_journey_notes` | Saves a raw voice-memo transcription to the user's most recent journey. |
| `get_journey_summary` | Retrieves full journey data (stats + transcription) so the agent can compile a condensed experience log. |
| `save_experience_log` | Saves the agent-compiled experience log to the most recent journey. |

## Request flow

`tools/call` → `env.INAT_API_TOKEN` (JWT bearer) → `api.inaturalist.org/v1/observations`
with `geoprivacy=open&taxon_geoprivacy=open` and a `radius=0.03` (~100 ft)
window, filtered against `seen_observations` in D1 so repeat checks at the
same spot only surface new sightings.

## Deploy

```bash
cd mcp-inaturalist
npm install
npx wrangler d1 execute inat-seen-obs --remote --command "<schema DDL, see docs/architecture.md>"
npx wrangler secret put INAT_API_TOKEN   # iNaturalist JWT — never commit this
npm run deploy
```

After deploying, re-run `npm run setup` from the repo root so the agent picks
up any tool/description changes (tool discovery happens at session runtime,
not at agent-config time — the Anthropic console's tool list for an
`mcp_toolset` may show empty even when the tools work correctly).

## Security note

The iNaturalist JWT (`INAT_API_TOKEN`) and any account credentials must be
stored as Worker secrets only, never committed to the repo or hardcoded in
source.
