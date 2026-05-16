import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  DB: D1Database;
  MCP_OBJECT: DurableObjectNamespace;
  // Optional auth env. When configured, validates Bearer tokens for per-user rate limiting.
  MCP_KEY_SECRET?: string;
}

// --- Auth: HMAC-validated MCP key ---
// MCP keys are issued by rootsbybenda-site/functions/api/mcp-key.js using the
// SAME MCP_KEY_SECRET. Format: mcp_<base64url(user_id)>_<sha256_hmac[:32]>.

interface AuthProps extends Record<string, unknown> {
  user_id: string | null;
  authenticated: boolean;
}

function base64urlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  return atob(padded);
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function resolveAuth(request: Request, env: Env): Promise<AuthProps> {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(mcp_[A-Za-z0-9_-]+_[a-f0-9]{32})\s*$/i);
  if (!match) return { user_id: null, authenticated: false };

  const key = match[1];
  const parts = key.split("_");
  if (parts.length !== 3 || parts[0] !== "mcp") {
    return { user_id: null, authenticated: false };
  }
  const userIdB64 = parts[1];
  const providedHmac = parts[2].toLowerCase();

  if (!env.MCP_KEY_SECRET) {
    console.error("resolveAuth: MCP_KEY_SECRET not configured");
    return { user_id: null, authenticated: false };
  }

  let userId: string;
  try {
    userId = base64urlDecodeToString(userIdB64);
  } catch {
    return { user_id: null, authenticated: false };
  }
  if (!userId) return { user_id: null, authenticated: false };

  const computed = (await hmacSha256Hex(userId, env.MCP_KEY_SECRET)).slice(0, 32);
  if (!constantTimeEqual(computed, providedHmac)) {
    return { user_id: null, authenticated: false };
  }

  return { user_id: userId, authenticated: true };
}
// --- End auth ---

const SERVER_VERSION = "1.1.0";
const HOMEPAGE = "https://rootsbybenda.com";
const SOURCE = "Roots by Benda \u2014 rootsbybenda.com";
const CONTACT = "SBD@effortlessai.ai";
const SERVER_NAME = "Roots by Benda \u2014 Chemical Intelligence";
const SERVER_DESCRIPTION =
  "Check chemical hazards across SVHC, GHS, NIOSH, ICSC, cosmetics, and food.";
const DATA_CATALOG = {
  echa_svhc: "253",
  niosh_pocket_guide: "677",
  ghs_classifications: "468,165",
  substance_identifiers: "73,252",
  icsc_chemicals: "ICSC chemical safety cards by CAS number",
  cross_references: "30,553 cosmetic ingredients + 6,450 food additives"
};
const TOOL_CATALOG = [
  {
    name: "check_chemical",
    description: "Check chemical hazard and regulatory records by substance name or CAS number. Use when the user asks if a chemical is SVHC-listed, NIOSH-listed, GHS-classified, ICSC-covered, occupationally hazardous, or relevant to cosmetic/food safety cross-references. Do not use for batch SVHC screening, broad hazard discovery without a substance name, cosmetic formula checks, food additive safety, or drug interaction questions. The response includes identifiers, ECHA SVHC status, NIOSH REL/PEL/IDLH data, GHS classifications, ICSC safety-card fields, and cosmetic/food cross-reference matches."
  },
  {
    name: "check_svhc_list",
    description: "Screen a list of substances against the EU ECHA SVHC Candidate List. Use when the user provides multiple chemical names or CAS numbers and asks which are SVHCs, REACH candidates, restricted substances, or substances of very high concern. Do not use for one-off full hazard profiles, NIOSH/GHS/ICSC exploration, or non-EU regulatory questions that are not SVHC checks. The response includes per-substance match status, resolved identifiers, SVHC inclusion details, reason fields, dates, and source links where available."
  },
  {
    name: "search_chemicals",
    description: "Search chemical safety datasets by hazard keyword, exposure route, organ effect, or regulatory concept. Use when the user asks for chemicals related to carcinogenicity, respiratory effects, liver toxicity, skin sensitization, endocrine activity, GHS phrases, NIOSH topics, or SVHC categories. Do not use when the user has a single exact substance to profile or a list to screen only for SVHC status. The response includes ranked matches from SVHC, NIOSH, GHS, and ICSC sources with dataset labels, identifiers, hazard snippets, and source-specific fields."
  }
];

