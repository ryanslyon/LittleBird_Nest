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
                "Generates an iNaturalist map URL showing nature observations near a location " +
                "from the past year. Call this whenever the user shares a location or GPS " +
                "coordinates are extracted from a photo.",
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
        const url =
          `https://www.inaturalist.org/observations` +
          `?d1=${d1}&lat=${latitude}&lng=${longitude}&radius=0.05&subview=map`;
        return Response.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: url }] },
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
