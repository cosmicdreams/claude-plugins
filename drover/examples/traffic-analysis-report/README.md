# Traffic Analysis Report — Example

A complete worked example of a stakeholder-facing access-log traffic analysis report. **All client data has been removed.** Hostnames, route names, IP addresses, and numbers have been replaced with fictional or RFC 5737 documentation values. The narrative structure, visual treatments, and analytical patterns are preserved exactly as they appeared in the production report this example was derived from.

This is a **reference example, not a template.** Drover does not currently render this report type automatically — the patterns here are intended to be hand-composed by an analyst writing a similar report. When the drover plugin grows a `traffic-analysis` report type with a Velir-branded shell, the structural shapes demonstrated here will be the source material.

## What this example demonstrates

The report tells a complete arc — *problem identified, mitigation deployed, impact measured, residual work named* — for a fictional client whose origin server was being heavily crawled through a hostname that bypassed their Web Application Firewall. The mitigation deployed mid-window cut the abuse by 70% and the report quantifies that outcome.

### Reusable narrative patterns

| Pattern | Where to study it |
|---|---|
| **Win banner** — visible above-the-fold proof that an intervention worked | Hero area, just below the header |
| **Headline card with color-coded left border** — red for unresolved problems, green for confirmed wins | Top of Section 01 |
| **Four-up KPI tiles** — most-important numbers in stakeholder-skimmable form | Top of Section 01 |
| **Three-budget framework callout** — separating contract metering, vendor quota, and infrastructure load so recommendations target the right meter | Bottom of Section 01 |
| **The "cliff chart"** — log-scale dual-line timeline (success vs blocked) with the intervention day implicit in the data shape | Hero chart of Section 02 |
| **Before/after comparison table** — pre-intervention vs post-intervention metrics side-by-side | Section 02 |
| **Per-route attribution table** — every offending route enumerated with actor-class breakdown and a non-human percentage pill | Section 03 |
| **Named-actor breakdown** — resolving generic "bots" into specific crawler brands (Bingbot, Googlebot, etc.) for stakeholder clarity | Section 03 |
| **"Is our recent work the cause?" investigation** — comparing legacy routes vs. new architecture's routes side-by-side to clear or condemn recent changes | Section 04 |
| **Hostname/origin distribution analysis** — splitting traffic by the actual Host header to surface bypass-path issues | Section 05 |
| **Dominant-actor profile card** — single-actor deep-dive with identifying signature table | Section 07 |
| **Bandwidth-by-actor table** — putting infrastructure cost on actors that the contract-billing meter does not count | Section 07 |
| **Recommendation cards with multi-budget impact pills** — every recommendation annotated with which budget(s) it affects, so stakeholders can prioritize by outcome | Section 10 |
| **"What is deliberately NOT changing" table** — explicit allowlist showing untouched routes, important for ad campaigns / SEO reassurance | Section 09 |

## Directory contents

```
traffic-analysis-report/
├── README.md                          this file
├── report/
│   └── example-report.html            the fully-rendered stakeholder report
└── analyzers/
    ├── analyze.py                     actor and search aggregates
    ├── route_breakdown.py             per-route splits with actor classification
    ├── host_breakdown.py              Host-header attribution (bypass detection)
    ├── enrichment.py                  named-bot resolution + bandwidth + 404 surface
    └── timeline.py                    per-day per-host cliff data for Section 02
```

## How to adapt this for a new engagement

1. **Pull the access logs** for the analysis window with the drover acquia-pull skill. Use the per-day loop (drover ≤ 2.1.0 has a multi-day pull bug); verify each file's dominant date and md5.
2. **Edit the regex patterns in the analyzers** for the client's actual area names, host hostnames, scanner IP ranges, and any client-specific scraper signatures. The skeletons in `analyzers/` define the data shapes the report consumes; the patterns to swap are clearly marked with placeholders like `<year>`, `<month>`, and the area-search regex.
3. **Run all five analyzers in order.** They produce JSON files used to populate the report's charts and tables.
4. **Copy `example-report.html` as a starting skeleton** and replace the hard-coded numbers with the analyzer outputs. The chart data lives in inline `<script>` blocks at the bottom of the file.
5. **Compose only the sections the data supports.** Not every engagement has a mitigation cliff, a bypass discovery, or a named-actor story — drop sections cleanly rather than padding. The narrative arc is the strength of this format; forcing the structure when the data does not support it weakens the report.

## Style choices preserved from the original

- **Lede leads with situation and resolution status**, not methodology. Save "how the report was made" for a closing Method & Caveats section, or omit entirely for a non-technical audience.
- **Acronyms defined on first use** in parentheses, then reused freely (e.g. "Views And Visits (V&V)"). Common idioms like JSON, URL, CPU, IP, HTTP, SEO, CDN, and API may be used without expansion.
- **Vendor-correct naming** for client-visible services — e.g. call the search backend by the vendor name (SearchStax) rather than the underlying technology (Solr), unless the underlying technology is the technical point being made.
- **Color discipline** — red for unresolved problems, green for confirmed wins, amber for caveats and operational concerns. The win banner gets the strongest green treatment; the headline card border carries the same color as the outcome it summarizes.

## Relationship to other drover report types

Drover currently ships five Handlebars templates for **error-fingerprint reports** under `render-html/templates/`:

- `calendar-boundary.hbs`
- `jira-ready.hbs`
- `monthly-client.hbs`
- `root-cause-summary.hbs`
- `triage-brief.hbs`

This example demonstrates what a sixth template family — **access-log traffic analysis** — would look like as a stakeholder deliverable. It is intentionally not yet wired into the `drover:report` skill; it lives here as a worked example until the Velir-branded shell and a `traffic-analysis` report type are formally added.
