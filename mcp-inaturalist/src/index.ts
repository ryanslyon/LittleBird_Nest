import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}

const RADIUS_KM = 1.609; // 1 mile

interface InatTaxon {
  name?: string;
  preferred_common_name?: string;
  rank?: string;
  iconic_taxon_name?: string;
}

interface InatPhoto {
  url?: string;
}

interface InatObservation {
  id: number;
  taxon?: InatTaxon;
  observed_on?: string;
  place_guess?: string;
  quality_grade?: string;
  photos?: InatPhoto[];
  description?: string;
  uri?: string;
}

interface InatResponse {
  total_results: number;
  results: InatObservation[];
}

export class InatMCP extends McpAgent<Env, Record<string, never>, Record<string, never>> {
  server = new McpServer({ name: "inat-nearby", version: "1.0.0" });
  initialState = {};

  async init() {
    this.server.registerTool(
      "inat_nearby_observations",
      {
        description:
          "Look up recent plant and wildlife observations on iNaturalist within a 1-mile radius of a location. " +
          "Returns research-grade observations with species name, common name, date, and a link. " +
          "Use this when the user shares their location and wants to know what's been spotted nearby.",
        inputSchema: {
          latitude: z.number().describe("Latitude of the center point"),
          longitude: z.number().describe("Longitude of the center point"),
          taxon_name: z
            .string()
            .optional()
            .describe(
              "Optional: filter by taxon (e.g. 'Plantae' for plants, 'Aves' for birds, 'Insecta' for insects, or a specific species name)"
            ),
          per_page: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .default(20)
            .describe("Number of results to return (default 20, max 50)"),
        },
      },
      async ({ latitude, longitude, taxon_name, per_page = 20 }) => {
        const params = new URLSearchParams({
          lat: String(latitude),
          lng: String(longitude),
          radius: String(RADIUS_KM),
          per_page: String(per_page),
          order: "desc",
          order_by: "observed_on",
          quality_grade: "research",
        });
        if (taxon_name) params.set("taxon_name", taxon_name);

        let data: InatResponse;
        try {
          const res = await fetch(`https://api.inaturalist.org/v1/observations?${params}`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) {
            throw new Error(`iNaturalist API returned ${res.status}`);
          }
          data = (await res.json()) as InatResponse;
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error fetching iNaturalist data: ${String(err)}` }],
            isError: true,
          };
        }

        if (data.total_results === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No research-grade observations found within 1 mile of (${latitude}, ${longitude})${taxon_name ? ` for taxon "${taxon_name}"` : ""}.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `Found ${data.total_results} research-grade observation${data.total_results !== 1 ? "s" : ""} within 1 mile of (${latitude.toFixed(4)}, ${longitude.toFixed(4)})${taxon_name ? ` — filtered to "${taxon_name}"` : ""}. Showing ${data.results.length}:\n`,
        ];

        for (const obs of data.results) {
          const species = obs.taxon?.preferred_common_name
            ? `${obs.taxon.preferred_common_name} (${obs.taxon.name})`
            : (obs.taxon?.name ?? "Unknown species");
          const date = obs.observed_on ?? "date unknown";
          const place = obs.place_guess ? ` near ${obs.place_guess}` : "";
          const url = obs.uri ?? `https://www.inaturalist.org/observations/${obs.id}`;
          lines.push(`• ${species} — observed ${date}${place}\n  ${url}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return InatMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(request, env, ctx);
  },
};
