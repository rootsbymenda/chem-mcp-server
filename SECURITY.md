# Security Policy

## Reporting a Vulnerability

If you discover a security issue in this MCP server or its tool handlers, please email **SBD@effortlessai.ai** with:

- A description of the issue
- Steps to reproduce (curl one-liner if possible)
- Affected endpoint or code path
- Your name/handle for credit (optional)

A dedicated `security@rootsbybenda.com` alias is planned; until it lands, the email above is the canonical disclosure contact.

### Response Timeline

| Stage | Target |
|---|---|
| Acknowledgment | within 72 hours (best-effort, solo maintainer) |
| Initial assessment | within 7 days |
| Critical fix (P0) | within 30 days |
| Public disclosure coordination | after fix deployed, mutually agreed timeline |

---

## Scope

### In scope
- Worker source code in this repository (`src/index.ts`)
- Tool handler logic (`check_chemical`, `check_svhc_list`, `search_chemicals`)
- D1 query construction and parameter handling
- Public API endpoints at `chem-mcp-server.rootsbybenda.workers.dev`

### Out of scope
- The Roots by Benda D1 database itself (access controlled via Worker bindings and route-level protections)
- Third-party dependencies (please report upstream; we track CVEs via Dependabot)
- Social engineering, physical attacks, or attacks requiring previously-stolen credentials

---

## Security Architecture

### Data Surface — Public-Sourced Aggregations Only

This server queries public regulatory aggregations:
- **ECHA SVHC** (`echa_svhc` table) — Substances of Very High Concern Candidate List
- **NIOSH OEL** (`niosh_chemicals` table) — REL/PEL/IDLH occupational exposure profiles
- **UN GHS classifications** (`ghs_classifications` table) — hazard categories
- **Cosmetic ingredients** (`ingredients` table — public-display fields only: name, INCI, CAS, safety, EU status, concern)
- **Food additives** (`food_additives` table — public-display fields only: common name, E-number, CAS, safety score, EU status)

All chemical safety data returned by this server is free. The server does not classify callers by plan and does not strip response fields by tier.

### Authentication Posture
This server accepts optional HMAC-validated MCP keys. A valid key supplies a stable `user_id` for per-user rate limiting; unauthenticated callers still receive full data subject to abuse-prevention rate limits.

### Secret Management (Worker Bindings)
The optional HMAC secret is managed via **Cloudflare secret bindings** (`wrangler secret put`). The D1 database (`benda-ingredients`) is bound via `wrangler.toml`. **No secret has ever been committed to source control** — verified via filename scan and content-pattern scan across `master` branch git history; defensive `.gitignore` patterns block accidental future commits of local data dumps.

GitHub push protection and secret scanning are enabled on this public repo (free for public repos).

---

## Public Source — Conscious Decision

This repository is **public-by-design**. Source code visibility serves as the audit trail for technical buyers (regulatory consultants, chemical safety assessors, formulators) who professionally evaluate compliance tooling. The data is sourced from primary regulatory authorities and aggregated via this Worker; query structure and ETL discipline are verifiable through this repository.

This decision was made consciously after structured industry-pattern, security-tradeoff, and brand-positioning evaluation. The full decision rationale is recorded internally; the externally-visible artifact is this repo and its hygiene.

---

## License

ISC (see `package.json` `license` field).