function registryMetadata() {
  return {
    name: SERVER_NAME,
    description: SERVER_DESCRIPTION,
    version: SERVER_VERSION,
    mcp_endpoint: "/mcp",
    tools: TOOL_CATALOG,
    data: DATA_CATALOG,
    homepage: HOMEPAGE,
    source: SOURCE,
    contact: CONTACT,
  };
}


type DbRow = Record<string, any>;

interface LookupContext {
  warnings: string[];
}

const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_INPUT_LENGTH = 200;
const MAX_NAME_LENGTH = 50;
const MAX_BATCH_SUBSTANCES = 50;
const MAX_BATCH_INPUT_LENGTH = 4_000;
const DEFAULT_LIMIT = 10;
const MAX_SEARCH_RESULTS = 25;
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CHEM_DATABASES = ["all", "svhc", "niosh", "ghs", "icsc"] as const;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_PER_MINUTE) return false;
  return true;
}

function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded. Maximum 60 requests per minute." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}
const SELFTEST_CAS = "50-00-0";
const SELFTEST_NAME = "formaldehyde";
const CAS_RE = /^\d{1,7}-\d{2}-\d$/;

function normalizeQuery(input: string, maxLength = MAX_QUERY_LENGTH): string {
  return input.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function likePattern(input: string): string {
  return `%${escapeLike(input)}%`;
}

function isCasNumber(input: string): boolean {
  return CAS_RE.test(input);
}

function genericDbWarning(label: string): string {
  return `${label}_lookup_unavailable`;
}

async function safeFirst(
  env: Env,
  ctx: LookupContext,
  label: string,
  sql: string,
  ...binds: unknown[]
): Promise<DbRow | null> {
  try {
    const row = await env.DB.prepare(sql).bind(...binds).first<DbRow>();
    return row ?? null;
  } catch {
    ctx.warnings.push(genericDbWarning(label));
    return null;
  }
}

async function safeAll(
  env: Env,
  ctx: LookupContext,
  label: string,
  sql: string,
  ...binds: unknown[]
): Promise<DbRow[]> {
  try {
    const result = await env.DB.prepare(sql).bind(...binds).all<DbRow>();
    return result.results ?? [];
  } catch {
    ctx.warnings.push(genericDbWarning(label));
    return [];
  }
}

function jsonToolResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function chemicalDetailUrl(casNumber: unknown): string | null {
  const cas = typeof casNumber === "string" ? casNumber.trim() : "";
  return cas ? `https://rootsbybenda.com/chemicals/${encodeURIComponent(cas)}` : null;
}

async function lookupCrosswalkByCas(env: Env, ctx: LookupContext, cas: string): Promise<DbRow | null> {
  return safeFirst(
    env,
    ctx,
    "substance_identifiers",
    `SELECT cas_number, inci_name, common_name, pubchem_cid, ec_number, inchikey, smiles,
            molecular_formula, molecular_weight, chebi_id, unii, wikidata_qid, iupac_name
       FROM substance_identifiers
      WHERE cas_number = ?
      LIMIT 1`,
    cas
  );
}

async function lookupCrosswalkByName(env: Env, ctx: LookupContext, query: string): Promise<DbRow | null> {
  const pattern = likePattern(query);
  return safeFirst(
    env,
    ctx,
    "substance_identifiers",
    `SELECT cas_number, inci_name, common_name, pubchem_cid, ec_number, inchikey, smiles,
            molecular_formula, molecular_weight, chebi_id, unii, wikidata_qid, iupac_name
       FROM substance_identifiers
      WHERE inci_name COLLATE NOCASE LIKE ? ESCAPE '\\'
         OR common_name COLLATE NOCASE LIKE ? ESCAPE '\\'
      ORDER BY
        CASE
          WHEN inci_name = ? COLLATE NOCASE THEN 0
          WHEN common_name = ? COLLATE NOCASE THEN 1
          ELSE 2
        END
      LIMIT 1`,
    pattern,
    pattern,
    query,
    query
  );
}

async function lookupCosmeticByQuery(env: Env, ctx: LookupContext, query: string, cas: string | null): Promise<DbRow | null> {
  if (cas) {
    const byCas = await safeFirst(
      env,
      ctx,
      "ingredients",
      `SELECT name, inci, cas, safety, eu_status, concern
         FROM ingredients
        WHERE cas = ? COLLATE NOCASE
        LIMIT 1`,
      cas
    );
    if (byCas) return byCas;
  }

  const pattern = likePattern(query);
  return safeFirst(
    env,
    ctx,
    "ingredients",
    `SELECT name, inci, cas, safety, eu_status, concern
       FROM ingredients
      WHERE name COLLATE NOCASE LIKE ? ESCAPE '\\'
         OR inci COLLATE NOCASE LIKE ? ESCAPE '\\'
      LIMIT 1`,
    pattern,
    pattern
  );
}

async function lookupFoodAdditiveByQuery(env: Env, ctx: LookupContext, query: string, cas: string | null): Promise<DbRow | null> {
  if (cas) {
    const byCas = await safeFirst(
      env,
      ctx,
      "food_additives",
      `SELECT common_name, e_number, cas_number, safety_score, eu_status, health_concerns
         FROM food_additives
        WHERE cas_number = ?
        LIMIT 1`,
      cas
    );
    if (byCas) return byCas;
  }

  const pattern = likePattern(query);
  return safeFirst(
    env,
    ctx,
    "food_additives",
    `SELECT common_name, e_number, cas_number, safety_score, eu_status, health_concerns
       FROM food_additives
      WHERE common_name COLLATE NOCASE LIKE ? ESCAPE '\\'
      LIMIT 1`,
    pattern
  );
}

async function lookupNioshByCas(env: Env, ctx: LookupContext, cas: string): Promise<DbRow | null> {
  return safeFirst(
    env,
    ctx,
    "niosh_pocket_guide",
    `SELECT chemical_name, cas_number, rel, pel, idlh, exposure_routes, symptoms,
            target_organs, health_hazards, physical_description, synonyms
       FROM niosh_pocket_guide
      WHERE cas_number = ?
      LIMIT 1`,
    cas
  );
}

async function lookupNioshByName(env: Env, ctx: LookupContext, query: string): Promise<DbRow | null> {
  const pattern = likePattern(query);
  return safeFirst(
    env,
    ctx,
    "niosh_pocket_guide",
    `SELECT chemical_name, cas_number, rel, pel, idlh, exposure_routes, symptoms,
            target_organs, health_hazards, physical_description, synonyms
       FROM niosh_pocket_guide
      WHERE chemical_name COLLATE NOCASE LIKE ? ESCAPE '\\'
         OR synonyms COLLATE NOCASE LIKE ? ESCAPE '\\'
      LIMIT 1`,
    pattern,
    pattern
  );
}

async function lookupSvhcByCas(env: Env, ctx: LookupContext, cas: string): Promise<DbRow | null> {
  return safeFirst(
    env,
    ctx,
    "echa_svhc",
    `SELECT substance_name, ec_number, cas_number, date_included, reason
       FROM echa_svhc
      WHERE cas_number = ?
      LIMIT 1`,
    cas
  );
}

async function lookupIcscByCas(env: Env, ctx: LookupContext, cas: string): Promise<DbRow | null> {
  return safeFirst(
    env,
    ctx,
    "icsc_chemicals",
    `SELECT ghs_pictograms, ghs_signal_word, ghs_hazard_statements,
            effects_short_term, effects_long_term, routes_of_exposure
       FROM icsc_chemicals
      WHERE cas_number = ?
      LIMIT 1`,
    cas
  );
}

async function lookupGhsByCrosswalk(env: Env, ctx: LookupContext, crosswalk: DbRow | null): Promise<DbRow | null> {
  if (!crosswalk) return null;

  if (crosswalk.ec_number) {
    const byEc = await safeFirst(
      env,
      ctx,
      "ghs_classifications",
      `SELECT pictograms, signal_word, hazard_statements, source_name
         FROM ghs_classifications
        WHERE ec_number = ?
        LIMIT 1`,
      crosswalk.ec_number
    );
    if (byEc) {
      return { ...byEc, matched_by: "ec_number", matched_identifier: crosswalk.ec_number };
    }
  }

  if (crosswalk.pubchem_cid) {
    const byCid = await safeFirst(
      env,
      ctx,
      "ghs_classifications",
      `SELECT pictograms, signal_word, hazard_statements, source_name
         FROM ghs_classifications
        WHERE pubchem_cid = ?
        LIMIT 1`,
      String(crosswalk.pubchem_cid)
    );
    if (byCid) {
      return { ...byCid, matched_by: "pubchem_cid", matched_identifier: String(crosswalk.pubchem_cid) };
    }
  }

  return null;
}

async function resolveChemical(env: Env, ctx: LookupContext, query: string) {
  if (isCasNumber(query)) {
    const crosswalk = await lookupCrosswalkByCas(env, ctx, query);
    return { cas: query, crosswalk };
  }

  const crosswalk = await lookupCrosswalkByName(env, ctx, query);
  if (crosswalk?.cas_number) {
    return { cas: String(crosswalk.cas_number), crosswalk };
  }

  const niosh = await lookupNioshByName(env, ctx, query);
  if (niosh?.cas_number) {
    const cas = String(niosh.cas_number);
    return { cas, crosswalk: await lookupCrosswalkByCas(env, ctx, cas) };
  }

  const cosmetic = await lookupCosmeticByQuery(env, ctx, query, null);
  if (cosmetic?.cas) {
    const cas = String(cosmetic.cas);
    return { cas, crosswalk: await lookupCrosswalkByCas(env, ctx, cas) };
  }

  const foodAdditive = await lookupFoodAdditiveByQuery(env, ctx, query, null);
  if (foodAdditive?.cas_number) {
    const cas = String(foodAdditive.cas_number);
    return { cas, crosswalk: await lookupCrosswalkByCas(env, ctx, cas) };
  }

  return { cas: null, crosswalk: null };
}

async function checkChemicalData(env: Env, rawQuery: string) {
  const query = normalizeQuery(rawQuery);
  const ctx: LookupContext = { warnings: [] };

  if (!query) {
    return {
      error: "empty_query",
      message: "No chemical name or CAS number provided.",
    };
  }

  const resolved = await resolveChemical(env, ctx, query);
  const cas = resolved.cas;

  const [svhc, niosh, ghs, icsc, cosmetic, foodAdditive] = await Promise.all([
    cas ? lookupSvhcByCas(env, ctx, cas) : Promise.resolve(null),
    cas ? lookupNioshByCas(env, ctx, cas) : lookupNioshByName(env, ctx, query),
    lookupGhsByCrosswalk(env, ctx, resolved.crosswalk),
    cas ? lookupIcscByCas(env, ctx, cas) : Promise.resolve(null),
    lookupCosmeticByQuery(env, ctx, query, cas),
    lookupFoodAdditiveByQuery(env, ctx, query, cas),
  ]);

  if (!svhc && !niosh && !ghs && !icsc && !cosmetic && !foodAdditive) {
    return {
      error: "not_found",
      query,
      resolved_cas: cas,
      detail_url: chemicalDetailUrl(cas),
      message: `No chemical safety data found for "${query}". Try searching by CAS number (e.g. "80-05-7") or exact chemical name.`,
      data_warnings: [...new Set(ctx.warnings)],
    };
  }

  return {
    query,
    resolved_cas: cas,
    detail_url: chemicalDetailUrl(cas),
    crosswalk: resolved.crosswalk
      ? {
          cas_number: resolved.crosswalk.cas_number,
          inci_name: resolved.crosswalk.inci_name,
          common_name: resolved.crosswalk.common_name,
          ec_number: resolved.crosswalk.ec_number,
          pubchem_cid: resolved.crosswalk.pubchem_cid,
          inchikey: resolved.crosswalk.inchikey,
        }
      : null,
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
          substance: niosh.chemical_name,
          cas: niosh.cas_number,
          niosh_rel: niosh.rel,
          osha_pel: niosh.pel,
          idlh: niosh.idlh,
          exposure_routes: niosh.exposure_routes,
          symptoms: niosh.symptoms,
          target_organs: niosh.target_organs,
          health_hazards: niosh.health_hazards,
          physical_description: niosh.physical_description,
        }
      : null,
    ghs_classification: ghs
      ? {
          signal_word: ghs.signal_word,
          hazard_statements: ghs.hazard_statements,
          pictograms: ghs.pictograms,
          source_name: ghs.source_name,
          matched_by: ghs.matched_by,
          matched_identifier: ghs.matched_identifier,
        }
      : null,
    icsc: icsc
      ? {
          ghs_signal_word: icsc.ghs_signal_word,
          ghs_hazard_statements: icsc.ghs_hazard_statements,
          ghs_pictograms: icsc.ghs_pictograms,
          effects_short_term: icsc.effects_short_term,
          effects_long_term: icsc.effects_long_term,
          routes_of_exposure: icsc.routes_of_exposure,
        }
      : null,
    cross_references: {
      in_cosmetics_db: cosmetic
        ? {
            name: cosmetic.name,
            inci: cosmetic.inci,
            cas: cosmetic.cas,
            safety: cosmetic.safety,
            eu_status: cosmetic.eu_status,
            concern: cosmetic.concern,
          }
        : null,
      in_food_additives_db: foodAdditive
        ? {
            name: foodAdditive.common_name,
            e_number: foodAdditive.e_number,
            cas: foodAdditive.cas_number,
            safety_score: foodAdditive.safety_score,
            eu_status: foodAdditive.eu_status,
            concerns: foodAdditive.health_concerns,
          }
        : null,
    },
    data_warnings: [...new Set(ctx.warnings)],
    source: "Roots by Benda — rootsbybenda.com",
  };
}

