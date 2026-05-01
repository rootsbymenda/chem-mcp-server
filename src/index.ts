import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  DB: D1Database;
  MCP_OBJECT: DurableObjectNamespace;
}

export class ChemMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "twohalves-chemical-safety",
    version: "1.1.0",
  });

  async init() {
    // Tool 1: check_chemical — lookup by name or CAS number
    this.server.tool(
      "check_chemical",
      "Look up a chemical substance by name or CAS number. Returns SVHC status (EU Substances of Very High Concern), NIOSH occupational exposure data (REL, PEL, IDLH), GHS hazard classification, and cross-referenced safety data.",
      {
        query: z
          .string()
          .describe(
            "Chemical name or CAS number (e.g. 'bisphenol A', '80-05-7', 'formaldehyde')"
          ),
      },
      async ({ query }) => {
        const q = query.trim();

        // Check SVHC list
        const svhc = await this.env.DB.prepare(
          `SELECT * FROM echa_svhc
           WHERE substance_name LIKE ? COLLATE NOCASE
              OR cas_number = ?
              OR ec_number = ?
           LIMIT 1`
        )
          .bind(`%${q}%`, q, q)
          .first();

        // Check NIOSH data
        const niosh = await this.env.DB.prepare(
          `SELECT * FROM niosh_chemicals
           WHERE substance_name LIKE ? COLLATE NOCASE
              OR cas_number = ?
           LIMIT 1`
        )
          .bind(`%${q}%`, q)
          .first();

        // Check GHS classification
        const ghs = await this.env.DB.prepare(
          `SELECT * FROM ghs_classifications
           WHERE substance_name LIKE ? COLLATE NOCASE
              OR cas_number = ?
           LIMIT 1`
        )
          .bind(`%${q}%`, q)
          .first();

        // Also check if it exists in our cosmetics or food databases
        const cosmetic = await this.env.DB.prepare(
          `SELECT name, inci, cas, safety, eu_status, concern FROM ingredients
           WHERE name LIKE ? COLLATE NOCASE OR cas = ? COLLATE NOCASE
           LIMIT 1`
        )
          .bind(`%${q}%`, q)
          .first();

        const foodAdditive = await this.env.DB.prepare(
          `SELECT common_name, e_number, cas_number, safety_score, eu_status, health_concerns FROM food_additives
           WHERE common_name LIKE ? COLLATE NOCASE OR cas_number = ?
           LIMIT 1`
        )
          .bind(`%${q}%`, q)
          .first();

        if (!svhc && !niosh && !ghs && !cosmetic && !foodAdditive) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "not_found",
                  message: `No chemical safety data found for "${query}". Try searching by CAS number (e.g. '80-05-7') or exact chemical name.`,
                }),
              },
            ],
          };
        }

        const result: Record<string, unknown> = {
          query,
          svhc: svhc
            ? {
                status: "SUBSTANCE OF VERY HIGH CONCERN",
                name: svhc.substance_name,
                ec_number: svhc.ec_number,
                cas_number: svhc.cas_number,
                date_included: svhc.date_included,
                reason: svhc.reason,
              }
            : { status: "Not on SVHC list" },
          occupational_exposure: niosh
            ? {
                substance: niosh.substance_name,
                cas: niosh.cas_number,
                niosh_rel: niosh.niosh_rel,
                osha_pel: niosh.osha_pel,
                idlh: niosh.idlh,
                exposure_routes: niosh.exposure_routes,
                symptoms: niosh.symptoms,
                target_organs: niosh.target_organs,
              }
            : null,
          ghs_classification: ghs
            ? {
                signal_word: ghs.signal_word,
                hazard_statements: ghs.hazard_statements,
                pictograms: ghs.pictograms,
                h_codes: ghs.h_codes,
              }
            : null,
          cross_references: {
            in_cosmetics_db: cosmetic
              ? {
                  name: cosmetic.name,
                  inci: cosmetic.inci,
                  safety: cosmetic.safety,
                  eu_status: cosmetic.eu_status,
                  concern: cosmetic.concern,
                }
              : null,
            in_food_additives_db: foodAdditive
              ? {
                  name: foodAdditive.common_name,
                  e_number: foodAdditive.e_number,
                  safety_score: foodAdditive.safety_score,
                  eu_status: foodAdditive.eu_status,
                  concerns: foodAdditive.health_concerns,
                }
              : null,
          },
          source: "Two Halves — twohalves.ai",
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      }
    );

    // Tool 2: check_svhc_status — batch check substances against SVHC list
    this.server.tool(
      "check_svhc_list",
      "Check one or more chemical substances against the EU ECHA SVHC (Substances of Very High Concern) Candidate List. Returns which substances are flagged as SVHC and why (CMR, PBT, vPvB, endocrine disruptor).",
      {
        substances: z
          .string()
          .describe(
            "Comma-separated list of chemical names or CAS numbers to check against SVHC list"
          ),
      },
      async ({ substances }) => {
        const names = substances
          .split(/[,\n]+/)
          .map((n) => n.trim())
          .filter(Boolean);

        if (names.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "empty_list", message: "No substances provided." }),
              },
            ],
          };
        }

        const results = [];
        let flagged = 0;

        for (const name of names) {
          const svhc = await this.env.DB.prepare(
            `SELECT * FROM echa_svhc
             WHERE substance_name LIKE ? COLLATE NOCASE
                OR cas_number = ?
             LIMIT 1`
          )
            .bind(`%${name}%`, name)
            .first();

          if (svhc) {
            flagged++;
            results.push({
              input: name,
              svhc: true,
              name: svhc.substance_name,
              cas: svhc.cas_number,
              ec: svhc.ec_number,
              reason: svhc.reason,
              date_included: svhc.date_included,
            });
          } else {
            results.push({
              input: name,
              svhc: false,
            });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  total_checked: names.length,
                  svhc_flagged: flagged,
                  results,
                  note: "SVHC = Substance of Very High Concern under EU REACH regulation. Inclusion triggers authorization requirements.",
                  source: "ECHA Candidate List — Two Halves (twohalves.ai)",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool 3: search_chemicals — search across all chemical safety databases
    this.server.tool(
      "search_chemicals",
      "Search across chemical safety databases by keyword. Find chemicals by name, CAS number, hazard type, target organ, or symptom. Searches SVHC list, NIOSH data, GHS classifications, and cross-references cosmetics and food additive databases.",
      {
        query: z
          .string()
          .describe(
            "Search keyword (e.g. 'carcinogen', 'respiratory', 'liver', 'skin sensitizer', 'endocrine')"
          ),
        database: z
          .string()
          .optional()
          .describe(
            "Optional: limit search to 'svhc', 'niosh', 'ghs', or 'all' (default: all)"
          ),
        limit: z
          .number()
          .optional()
          .describe("Max results (1-25, default 10)"),
      },
      async ({ query, database, limit }) => {
        const maxResults = Math.min(Math.max(limit || 10, 1), 25);
        const db = database || "all";
        const results: Record<string, unknown>[] = [];

        if (db === "all" || db === "svhc") {
          const svhcResults = await this.env.DB.prepare(
            `SELECT substance_name, cas_number, ec_number, reason, date_included
             FROM echa_svhc
             WHERE substance_name LIKE ? COLLATE NOCASE
                OR reason LIKE ? COLLATE NOCASE
                OR cas_number LIKE ? COLLATE NOCASE
             LIMIT ?`
          )
            .bind(`%${query}%`, `%${query}%`, `%${query}%`, maxResults)
            .all();

          for (const r of svhcResults.results || []) {
            results.push({ source: "SVHC", ...r });
          }
        }

        if (db === "all" || db === "niosh") {
          const nioshResults = await this.env.DB.prepare(
            `SELECT substance_name, cas_number, niosh_rel, osha_pel, idlh, symptoms, target_organs
             FROM niosh_chemicals
             WHERE substance_name LIKE ? COLLATE NOCASE
                OR symptoms LIKE ? COLLATE NOCASE
                OR target_organs LIKE ? COLLATE NOCASE
                OR cas_number LIKE ? COLLATE NOCASE
             LIMIT ?`
          )
            .bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, maxResults)
            .all();

          for (const r of nioshResults.results || []) {
            results.push({ source: "NIOSH", ...r });
          }
        }

        if (db === "all" || db === "ghs") {
          const ghsResults = await this.env.DB.prepare(
            `SELECT substance_name, cas_number, signal_word, hazard_statements, h_codes
             FROM ghs_classifications
             WHERE substance_name LIKE ? COLLATE NOCASE
                OR hazard_statements LIKE ? COLLATE NOCASE
                OR h_codes LIKE ? COLLATE NOCASE
                OR cas_number LIKE ? COLLATE NOCASE
             LIMIT ?`
          )
            .bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, maxResults)
            .all();

          for (const r of ghsResults.results || []) {
            results.push({ source: "GHS", ...r });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  query,
                  database: db,
                  count: results.length,
                  results: results.slice(0, maxResults),
                  source: "Two Halves — twohalves.ai",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  }
}

// Worker entry point
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Smithery's MCP client POSTs initialize to root `/` instead of `/mcp`.
    // Rewrite URL pathname to /mcp so ChemMCP.serve("/mcp") matches the route.
    if (request.method === "POST" && url.pathname === "/") {
      const mcpUrl = new URL(request.url);
      mcpUrl.pathname = "/mcp";
      const mcpRequest = new Request(mcpUrl.toString(), request);
      return ChemMCP.serve("/mcp").fetch(mcpRequest, env, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          name: "Two Halves Chemical Safety MCP Server",
          version: "1.1.0",
          status: "healthy",
          tools: [
            "check_chemical",
            "check_svhc_list",
            "search_chemicals",
          ],
          data: {
            echa_svhc: "253 substances of very high concern",
            niosh_chemicals: "677 occupational safety profiles (REL/PEL/IDLH, NIOSH Pocket Guide)",
            ghs_classifications: "468,165 GHS hazard classifications (PubChem)",
            cross_references: "30,553 cosmetic ingredients + 6,450 food additives",
          },
          docs: "https://twohalves.ai",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return Response.json({
        "$schema": "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
        "version": "1.0",
        "protocolVersion": "2025-06-18",
        "serverInfo": { "name": "chem-mcp-server", "title": "Two Halves Chemical Safety MCP Server", "version": "1.1.0" },
        "description": "Chemical safety MCP — SVHC, GHS, NIOSH OEL aggregated",
        "iconUrl": "https://rootsbybenda.com/icon.png",
        "documentationUrl": "https://rootsbybenda.com",
        "transport": { "type": "streamable-http", "endpoint": "/mcp" },
        "capabilities": { "tools": { "listChanged": true }, "resources": { "subscribe": false, "listChanged": false } },
        "authentication": { "required": false, "schemes": ["bearer"] },
        "tools": [
          { "name": "check_chemical", "description": "Look up a chemical substance by name or CAS number. Returns SVHC status, NIOSH occupational exposure data, GHS hazard classification, and cross-referenced safety data." },
          { "name": "check_svhc_list", "description": "Check one or more chemical substances against the EU ECHA SVHC Candidate List." },
          { "name": "search_chemicals", "description": "Search across chemical safety databases by keyword — SVHC, NIOSH, GHS, cosmetics, and food additives." }
        ]
      }, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    }

    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
      return ChemMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return ChemMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
