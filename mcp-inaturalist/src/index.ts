import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}

export class InatMCP extends McpAgent<Env, Record<string, never>, Record<string, never>> {
  server = new McpServer({ name: "inat-nearby", version: "1.0.0" });
  initialState = {};

  async init() {
    this.server.registerTool(
      "inat_nearby_observations",
      {
        description:
          "Generates an iNaturalist map URL showing observations near a location from the past year. " +
          "Use this when the user shares a location or when GPS coordinates are extracted from a photo. " +
          "If the user sends a photo, first extract GPS coordinates from the image EXIF data using bash " +
          "(e.g. `exiftool -GPSLatitude -GPSLongitude -n <image_path>`) and pass them here.",
        inputSchema: {
          latitude: z.number().describe("Latitude of the location (decimal degrees)"),
          longitude: z.number().describe("Longitude of the location (decimal degrees)"),
        },
      },
      async ({ latitude, longitude }) => {
        // d1 = one year before today in YYYY-MM-DD format
        const d1 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const url =
          `https://www.inaturalist.org/observations` +
          `?d1=${d1}` +
          `&lat=${latitude}` +
          `&lng=${longitude}` +
          `&radius=0.05` +
          `&subview=map`;

        const text =
          `Here are iNaturalist observations near (${latitude}, ${longitude}) from the past year:\n` +
          `${url}\n\n` +
          `This map shows all observations within ~50 meters of that location since ${d1}.`;

        return { content: [{ type: "text" as const, text }] };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return InatMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
  },
};
