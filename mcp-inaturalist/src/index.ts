export interface Env {
  INAT_API_TOKEN: string;
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

async function fetchNearbyObservations(
  lat: number, lng: number, d1: string, token: string
): Promise<InatObs[]> {
  const qs = new URLSearchParams({
    lat: String(lat), lng: String(lng),
    radius: "1.6", d1,
    per_page: "3", order_by: "votes",
    quality_grade: "research,needs_id",
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

function photoUrl(obs: InatObs): string | null {
  const raw = obs.photos?.[0]?.url;
  if (!raw) return null;
  // iNaturalist photo URLs contain a size segment (square/small/medium/large/original).
  // Replace whatever size is present with "medium" (~500 px), good for Telegram.
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("iNaturalist MCP Server", { status: 200 });
    }

    const body = await request.json() as { method: string; id?: string | number; params?: Record<string, unknown> };
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
        return Response.json({
          jsonrpc: "2.0", id,
          result: {
            tools: [{
              name: "inat_nearby_observations",
              description:
                "Fetches recent nature observations near a location from iNaturalist " +
                "and returns a few examples plus a map link. Call this whenever the user " +
                "shares a location or GPS coordinates are extracted from a photo.",
              inputSchema: {
                type: "object",
                properties: {
                  latitude: { type: "number", description: "Latitude (decimal degrees)" },
                  longitude: { type: "number", description: "Longitude (decimal degrees)" },
                },
                required: ["latitude", "longitude"],
              },
            }],
          },
        });

      case "tools/call": {
        const args = (params as { arguments?: { latitude?: number; longitude?: number } })?.arguments ?? {};
        const { latitude, longitude } = args;
        if (latitude == null || longitude == null) {
          return Response.json({
            jsonrpc: "2.0", id,
            error: { code: -32602, message: "latitude and longitude are required" },
          });
        }

        const d1 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const mapUrl =
          `https://www.inaturalist.org/observations` +
          `?d1=${d1}&lat=${latitude}&lng=${longitude}&radius=0.05&subview=map`;

        let text: string;
        try {
          const obs = await fetchNearbyObservations(latitude, longitude, d1, env.INAT_API_TOKEN);
          if (obs.length > 0) {
            text = `Recent observations nearby:\n\n${formatObservations(obs)}\n\nFull map:\n${mapUrl}`;
          } else {
            text = `No observations found nearby in the past year.\n\nMap:\n${mapUrl}`;
          }
        } catch {
          text = mapUrl;
        }

        return Response.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text }] },
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
