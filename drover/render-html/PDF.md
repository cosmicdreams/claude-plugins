# HTML to PDF support

HTML is Drover's editable source artifact. PDF is the final delivery artifact.
`render-pdf.mjs` prints an already-rendered HTML report using a locally
installed Chromium-family browser; it does not download a browser runtime.

```bash
node render.mjs \
  --data reports/2026-04.json \
  --template monthly-client \
  --out reports/2026-04-monthly-client.html

node render-pdf.mjs \
  --html reports/2026-04-monthly-client.html \
  --out reports/2026-04-monthly-client.pdf
```

## Supported conversion engines

| Engine | Status | How it is selected |
|---|---|---|
| Google Chrome | Supported and preferred | Auto-detected on macOS/Linux/Windows |
| Chromium | Supported | Auto-detected on macOS/Linux |
| Microsoft Edge | Supported | Auto-detected on macOS/Linux/Windows |
| Custom Chromium executable | Supported | `--browser` or `DROVER_PDF_BROWSER` |
| Safari/WebKit print | Manual fallback | Open HTML and use Print → Save as PDF |
| Firefox print | Manual fallback | Open HTML and use Print → Save as PDF |
| `wkhtmltopdf` | Not supported | Older rendering engine; modern CSS differs |
| WeasyPrint | Not supported by Drover | Useful for some workflows, but not equivalent to browser HTML/CSS |

Automated output is only guaranteed for Chromium-family engines. Safari and
Firefox remain useful manual fallbacks, but pagination and color can differ.

## Print contract

The shared stylesheet currently provides:

- exact print-color adjustment
- configurable `@page` size and margin from `DESIGN.md`
- hidden interactive controls and filters
- disabled transitions and animations
- section page breaks and heading orphan protection
- intact metric, ticket, triage, and JIRA cards
- wrapped log/code samples instead of clipped horizontal overflow

Project designs can change:

```yaml
print:
  pageSize: "A4 portrait"
  margin: "10mm"
```

The PDF converter uses an isolated temporary browser profile and removes browser
headers and footers. HTML output can be deterministic for identical input. PDF
bytes should not be treated as deterministic because browser versions may add
different metadata, font metrics, and pagination decisions.

## Delivery check

Before sending a PDF, inspect at least:

1. The first page title, reporting period, and coverage statement.
2. Page boundaries around charts, cards, and long samples.
3. Text wrapping and font substitution on the delivery machine.
4. The final page for accidental blank pages or clipped content.

Keep the HTML beside the PDF when practical. It is the easiest artifact for an
agent or developer to revise, regenerate, and audit.
