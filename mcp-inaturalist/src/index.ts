export interface Env {
  INAT_API_TOKEN: string;
  DB: D1Database;
}

interface InatObs {
  id: number;
  observed_on?: string;
  taxon?: {
    name?: string;
    preferred_common_name?: string;
  };
  uri?: string;
  photos?: Array<{ url?: string }>;
}

// ── iNaturalist API ────────────────────────────────────────────────────────────

async function fetchObservations(
  lat: number, lng: number, d1: string, token: string, perPage = 20
): Promise<InatObs[]> {
  const qs = new URLSearchParams({
    lat: String(lat), lng: String(lng),
    radius: "0.03", d1,
    per_page: String(perPage), order_by: "votes",
    quality_grade: "research,needs_id",
    geoprivacy: "open",
    taxon_geoprivacy: "open",
  });
  const res = await fetch(`https://api.inaturalist.org/v1/observations?${qs}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "CardinalBot/1.0 (contact ryanshen10@gmail.com)",
    },
  });
  if (!res.ok) throw new Error(`iNaturalist API ${res.status}`);
  const data = await res.json() as { results?: InatObs[] };
  return data.results ?? [];
}

// ── D1 helpers ─────────────────────────────────────────────────────────────────

async function getSeenIds(db: D1Database, chatId: string): Promise<Set<number>> {
  const rows = await db
    .prepare("SELECT observation_id FROM seen_observations WHERE chat_id = ?")
    .bind(chatId)
    .all<{ observation_id: number }>();
  return new Set((rows.results ?? []).map(r => r.observation_id));
}

async function markSeen(
  db: D1Database, chatId: string, ids: number[],
  lat: number, lng: number, journeyId: number | null
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "(?, ?, ?, ?, ?, datetime('now'))").join(", ");
  const values = ids.flatMap(id => [chatId, id, lat, lng, journeyId]);
  await db
    .prepare(
      `INSERT OR IGNORE INTO seen_observations (chat_id, observation_id, latitude, longitude, journey_id, seen_at) VALUES ${placeholders}`
    )
    .bind(...values)
    .run();
}

async function getActiveJourneyId(db: D1Database, chatId: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM journeys WHERE chat_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .bind(chatId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function photoUrl(obs: InatObs): string | null {
  const raw = obs.photos?.[0]?.url;
  if (!raw) return null;
  return raw.replace(/\/(square|small|medium|large|original)\./, "/medium.");
}

function formatObservations(obs: InatObs[]): string {
  return obs.map(o => {
    const common = o.taxon?.preferred_common_name ?? o.taxon?.name ?? "Unknown species";
    const sci = o.taxon?.preferred_common_name && o.taxon?.name ? ` (${o.taxon.name})` : "";
    const date = o.observed_on ?? "unknown date";
    const link = o.uri ?? `https://www.inaturalist.org/observations/${o.id}`;
    const photo = photoUrl(o);
    const photoLine = photo ? `\n  [img:${photo}]` : "";
    return `• ${common}${sci} — ${date}\n  ${link}${photoLine}`;
  }).join("\n\n");
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "inat_nearby_observations",
    description:
      "Fetches recent iNaturalist observations within 100 ft of a location that this user has not " +
      "been shown before. Automatically links observations to the user's active journey if one exists. " +
      "Call whenever the user shares a location or GPS is extracted from a photo.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: { type: "number", description: "Latitude (decimal degrees)" },
        longitude: { type: "number", description: "Longitude (decimal degrees)" },
        user_id: { type: "string", description: "Telegram chat ID — filters already-seen observations and links to active journey" },
      },
      required: ["latitude", "longitude"],
    },
  },
  {
    name: "start_journey",
    description:
      "Starts a new nature journey for the user. A journey groups observations from a single outing " +
      "(walk, hike, field trip, etc.) together by time and location. Ends any previously active journey. " +
      "Call when the user says they are starting a walk, heading out, beginning a hike, or similar.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "Telegram chat ID" },
        name: { type: "string", description: "Optional name for this journey, e.g. 'Morning walk in Frick Park'" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "end_journey",
    description:
      "Ends the user's current active journey and returns a summary: name, duration, number of " +
      "observations, and locations visited. Call when the user says they are done, heading home, " +
      "finishing their walk, or ending their outing.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "Telegram chat ID" },
      },
      required: ["user_id"],
    },
  },
];

