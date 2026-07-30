---
version: alpha
name: Velir 2025 — drover overlay
description: >
  Drover's local copy of the Velir 2025 design system, extended with
  report-specific components and trend colors. The brand truth
  (colors top-of-file, typography, spacing, rounded) is synced from
  ~/.velir/DESIGN.md — re-sync periodically and never edit those
  blocks locally. Drover-specific additions are clearly marked below
  and may deviate from upstream when reporting needs require it.
colors:
  primary: "#001B67"
  secondary: "#0051FF"
  tertiary: "#00321A"
  accent-mark-green: "#00FF99"
  text-strong: "#1A1A1A"
  text: "#2A2A2A"
  text-soft: "#3E3E3E"
  text-muted: "#557382"
  surface: "#FFFFFF"
  surface-alt: "#F1F1F1"
  border: "#E5E5E5"
  highlight-gold: "#FAD200"
  highlight-yellow: "#FFE146"
  tint-mint: "#C8F5E3"
  tint-blue: "#E6E8FF"
  tint-yellow: "#FFF4D8"
  severity-critical: "#A1153A"
  severity-error: "#0051FF"
  severity-warning: "#FAD200"
  severity-notice: "#00321A"
  severity-info: "#557382"
  severity-unknown: "#888888"
  # --- drover extensions: trend palette for month-over-month deltas ---
  trend-up: "#A1153A"
  trend-down: "#00321A"
  trend-flat: "#557382"
  trend-new: "#0051FF"
typography:
  display:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  h2:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h3:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 1.125rem
    fontWeight: 500
    lineHeight: 1.4
  body-lg:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.55
  body-md:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
  metric:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: 2.25rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum' 1"
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.45
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  xxxl: 64px
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 999px
print:
  pageSize: "Letter portrait"
  margin: "0"
components:
  # --- Velir base components (synced from ~/.velir/DESIGN.md) ---
  page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    padding: "{spacing.xl}"
  page-header:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    padding: "{spacing.lg}"
  display:
    typography: "{typography.display}"
    textColor: "{colors.primary}"
  subtitle:
    typography: "{typography.body-lg}"
    textColor: "{colors.text-muted}"
  section-heading:
    typography: "{typography.h2}"
    textColor: "{colors.secondary}"
    borderBottomColor: "{colors.border}"
    borderBottomWidth: 1px
    paddingBottom: "{spacing.sm}"
    marginTop: "{spacing.xl}"
    marginBottom: "{spacing.md}"
  body:
    typography: "{typography.body-md}"
    textColor: "{colors.text}"
  metric-card:
    backgroundColor: "{colors.tint-blue}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    labelTypography: "{typography.label}"
    valueTypography: "{typography.metric}"
  callout-card:
    backgroundColor: "{colors.tint-blue}"
    borderLeftColor: "{colors.primary}"
    borderLeftWidth: 4px
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    titleTypography: "{typography.h3}"
    titleColor: "{colors.primary}"
    metaTypography: "{typography.label}"
    metaColor: "{colors.text-muted}"
  banner:
    backgroundColor: "{colors.tint-yellow}"
    textColor: "#7A5C00"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    typography: "{typography.body-md}"
  tag:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    paddingX: "{spacing.sm}"
    paddingY: 2px
    typography: "{typography.body-sm}"
  table:
    headerBg: "{colors.surface-alt}"
    headerColor: "{colors.text}"
    headerTypography: "{typography.label}"
    rowBorderColor: "{colors.border}"
    rowBorderWidth: 1px
    cellPaddingX: "{spacing.md}"
    cellPaddingY: "{spacing.sm}"
    cellTypography: "{typography.body-sm}"
  footer:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text-muted}"
    padding: "{spacing.md}"
    typography: "{typography.body-sm}"
  # --- drover extensions: report composites ---
  severity-pill:
    rounded: "{rounded.pill}"
    paddingX: "{spacing.sm}"
    paddingY: "{spacing.xs}"
    typography: "{typography.label}"
    textTransform: uppercase
    criticalBg: "#FBE2EA"
    criticalText: "{colors.severity-critical}"
    errorBg: "{colors.tint-blue}"
    errorText: "{colors.severity-error}"
    warningBg: "{colors.tint-yellow}"
    warningText: "#7A5C00"
    noticeBg: "{colors.tint-mint}"
    noticeText: "{colors.severity-notice}"
    infoBg: "{colors.surface-alt}"
    infoText: "{colors.severity-info}"
    unknownBg: "{colors.surface-alt}"
    unknownText: "{colors.severity-unknown}"
  chart-bar:
    height: 22px
    rounded: "{rounded.sm}"
    backgroundColor: "{colors.primary}"
    accentColor: "{colors.secondary}"
    trackColor: "{colors.surface-alt}"
    labelTypography: "{typography.body-sm}"
    valueTypography: "{typography.body-sm}"
    valueColor: "{colors.text-muted}"
  chart-axis-label:
    typography: "{typography.label}"
    textColor: "{colors.text-muted}"
  fingerprint-row:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    borderWidth: 1px
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    gap: "{spacing.sm}"
    titleTypography: "{typography.h3}"
    titleColor: "{colors.text}"
    sampleTypography: "{typography.mono}"
    sampleColor: "{colors.text-muted}"
  ticket-card:
    backgroundColor: "{colors.tint-blue}"
    borderLeftColor: "{colors.primary}"
    borderLeftWidth: 4px
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    titleTypography: "{typography.h3}"
    titleColor: "{colors.primary}"
    metaTypography: "{typography.label}"
    metaColor: "{colors.text-muted}"
  coverage-banner:
    backgroundColor: "{colors.tint-yellow}"
    textColor: "#7A5C00"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    typography: "{typography.body-md}"
    iconSize: 20px
  channel-tag:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    paddingX: "{spacing.sm}"
    paddingY: 2px
    typography: "{typography.mono}"
  mom-arrow:
    upColor: "{colors.trend-up}"
    downColor: "{colors.trend-down}"
    flatColor: "{colors.trend-flat}"
    newColor: "{colors.trend-new}"
    typography: "{typography.label}"
