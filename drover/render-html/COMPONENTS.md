# Drover HTML report components

Drover's HTML is intentionally easy to adapt. Templates are Handlebars files,
shared report components are partials, and visual decisions come from
`DESIGN.md` through CSS custom properties.

## Start a local template

Create `.drover/templates/my-report.hbs` in the project being analyzed. Copy
`templates/custom-report.hbs.example` as a starting point, then list and render
it:

```bash
node render.mjs --list-templates
node render.mjs --data reports/2026-04.json --template my-report
```

The renderer discovers direct `*.hbs` children in this order (first match
wins):

1. Every `--templates <directory>` argument
2. `DROVER_TEMPLATE_DIRS` entries (OS path-delimited)
3. `<current-project>/.drover/templates`
4. Drover's bundled `render-html/templates`

Put project partials in `.drover/templates/partials`. A local partial with the
same filename intentionally overrides the bundled component.

## Template data contract

Bundled application-error templates receive purpose-built view models. Every
template also receives:

- `data` — the complete source JSON, untouched
- `css` — the generated design-system stylesheet; include with `{{{css}}}`
- `logoDataUri` — the embedded logo, if found
- `generatedAt` — a normalized value derived from input `generated_at`
- `meta` — the source `meta`, or a small normalized fallback for custom data

Unknown-but-discovered templates use a generic view: source fields appear at
the top level and remain available under `data`. This lets developers drop in
new templates without adding a JavaScript view builder.

The bundled `cloudflare-summary` is an HTML-only example of a non-Drover data
shape. Its documented sample input is `examples/cloudflare-summary.json`.

Handlebars escapes values by default. Keep that behavior for report data. Use
triple braces only for trusted renderer output such as `{{{css}}}`.

## Bundled partials

| Partial | Purpose | Common arguments |
|---|---|---|
| `report-header` | Brand header and theme control | `title`, `meta` |
| `report-footer` | Delivery attribution | `preparedBy`, `generatedAt` |
| `coverage-banner` | Prominent incomplete-data warning | `coverageLow`, `coverage`, `message` |
| `metric-card` | Headline number and optional explanation | `label`, `value`, `hint`, `modifier` |
| `chart-bar` | Accessible horizontal comparison bar | `label`, `value`, `share`, `width`, `severity`, `accent` |
| `callout-card` | Emphasized prose or recommendation | `title`, `text`, `modifier` |
| `head-theme-init` | Flash-free theme initialization | none |
| `theme-toggle-button` | Accessible light/dark toggle | none |
| `theme-toggle-script` | Shared toggle behavior | none |

Example:

```hbs
<div class="metric-row">
  {{> metric-card label="Requests" value=(fmt data.totals.requests)}}
  {{> metric-card label="Cache hit rate" value=(pct data.cache.hit_rate)}}
</div>

{{#each data.channels}}
  {{> chart-bar
      label=name
      value=(fmt count)
      share=share_pct
      width=relative_width_pct
      accent=@first}}
{{/each}}
```

`callout-card` also accepts rich semantic content through a partial block:

```hbs
{{#> callout-card title="Recommendation"}}
  <p>Address the two highest-volume causes before tuning lower-volume noise.</p>
  <ul><li>Confirm ownership.</li><li>Capture the before/after count.</li></ul>
{{/callout-card}}
```

## Graph helpers

The shared `chart-bar` partial handles general ranked comparisons. The renderer
also exposes three SVG helpers used by `cloudflare-summary`:

- `{{{svgDonut data.cache_status}}}` — `{hit, miss, dynamic, none}` values
- `{{{svgAreaChart data.daily}}}` — `[{date, bytes, cached_bytes}]`
- `{{{svgWaffle data.bot_classes}}}` — `{machine_learning, verified_bot,
  heuristics, not_computed}` values

These helpers are useful reference implementations for donut, time-series area,
and 100-cell composition charts. Wrap complex graphs in `<figure>` with a
visible `<figcaption>`, and provide a semantic table when readers need exact
values. If a new graph appears in multiple reports, promote it to a renderer
helper plus a documented partial instead of copying SVG construction into each
template.

Charts keep their value in visible text and mark the decorative SVG bar hidden
from assistive technology. Prefer this pattern for future graphs: pair every
visualization with text, a caption, or a semantic table containing the same
facts. Dynamic chart measurements should travel through CSS custom properties;
static visual rules belong in the generated stylesheet.

## Design overrides

Design resolution uses the first existing file:

1. `--design /path/to/DESIGN.md`
2. `DROVER_DESIGN`
3. `<current-project>/.drover/design/DESIGN.md`
4. `<current-project>/.drover/design/design.md`
5. Drover's bundled `assets/design/DESIGN.md`

Copy the bundled design into `.drover/design/DESIGN.md` when a project needs a
different palette, typography, spacing, component tokens, or PDF page size.
Templates should continue to use the existing CSS variables so design changes
stay separate from content structure.

## Component design rules

- Use semantic headings and landmarks; keep one report-level `<h1>`.
- Use real text alongside charts. Color alone must not convey status.
- Keep long narrative text near `80ch` and preserve visible keyboard focus.
- Use `break-inside: avoid` for cards that should remain intact in PDF.
- Add a partial when a structure will plausibly appear in two reports. Keep
  one-off report composition in its template.
- Preserve deterministic output: timestamps and prose must come from input.
