interface InatObs {
  id: number;
  species_guess?: string;
  observed_on?: string;
  taxon?: {
    name?: string;
    common_name?: { name?: string };
  };
}

async function fetchNearbyObservations(lat: number, lng: number, d1: string): Promise<InatObs[]> {
  const qs = new URLSearchParams({
    d1, lat: String(lat), lng: String(lng),
    radius: "0.05", per_page: "3", order_by: "votes",
  });
  const res = await fetch(`https://www.inaturalist.org/observations.json?${qs}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CardinalBot/1.0 (contact ryanshen10@gmail.com)",
    },
  });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const data = await res.json() as InatObs[];
  return Array.isArray(data) ? data : [];
}

function formatObservations(obs: InatObs[]): string {
  return obs.map(o => {
    const name = o.taxon?.common_name?.name ?? o.species_guess ?? o.taxon?.name ?? "Unknown species";
    const sci = o.taxon?.name && o.taxon.name !== name ? ` (${o.taxon.name})` : "";
    const date = o.observed_on ?? "unknown date";
    const link = `https://www.inaturalist.org/observations/${o.id}`;
    return `• ${name}${sci} — ${date}\n  ${link}`;
  }).join("\n\n");
}

export default {
  async fetch(request: Request): Promise<Response> {
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
          const obs = await fetchNearbyObservations(latitude, longitude, d1);
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
