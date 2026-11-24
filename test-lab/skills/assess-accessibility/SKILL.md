---
name: assess-accessibility
description: >
  Assess a locally running DDEV site against WCAG 2.1 Level AA: a Screaming Frog crawl runs
  axe on every page, Playwright checks keyboard, focus, zoom and reflow in three browsers,
  and each of the 50 criteria gets a verdict, a defensible score and a manual-check
  worksheet. Not for SEO crawling, and never for a remote URL.
---

# Assess accessibility (WCAG 2.1 AA)

Produces a per-criterion verdict for all 50 WCAG 2.1 Level A and AA success criteria on a local DDEV site. It reports what automation can prove and leaves the rest to people instead of inflating the score.

## Rules

- **Local DDEV sites only.** The target comes from `ddev describe -j` in the project root. There is no URL argument. The shared guard (`test-lab/scripts/ddev_guard.py`) refuses any host that isn't the project's DDEV host, and starts a stopped project.
- **Crawling stays on the site.** External links are never crawled. Rendering may fetch the page's own off-site stylesheets and fonts so axe sees real styles. This was approved on 2026-11-24: "within reason, whatever we need to get the best analysis".
- **A missing export is an error, never zero issues.** So are blank accessibility counts (axe didn't run), a crawl that didn't finish, and any `Failed to render` line.
- **Never mark a criterion compliant because automation found nothing.** See Scoring.

## Setup (once per machine)

1. Screaming Frog SEO Spider 25.1 or later, licensed, with the EULA accepted in the app once. JavaScript rendering and the command line need the licence.
2. Install the browser checks:

   ```zsh
   cd test-lab/skills/assess-accessibility/scripts/checks
   npm ci
   npx playwright install chromium firefox webkit
   ```

3. Python 3.11 or later and DDEV. Nothing runs inside DDEV; the site only has to be up.

The crawl config is `config/accessibility-local.json`, a partial Screaming Frog config in the schema its MCP server documents (`sf_get_config_sub_schema`). It turns on JavaScript rendering at 1280×800, accessibility (axe-core), and the custom extractions behind not-applicable decisions. External crawling is off, and `/user/logout`, `/admin/` and query strings are excluded. Change it there, never in the app.

## Run

```zsh
python3 test-lab/skills/assess-accessibility/scripts/run_assessment.py \
  --project ~/Sites/<PROJECT>/worktrees/<worktree> \
  [--site www.example.org] [--findings findings.json] [--manual manual.json] \
  [--compare-to <earlier run folder>] [--max-templates 25]
```

The run folder defaults to `<project>/analysis-reports/accessibility-<date-time>/` and contains:

| File | What |
| --- | --- |
| `report.html` | The report: verdict, 50-criterion board, fixes by severity, reviewer checklist, detail table, method |
| `report.json` | Everything the report says, for comparison and other tools |
| `manual-worksheet.md` | Criteria a person must decide, with steps, automated leads and one page per template |
| `frog/` | Screaming Frog exports and log; `frog-result.json` holds the wrapper result |
| `pages.json` | Templates and the representative page checked for each |
| `checks/`, `checks-selftest/` | Playwright results; the self-test must fail every detector first |
| `comparison.md` | With `--compare-to`: status changes, pages affected and coverage, before and after |

`--skip-crawl <frog export folder>` reuses an earlier crawl.

## What decides each criterion

- **Screaming Frog, every page:** axe-core violations of rules tagged with a WCAG 2.0/2.1 A or AA criterion. The rule-to-criterion map is `scripts/criteria.py`, because the export's Guidelines column names only a level, never criterion numbers. Best-practice rules and axe "incomplete" results become leads, never failures. WCAG 2.2-only and AAA rules are out of scope. The custom-extraction inventory counts video, audio, media iframes, autoplay, forms, inputs and personal-data inputs on every page.
- **Playwright, one page per template, Chromium, Firefox and WebKit:**
  - keyboard: Tab traversal, traps versus focus loops, skip link, focus visibility by pixel difference;
  - layout: 200% text, 320 px reflow, WCAG text spacing;
  - interaction: hover/focus content, orientation, single-key shortcuts, context changes on focus and input;
  - semantics: label in name, form labels, name/role/state. No screen reader runs; the accessibility tree stands in for one.
- **People:** everything else, through `manual.json`.

## Scoring

| Status | Only when |
| --- | --- |
| Not compliant | An axe violation, a browser-check failure not dismissed, an open recorded finding, or a manual fail |
| Compliant | 4.1.1 (always met under the 2023 errata); 3.1.1 with lang rules passing on every crawled page; 1.3.4, 1.4.12, 2.1.2 or 2.1.4 with the decisive browser check passing on every template in all three browsers; or a manual pass |
| Not applicable | The full-crawl inventory shows the content type on no page (media for 1.2.x and 1.4.2, inputs for 1.3.5, 3.3.1, 3.3.3), or a manual review says so |
| Needs manual check | Everything else, with its automated leads |

The verdict is "Does not conform" with any failure, "Conformance not established" while anything still needs a manual check, and "Conforms" only at 50 of 50. **Proven** is compliant plus not applicable. It measures how much has been shown, not how accessible the site is. 2.4.2 never passes automatically, because only a person can judge whether a title describes its page.

## Recording people's results

`manual.json`:

```json
{"reviews": [{"criterion": "2.4.2", "verdict": "pass", "reviewer": "Name", "date": "2026-11-24",
              "scope": "all templates", "note": "titles name the page and site"}],
 "dismissals": [{"criterion": "2.4.7", "check": "focus-pixel-difference", "page": "/path",
                 "browser": "firefox", "reason": "cross-origin iframe", "reviewer": "Name", "date": "2026-11-24"}]}
```

An automated failure beats a manual pass; the run prints the conflict. A dismissal turns a browser-check failure into a lead. Write a reason a client could read.

`findings.json` holds recorded findings such as tickets or an earlier audit: `[{"key": "PROJ-123", "summary": "...", "criteria": ["2.4.3"], "severity": "High", "status": "Open", "url": "https://..."}]`. Closed, done, resolved and fixed findings are ignored.

## Before and after

Run once on the unfixed site and once on the fixed one, passing the first run folder as `--compare-to`. The comparison lists coverage beside the counts. A change in pages crawled, templates sampled or browsers means the method changed, not only the site.

## Known limits

- Off-site CSS and fonts that fail to load locally can shift contrast results slightly from production.
- Templates come from Drupal body classes, falling back to the first path segment. The `--max-templates` largest templates are sampled; the rest are listed as not sampled.
- Browser checks can misfire on deliberate positive tab order, animated focus styles, cross-origin iframes and background updates. Review each failure before ticketing it, and dismiss false positives in `manual.json`.
