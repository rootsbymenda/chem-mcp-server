# Roots by Benda — Chemical Safety & Industrial Regulatory Intelligence MCP Server

**Chemical hazard data from ECHA, NIOSH, GHS, and ICSC in one MCP.** Look up SVHC candidate list status, occupational exposure limits, GHS hazard classifications, and cross-reference into cosmetic and food additive databases — all source-linked and free.

Equivalent data access through commercial platforms (Chemwatch, ScienceDirect Toxicology) costs $10,000+/year. This MCP is free.

**Live endpoint:** `https://chem-mcp-server.rootsbybenda.workers.dev/mcp`
**SSE fallback:** `https://chem-mcp-server.rootsbybenda.workers.dev/sse`

## Tools

### `check_chemical`
Look up a chemical substance by name or CAS number. Returns EU ECHA SVHC status, NIOSH occupational exposure data (REL/PEL/IDLH), GHS hazard classification, ICSC safety card data, and cosmetic/food cross-references for hazard assessment.

```
query: "formaldehyde"
→ SVHC: Yes (Candidate List 2012-06-18, CMR 1B); NIOSH REL: 0.016 ppm TWA;
  GHS: H301+H311+H331, H350, H370; Cosmetic: banned EU Annex II; Food: E240 (banned EU)
```

### `check_svhc_list`
Check one or more chemical substances against the EU ECHA SVHC Candidate List. Resolves names to CAS numbers when possible and returns flagged substances, reasons for inclusion, dates, and source-linked detail URLs.

```
substances: "bisphenol A, DEHP, lead chromate"
→ 3/3 flagged: BPA (ED, 2017-01-12), DEHP (Repr. 1B, 2008-10-28), Lead chromate (CMR, 2008-10-28)
```

### `search_chemicals`
Search chemical safety records by keyword across SVHC, NIOSH, GHS, and ICSC data. Use when you need to find hazardous chemicals by effect, exposure route, hazard phrase, organ target, or regulatory status.

```
query: "neurotoxic solvent" → matches across GHS H370 (nervous system), NIOSH CNS depressants
```

## Data

| Dataset | Records |
|---------|---------|
| ECHA SVHC Candidate List substances | 253 |
| NIOSH occupational exposure profiles | 677 |
| GHS hazard classifications (PubChem) | 468,165 |
| Substance identifiers (CAS ↔ EC ↔ INCI ↔ CID crosswalk) | 73,252 |
| ICSC safety cards | included |
| Cross-references to cosmetic ingredients | 30,553 |
| Cross-references to food additives | 6,450 |

**100% source-traceability:** every record links back to ECHA, NIOSH, PubChem, or ICSC primary sources.

**Sources:** ECHA SVHC Candidate List, NIOSH Pocket Guide to Chemical Hazards, PubChem GHS classifications, ILO International Chemical Safety Cards.

## Quick Start

### Claude Desktop / Claude Code
Add to your MCP config:
```json
{
  "mcpServers": {
    "roots-chemical-safety": {
      "url": "https://chem-mcp-server.rootsbybenda.workers.dev/sse"
    }
  }
}
```

### Cursor / Windsurf / Zed
Use the Streamable HTTP endpoint:
```
https://chem-mcp-server.rootsbybenda.workers.dev/mcp
```

## Rate Limits

Every caller receives full data; a 60 requests/minute abuse-prevention limit applies per IP.

## Built With

- [Cloudflare Workers](https://workers.cloudflare.com/) + [Agents SDK](https://developers.cloudflare.com/agents/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/) (session-scoped rate limiting)
- [Model Context Protocol](https://modelcontextprotocol.io/) (MCP)

## Who Built This

**Roots by Benda** — regulatory intelligence platform built by Shahar Ben-David with Claude. Chemical safety database assembled from primary sources across ECHA, NIOSH, PubChem, and ILO ICSC.

- Website: [rootsbybenda.com](https://rootsbybenda.com)
- LinkedIn: [Shahar Ben-David](https://www.linkedin.com/in/shahar-ben-david-25549a3a8/)

## License

MIT