async function runSelftest(env: Env) {
  const result = await checkChemicalData(env, SELFTEST_NAME);
  const payload = result as Record<string, any>;
  const hasRealData = Boolean(
    payload.resolved_cas === SELFTEST_CAS &&
      (payload.occupational_exposure || payload.ghs_classification || payload.icsc || payload.svhc?.status === "SUBSTANCE OF VERY HIGH CONCERN")
  );
  const ok = !payload.error && hasRealData;

  return {
    ok,
    status: ok ? "pass" : "fail",
    query: SELFTEST_NAME,
    expected_cas: SELFTEST_CAS,
    resolved_cas: payload.resolved_cas ?? null,
    found: {
      svhc: payload.svhc?.status === "SUBSTANCE OF VERY HIGH CONCERN",
      niosh: Boolean(payload.occupational_exposure),
      ghs: Boolean(payload.ghs_classification),
      icsc: Boolean(payload.icsc),
      crosswalk: Boolean(payload.crosswalk),
    },
    data_warnings: payload.data_warnings ?? [],
  };
}

export class ChemMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "roots-chemical-safety",
    version: SERVER_VERSION,
  });

  async init() {
    this.server.tool(
      "check_chemical",
      TOOL_CATALOG[0].description,
      {
        query: z
          .string()
          .trim()
          .min(1)
          .max(MAX_QUERY_INPUT_LENGTH)
          .describe(
            "Chemical common name, technical substance name, synonym, or CAS number (Chemical Abstracts Service registry number, e.g. '80-05-7'). Use CAS when available for exact matching across ECHA SVHC, NIOSH, GHS, and ICSC records."
          ),
      },
      async ({ query }) => jsonToolResponse(await checkChemicalData(this.env, query))
    );

    this.server.tool(
      "check_svhc_list",
      TOOL_CATALOG[1].description,
      {
        substances: z
          .string()
          .trim()
          .min(1)
          .max(MAX_BATCH_INPUT_LENGTH)
          .describe(
            "Comma-separated or newline-separated list of chemical names or CAS numbers to screen against the EU ECHA SVHC Candidate List. Include CAS numbers when available because SVHC names may have salts, isomers, or synonym variants."
          ),
      },
      async ({ substances }) => {
        const ctx: LookupContext = { warnings: [] };
        const names = substances
          .split(/[,\n]+/)
          .map((n) => normalizeQuery(n, MAX_NAME_LENGTH))
          .filter(Boolean);

        if (names.length === 0) {
          return jsonToolResponse({ error: "empty_list", message: "No substances provided." });
        }
        if (names.length > MAX_BATCH_SUBSTANCES) {
          return jsonToolResponse({
            error: "too_many",
            message: `Maximum ${MAX_BATCH_SUBSTANCES} substances per request. Split into multiple calls.`,
          });
        }

        const results = [];
        let flagged = 0;

        for (const name of names) {
          const resolved = await resolveChemical(this.env, ctx, name);
          const svhc = resolved.cas ? await lookupSvhcByCas(this.env, ctx, resolved.cas) : null;

          if (svhc) {
            flagged++;
            results.push({
              input: name,
              resolved_cas: resolved.cas,
              detail_url: chemicalDetailUrl(svhc.cas_number),
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
              resolved_cas: resolved.cas,
              detail_url: chemicalDetailUrl(resolved.cas),
              svhc: false,
            });
          }
        }

        return jsonToolResponse({
          total_checked: names.length,
          svhc_flagged: flagged,
          results,
          data_warnings: [...new Set(ctx.warnings)],
          note: "SVHC = Substance of Very High Concern under EU REACH regulation. Inclusion triggers authorization requirements.",
          source: "ECHA Candidate List — Roots by Benda (rootsbybenda.com)",
        });
      }
    );

    this.server.tool(
      "search_chemicals",
      TOOL_CATALOG[2].description,
      {
        query: z
          .string()
          .trim()
          .min(1)
          .max(MAX_QUERY_INPUT_LENGTH)
          .describe(
            "Hazard, endpoint, organ system, exposure route, regulatory phrase, or chemical keyword (e.g. 'carcinogen', 'respiratory', 'liver', 'skin sensitizer', 'endocrine'). Use this for discovery across SVHC, NIOSH, GHS, and ICSC data, not exact substance lookup."
          ),
        database: z
          .enum(CHEM_DATABASES)
          .optional()
          .describe(
            "Optional dataset filter. Use 'svhc' for ECHA Candidate List records, 'niosh' for occupational exposure profiles, 'ghs' for hazard classifications, 'icsc' for safety cards, or 'all' for cross-dataset discovery."
          ),
        limit: z
          .number()
          .finite()
          .min(1)
          .max(MAX_SEARCH_RESULTS)
          .optional()
          .describe("Maximum number of chemical records to return (1-25, default 10). Use lower limits for precise regulatory phrases and higher limits for broad hazard discovery."),
      },
      async ({ query, database, limit }) => {
        const ctx: LookupContext = { warnings: [] };
        const q = normalizeQuery(query);
        const maxResults = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_SEARCH_RESULTS);
        const db = database || "all";
        const pattern = likePattern(q);
        const results: Record<string, unknown>[] = [];
        const resolved = q ? await resolveChemical(this.env, ctx, q) : { cas: null, crosswalk: null };

        if (!q) {
          return jsonToolResponse({ error: "empty_query", message: "No search query provided." });
        }

        if (db === "all" || db === "svhc") {
          const svhcResults = isCasNumber(q)
            ? await safeAll(
                this.env,
                ctx,
                "echa_svhc",
                `SELECT substance_name, cas_number, ec_number, reason, date_included
                   FROM echa_svhc
                  WHERE cas_number = ?
                  LIMIT ?`,
                q,
                maxResults
              )
            : await safeAll(
                this.env,
                ctx,
                "echa_svhc",
                `SELECT substance_name, cas_number, ec_number, reason, date_included
                   FROM echa_svhc
                  WHERE reason COLLATE NOCASE LIKE ? ESCAPE '\\'
                     OR cas_number COLLATE NOCASE LIKE ? ESCAPE '\\'
                     OR ec_number COLLATE NOCASE LIKE ? ESCAPE '\\'
                  LIMIT ?`,
                pattern,
                pattern,
                pattern,
                maxResults
              );

          for (const r of svhcResults) {
            results.push({ source: "SVHC", ...r });
          }
        }

        if (db === "all" || db === "niosh") {
          const nioshResults = await safeAll(
            this.env,
            ctx,
            "niosh_pocket_guide",
            `SELECT chemical_name, cas_number, rel, pel, idlh, symptoms, target_organs
               FROM niosh_pocket_guide
              WHERE chemical_name COLLATE NOCASE LIKE ? ESCAPE '\\'
                 OR symptoms COLLATE NOCASE LIKE ? ESCAPE '\\'
                 OR target_organs COLLATE NOCASE LIKE ? ESCAPE '\\'
                 OR cas_number COLLATE NOCASE LIKE ? ESCAPE '\\'
              LIMIT ?`,
            pattern,
            pattern,
            pattern,
            pattern,
            maxResults
          );

          for (const r of nioshResults) {
            results.push({ source: "NIOSH", ...r });
          }
        }

        if (db === "all" || db === "icsc") {
          if (resolved.cas) {
            const icsc = await lookupIcscByCas(this.env, ctx, resolved.cas);
            if (icsc) results.push({ source: "ICSC", cas_number: resolved.cas, ...icsc });
          }
        }

        if (db === "all" || db === "ghs") {
          const ghsById = await lookupGhsByCrosswalk(this.env, ctx, resolved.crosswalk);
          if (ghsById) {
            results.push({ source: "GHS", cas_number: resolved.cas, ...ghsById });
          }

          const ghsResults = await safeAll(
            this.env,
            ctx,
            "ghs_classifications",
            `SELECT pictograms, signal_word, hazard_statements, source_name
               FROM ghs_classifications
              WHERE hazard_statements COLLATE NOCASE LIKE ? ESCAPE '\\'
                 OR signal_word COLLATE NOCASE LIKE ? ESCAPE '\\'
                 OR source_name COLLATE NOCASE LIKE ? ESCAPE '\\'
              LIMIT ?`,
            pattern,
            pattern,
            pattern,
            maxResults
          );

          for (const r of ghsResults) {
            results.push({ source: "GHS", ...r });
          }
        }

        return jsonToolResponse({
          query: q,
          database: db,
          count: results.length,
          results: results.slice(0, maxResults).map((result) => ({
            ...result,
            detail_url: chemicalDetailUrl(result.cas_number),
          })),
          data_warnings: [...new Set(ctx.warnings)],
          source: "Roots by Benda — rootsbybenda.com",
        });
      }
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Resolve auth early — use user_id for rate limiting when authenticated (better for shared IPs)
    let auth: AuthProps | null = null;
    const isDataEndpoint = url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname.startsWith("/sse/") || (request.method === "POST" && url.pathname === "/");
    if (isDataEndpoint) {
      auth = await resolveAuth(request, env);
      const rateLimitKey = auth.user_id || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
      if (!checkRateLimit(rateLimitKey)) {
        return rateLimitResponse();
      }
    }

    if (request.method === "POST" && url.pathname === "/") {
      if (!auth) auth = await resolveAuth(request, env);
      (ctx as ExecutionContext & { props?: AuthProps }).props = auth;
      const mcpUrl = new URL(request.url);
      mcpUrl.pathname = "/mcp";
      const mcpRequest = new Request(mcpUrl.toString(), request);
      return ChemMCP.serve("/mcp").fetch(mcpRequest, env, ctx);
    }

    if (url.pathname === "/selftest") {
      const result = await runSelftest(env);
      return Response.json(result, {
        status: result.ok ? 200 : 500,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        status: "healthy",
        description: SERVER_DESCRIPTION,
        tools: TOOL_CATALOG.map((tool) => tool.name),
        data: DATA_CATALOG,
        docs: HOMEPAGE,
        homepage: HOMEPAGE,
        source: SOURCE,
      });
    }


    if (url.pathname === "/.well-known/mcp/server.json") {
      return Response.json(registryMetadata(), {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    }

    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return Response.json({
        "$schema": "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
        "version": "1.0",
        "protocolVersion": "2025-06-18",
        "serverInfo": { "name": "chem-mcp-server", "title": SERVER_NAME, "version": SERVER_VERSION },
        "description": SERVER_DESCRIPTION,
        "iconUrl": "https://rootsbybenda.com/icon.png",
        "documentationUrl": "https://rootsbybenda.com",
        "transport": { "type": "streamable-http", "endpoint": "/mcp" },
        "capabilities": { "tools": { "listChanged": true }, "resources": { "subscribe": false, "listChanged": false } },
        "authentication": { "required": false, "schemes": ["bearer"], "note": "Optional API key enables per-user rate limiting" },
        "rateLimit": { "requestsPerMinute": 60, "enforcement": "per-ip-or-user" },
        "tools": TOOL_CATALOG
      }, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    }

    // Resolve auth and set on ctx.props for MCP transport endpoints
    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/") || url.pathname === "/mcp") {
      if (!auth) auth = await resolveAuth(request, env);
      (ctx as ExecutionContext & { props?: AuthProps }).props = auth;
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