// ── Worker ─────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("iNaturalist MCP Server", { status: 200 });
    }

    const body = await request.json() as {
      method: string;
      id?: string | number;
      params?: Record<string, unknown>;
    };
    const { method, id, params } = body;

    switch (method) {
      case "initialize":
        return Response.json({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "inat-nearby", version: "1.0.0" },
          },
        });

      case "notifications/initialized":
        return new Response(null, { status: 202 });

      case "tools/list":
        return Response.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });

      case "tools/call": {
        const toolName = (params as { name?: string })?.name;
        const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};

        // ── inat_nearby_observations ──────────────────────────────────────────
        if (toolName === "inat_nearby_observations") {
          const { latitude, longitude, user_id } = args as {
            latitude?: number; longitude?: number; user_id?: string;
          };
          if (latitude == null || longitude == null) {
            return Response.json({
              jsonrpc: "2.0", id,
              error: { code: -32602, message: "latitude and longitude are required" },
            });
          }

          const d1Date = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
          const mapUrl =
            `https://www.inaturalist.org/observations` +
            `?d1=${d1Date}&lat=${latitude}&lng=${longitude}&radius=0.03&subview=map`;

          let text: string;
          try {
            const allObs = await fetchObservations(latitude, longitude, d1Date, env.INAT_API_TOKEN, 20);

            let newObs = allObs;
            let journeyId: number | null = null;

            if (user_id) {
              const seenIds = await getSeenIds(env.DB, user_id);
              newObs = allObs.filter(o => !seenIds.has(o.id));
              journeyId = await getActiveJourneyId(env.DB, user_id);
            }

            const toShow = newObs.slice(0, 3);

            if (user_id && toShow.length > 0) {
              await markSeen(env.DB, user_id, toShow.map(o => o.id), latitude, longitude, journeyId);
            }

            const journeyNote = journeyId ? " (logged to your active journey)" : "";
            if (toShow.length > 0) {
              text = `New observations nearby${journeyNote}:\n\n${formatObservations(toShow)}\n\nFull map:\n${mapUrl}`;
            } else if (allObs.length > 0) {
              text = `You've already seen all ${allObs.length} observations at this spot. Try a different location!\n\nMap:\n${mapUrl}`;
            } else {
              text = `No observations found within 100 ft in the past year.\n\nMap:\n${mapUrl}`;
            }
          } catch {
            text = mapUrl;
          }

          return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        }

        // ── start_journey ─────────────────────────────────────────────────────
        if (toolName === "start_journey") {
          const { user_id, name } = args as { user_id?: string; name?: string };
          if (!user_id) {
            return Response.json({
              jsonrpc: "2.0", id,
              error: { code: -32602, message: "user_id is required" },
            });
          }

          // Close any existing active journey
          await env.DB
            .prepare("UPDATE journeys SET ended_at = datetime('now') WHERE chat_id = ? AND ended_at IS NULL")
            .bind(user_id)
            .run();

          // Create new journey
          const result = await env.DB
            .prepare("INSERT INTO journeys (chat_id, name) VALUES (?, ?) RETURNING id, started_at")
            .bind(user_id, name ?? null)
            .first<{ id: number; started_at: string }>();

          const journeyName = name ?? "Unnamed journey";
          const text = `Journey started: "${journeyName}" (ID: ${result!.id})\nStarted at: ${result!.started_at} UTC\n\nObservations from this outing will be grouped together. Share a location to log what's nearby!`;

          return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        }

        // ── end_journey ───────────────────────────────────────────────────────
        if (toolName === "end_journey") {
          const { user_id } = args as { user_id?: string };
          if (!user_id) {
            return Response.json({
              jsonrpc: "2.0", id,
              error: { code: -32602, message: "user_id is required" },
            });
          }

          const journey = await env.DB
            .prepare("SELECT id, name, started_at FROM journeys WHERE chat_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
            .bind(user_id)
            .first<{ id: number; name: string | null; started_at: string }>();

          if (!journey) {
            return Response.json({
              jsonrpc: "2.0", id,
              result: { content: [{ type: "text", text: "No active journey found. Start one by saying 'begin a journey'." }] },
            });
          }

          await env.DB
            .prepare("UPDATE journeys SET ended_at = datetime('now') WHERE id = ?")
            .bind(journey.id)
            .run();

          const endedRow = await env.DB
            .prepare("SELECT ended_at FROM journeys WHERE id = ?")
            .bind(journey.id)
            .first<{ ended_at: string }>();

          const obsRows = await env.DB
            .prepare("SELECT COUNT(*) as count FROM seen_observations WHERE journey_id = ?")
            .bind(journey.id)
            .first<{ count: number }>();

          const locRows = await env.DB
            .prepare("SELECT DISTINCT latitude, longitude FROM seen_observations WHERE journey_id = ? AND latitude IS NOT NULL")
            .bind(journey.id)
            .all<{ latitude: number; longitude: number }>();

          const started = journey.started_at;
          const ended = endedRow?.ended_at ?? "";
          const obsCount = obsRows?.count ?? 0;
          const locationCount = (locRows.results ?? []).length;
          const journeyName = journey.name ?? "Unnamed journey";

          // Simple duration calc
          const startMs = new Date(started.replace(" ", "T") + "Z").getTime();
          const endMs = new Date(ended.replace(" ", "T") + "Z").getTime();
          const minutes = Math.round((endMs - startMs) / 60000);
          const duration = minutes < 60
            ? `${minutes} min`
            : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

          const text =
            `Journey ended: "${journeyName}"\n` +
            `Duration: ${duration}\n` +
            `Observations logged: ${obsCount}\n` +
            `Locations checked: ${locationCount}\n` +
            `Started: ${started} UTC\n` +
            `Ended: ${ended} UTC`;

          return Response.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
        }

        return Response.json({
          jsonrpc: "2.0", id: id ?? null,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      default:
        return Response.json({
          jsonrpc: "2.0", id: id ?? null,
          error: { code: -32601, message: "Method not found" },
        });
    }
  },
};