---

## Overview

Drover renders monthly application-error reports for stakeholders.
This file is drover's local design system: it inherits everything
from Velir's brand (`~/.velir/DESIGN.md`) and adds the report-only
composites and trend palette drover needs.

**Sync convention.** When the upstream Velir DESIGN.md changes
(palette refresh, new typography, brand update), re-copy the brand
blocks (`colors`, `typography`, `spacing`, `rounded`, and the
base components above the drover-extensions divider) into this
file. The drover-specific additions below stay untouched.

If drover ever genuinely needs to deviate from upstream (a
report-only color override, a project-specific typography tweak),
do it here with a comment explaining why — but keep deviations to
a minimum so the visual identity stays Velir-consistent.

Three orienting principles specific to drover reports:

1. **Numbers earn the visual weight.** Volumes, percentages, and
   trend deltas are the most important content. Display them in
   `metric` typography against tinted card backgrounds. Body prose
   provides context, not headline value.
2. **Severity is the second most important content.** Every issue
   carries a severity (critical/error/warning/notice/info), and the
   reader's first triage question is "how bad?" Severity pills must
   be unambiguous from across a meeting room.
3. **Brand chrome stays out of the way.** The Velir logo and primary
   navy live in the page header and footer. The body of the report
   defaults to neutral surfaces so charts and severity colors read
   cleanly.

The `print` tokens are part of the report contract because PDF is the
delivery artifact. A project-local design may switch `pageSize` (for
example, `A4 portrait`) or add a physical margin without changing a
template.

See `~/.velir/DESIGN.md` for full Velir brand prose (color
philosophy, typography rationale, layout, shapes, dos and don'ts).
Sections below cover only drover-specific additions.

## Drover-specific colors

### trend palette

Used by month-over-month deltas to indicate direction.

- **trend-up (#A1153A) — red.** *More errors* = bad. Used when this
  month's count exceeds the prior month for a given fingerprint.
- **trend-down (#00321A) — green.** *Fewer errors* = good. Used
  when this month's count is lower than the prior month.
- **trend-flat (#557382) — muted.** Within ±10% of prior month.
- **trend-new (#0051FF) — brand blue.** New fingerprints with no
  prior-month data; rendered with a 🆕 marker.

The red-up / green-down inversion of the usual stock-market
convention is intentional in this product and is called out in
every chart legend.

## Drover-specific components

### severity-pill

Small all-caps badge identifying an issue's severity. Use a tinted
background with the matching severity text color. Width follows
content; never set a fixed width.

```
[ CRITICAL ]  [ ERROR ]  [ WARNING ]  [ NOTICE ]  [ INFO ]
```

### chart-bar

A horizontal bar in a chart row. The bar's filled portion uses
`backgroundColor` (primary navy). The track behind it is
`trackColor` (surface-alt). Bar height is fixed at 22px with sm
radius. The label sits to the left in `labelTypography`, the value
sits to the right in `valueTypography` with `valueColor` text-muted.

When a chart row needs to highlight a single bar (e.g. the top item
in a Pareto cut), substitute `accentColor` (secondary blue) for that
bar only.

### chart-axis-label

Axis tick labels — small label typography in text-muted.

### fingerprint-row

A card showing one error fingerprint: title, severity pill, count,
first/last seen dates, sample log line. The sample is rendered in
`mono` typography inside the card. Cards are stacked vertically with
md spacing between them.

### ticket-card

A "recommended JIRA ticket" card. 4px left border in primary navy,
background `tint-blue`. Contains title, priority/labels (meta row
in `label` typography), and a short description in `body-sm`. Used
in the JIRA Recommendations section of stakeholder templates.

### coverage-banner

The "Coverage: NN%" banner that appears at the top of every report.
Yellow tint background (`tint-yellow`), dark amber text (#7A5C00),
md padding, md radius. Always preceded by a small warning glyph at
iconSize (20px) when coverage is below 90%.

### channel-tag

A small monospace tag identifying a Drupal watchdog channel
(system, php, cron, etc.). Inline-flow, sm radius, surface-alt
background. Multiple tags per row separated by xs (4px) space.

### mom-arrow

Trend indicator for month-over-month deltas. Single character + a
small percentage in `label` typography. Up arrows are `trend-up`
(red), down arrows `trend-down` (green) — this inversion is
intentional because more errors is worse. New issues (no prior
month data) use `trend-new` (blue) with the 🆕 marker.

## Do's and Don'ts (drover-specific)

**Do**
- Keep the Velir brand blocks in this file byte-identical to
  `~/.velir/DESIGN.md`. If they drift, re-sync.
- Use the trend palette only for deltas. Don't substitute it for
  severity colors — they look similar but mean different things.
- Set the coverage banner before any data — never bury a coverage
  caveat below the fold.

**Don't**
- Do not invert the trend palette to match stock-market convention.
  In drover, red means *more errors*; green means *fewer*.
- Do not add components here that other Velir products would want
  too — propose them upstream to `~/.velir/DESIGN.md` first.
- Do not edit the synced Velir blocks without recording why in a
  comment. Drift makes the next re-sync painful.
