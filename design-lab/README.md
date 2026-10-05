# design-lab

Build and maintain a Figma component library from a codebase.

Extract, model, render are separate on purpose. Writing source straight into Figma gives a one-shot script that cannot re-run, cannot diff against the source later, and cannot feed anything but Figma. `components.json` and `tokens.json` are the contract; Figma is one renderer.

## Three independent plug points

Component source, token source and usage source vary **separately**. A Single Directory Component site has no tokens in configuration at all — they live in stylesheets. Conflating the axes forces one site down another's path.

## Verified against

| Site | Components | Config path | Tokens |
|---|---|---|---|
| Drupal authoring site | 69 Drupal authoring bundles | `config/default` | 97 planned variables from authored Sass |
| Site Studio site A | 146 Site Studio + 6 custom | `config/packages` (declared in settings) | 129 custom style entities |
| Site Studio site B | 101 Site Studio + 3 custom | `config/packages` (declared in settings) | 176 custom style entities |
| Site Studio site C | 168 Site Studio + 4 custom | `config/sitestudio` (declared in settings) | 166 custom style entities |
| Paragraphs site | 43 Paragraph types | `config/default` | 113 base tokens via Sass source map |
| Paragraphs site, compiled-CSS branch | 43 Paragraph types | `config/default` | 94 authored custom properties |

The Paragraphs site also has 13 custom Single Directory Components, but only 6 are invoked by a paragraph template - they are a partial rendering layer, not the component source. It was recorded as a 13-component Single Directory Component site until 2026-08-31; that profile came from a bug, not the site. See `references/strategies/README.md`.

## Start here

Run `design-lab:init` once on a new machine. It settles everything about you and the machine, asking before it installs or changes anything: where runs live (next to each project as `PROJECT/design/<date>`, or in `~/.design/<project>/<date>`; runs are personal and never committed), one shared Playwright and its browser for capture, the Python packages, the Figma runner, and the Claude Code setting that would otherwise make runs ask you to approve commands. `lab_setup.py check` reports the same without changing anything. Everything about one site belongs to preflight, at the start of each run.

Use `design-lab:run` for a complete library. It creates a run folder outside the repository (where, `design-lab:init` decided) with its `project.json`, records the repository commit and every strategy decision, validates artifacts before rendering, and can resume from the first incomplete phase. Use a narrower skill only when the request names a single phase.

Use `design-lab:figma-build` to build an earlier run's capture and plan into a new, empty Figma file: a new run folder beside the others, with its own pane, verification and report, in minutes rather than the hours a fresh capture takes. The earlier run is left as it was.

Both open the design-lab pane beside the conversation as they start (below); nobody has to ask for it.

Builds write into Figma through the design-lab runner, a Figma development plugin that must be imported once per machine by hand — Figma offers no command-line install. To get the steps with this machine's paths filled in, ask:

> Using design-lab's references/relay.md, give me concise steps to install the design-lab runner plugin in Figma desktop, including the absolute path to its manifest on this machine.

| Skill | Does |
|---|---|
| `design-lab:init` | once per machine: where runs live, capture tools, the Figma runner, Claude Code settings |
| `design-lab:run` | end-to-end, resumable workflow and completion gate |
| `design-lab:figma-build` | an earlier run's capture and plan, built into a new empty Figma file as a new run, verified and scored |
| `design-lab:detect` | which strategies apply |
| `design-lab:inventory` | components + fields + slots + source defects -> `components.json` |
| `design-lab:usage` | verified anonymous example addresses + placement counts + tiers |
| `design-lab:capture` | measures and photographs each component on a running site, per breakpoint |
| `design-lab:tokens` | colour, spacing, type per breakpoint, each with its code name -> `tokens.json` |
| `design-lab:plan` | reviewable build proposal with variant arithmetic and hard refusals |
| `design-lab:figma-foundation` | variable collections, modes, scopes, code syntax. Once per file |
| `design-lab:figma-component` | one named atomic component transaction — variants, properties, bindings, documentation card, build record |
| `design-lab:figma-index` | the Getting Started page: inventory, linked index, coverage, known gaps. Refresh after every component |
| `design-lab:verify` | **checks the whole file against the base expectations**; every gap ends as a fix or a recorded waiver |
| `design-lab:evaluate` | the last step of every run: scores it into `scorecard.json`, a self-contained HTML report (coverage, accuracy against the live site, time and tokens, repeatability) and the fixed completion message |

`scripts/workflow.py` is the deterministic front door. Its `init`, `identity`, `detect`, `select`, `preflight`, `connect`, `extract`, `usage`, `plan`, `variables`, `approve`, `target`, `register`, `record`, `validate`, `status`, and `watch` commands write atomically and keep artifact hashes in the project manifest. The schemas in `schemas/` are the machine-readable contracts; `references/library-standard.md` is the canonical product definition.

Component extractors cover Site Studio, SDCs, Paragraphs, and combined Drupal authoring vocabularies (`block_content` + Paragraphs). Token extractors cover Site Studio styles, theme-loaded CSS custom properties, Sass source maps, and source-authored Sass. Combined Drupal extraction also writes `render-evidence.json`, a bounded map from each authoring bundle to its existing Twig, SDC, stylesheet, root-class, and referenced-field evidence. That evidence includes deterministic `styleFacts` parsed from the component's own Sass: root and nested-part declarations stay separate, retain token/literal provenance, and give the model the visual facts it needs without asking it to rediscover every stylesheet rule.

Drupal database usage is deterministic too: `extract_drupal_usage.py` reads the running DDEV project, preserves placements and structural references as separate measures, writes a validated `usage.json`, and merges tiers into `components.json`. Planning hard-stops when detection found usage evidence but it was neither measured nor explicitly waived as degraded. Waivers are human decisions: the workflow requires both a named decider and a reason, and final verification refuses any unresolved prerequisite phase. Registering one component receipt also cannot complete the component phase; valid non-failing receipts must cover the approved plan.

Capture: `scaffold_configs.py` writes a config per component and names the ones a human must finish; `measure.mjs` records the box model and typography per breakpoint; `capture.mjs` takes element-scoped screenshots. Playwright is not vendored and resolves from the current working directory. `DESIGN_LAB_BROWSER_EXECUTABLE` selects an installed browser when a Playwright-managed Chromium download is unavailable. See `skills/capture/SKILL.md`.

Token sources are ranked by evidence. A substantial theme-loaded custom-property layer states runtime intent and wins. Source-authored Sass is next, then a recovered Sass source map. Weak or unloaded CSS never outranks the theme sources merely because similarly named files exist.

`figma-component` owns one component transaction on purpose. `run` may process many transactions in one model session, but each becomes durable only after its build record is validated. Every recorded assertion must explicitly pass; skipped fidelity work and an empty assertion object remain incomplete. A partial run therefore resumes safely instead of pretending the library is done.

`verify` is the one that runs last and the one that should have existed first. Every other skill reports on its own step, so a library can pass all of them and still be half a library — which is exactly what happened on the Paragraphs site: four empty Foundations pages, 36 of 43 components missing, no documentation links anywhere, and sixteen variables whose Dev Mode names existed nowhere in the codebase. Nothing was looking at the whole.

Planned: `drift`.

## Fonts

Every site's font trouble has been its own, so fonts are a step of each run, not of setup. When the build is ready to write, `workflow.py connect` asks Figma desktop which fonts it can draw with and writes the run's font plan, `fonts.json`. For each text stack the site renders, it works out the family the visitor really sees: a family declared with no source is skipped, as the browser skips it; icon fonts and generic families are set aside. Each family is then available to Figma, or missing with a stand-in chosen by genre (the same design under its other macOS name when Figma desktop leaves a system font out of its list, such as Courier New for Courier, which needs nothing installed; a metric-compatible clone where one exists, such as Arimo for Arial) and the route to the real font: the Adobe Fonts kit to activate, the open-licence files to install, or the client's desktop files or the foundry's trial for a commercial family, never the site's web font files. The run never stops for a font. The build draws each weight in the face the site really serves (a `font-weight: 500` rule serving a Semibold file is drawn Semibold), matches style names generously, accepts trial and web family names, and uses a variable font's weight axis when no named style fits. Verify and the completion message name each stand-in as a decision, not as a failure. `workflow.py fonts --project <run>` writes the plan again from the font list recorded at the last `connect` (or, before the first, without one), and `workflow.py report fonts --project <run>` shows it. The step writes `fonts.json`, `figma/available-fonts.json` (Figma's list) and, for a site using Adobe Fonts, `fonts-kits.json` (the kit's families, read once) in the run folder.

## Watching a run

`design-lab:run` and `design-lab:figma-build` open a pane beside the transcript as they start, and it stays open for the whole run. Typed as slash commands, the pane opens at any window width; asked for in words, Claude Code places a pane it was not asked for only in a wide terminal (144 columns). If the project's newest run is finished, the pane waits for the new run's folder rather than showing the old recap; if it is unfinished, that is the run being resumed and it shows at once. `/design-lab:watch [run folder]` opens the same pane by hand, after it was closed or for a run started elsewhere. The pane shows the run as five stages (Preflight, Discovery, Build, Verify, Report), one row each with its result, and opens the stage under way beneath its row: the preflight checklist, ticked off as preflight proves each check; the build's steps done of total and whether the runner is connected. A word in the header says where the run stands (for example Building, Needs you, Failed, Done or Done · needs review), and a card above the stages says what the person has to do, or what went wrong. It also keeps a status line such as `design-lab: steps 112/158 · runner connected · 41m` in that session. With no folder it shows this project's newest run, found by the convention `design-lab:init` chose from the folder the session is in, and moves to each newer run there as it starts; before the first run it opens and waits for one. Outside any project it falls back to the run `workflow.py init`, `preflight` or `connect` last recorded in `~/.design-lab/active-run.json`. Figma is first touched when the build is ready to write: `workflow.py connect` asks the person to open the target file and start the runner, and the pane shows that as the one thing that needs them, with no button, until the runner connects. When the runner later stops asking for steps, the pane says what to do in Figma desktop and offers one button, **Resume run**, which puts the resume request in the prompt box. When the benchmark has written `completion.md`, a toast says the run is done, the status line clears, and the pane leads with the verdict (when verification left blocking or major problems open), the run's coverage, accuracy, time and tokens, and links to the Figma library, the benchmark report and the run's files; its Recap shows the full completion message. `/design-lab:recap [run folder]` shows any finished run's completion message again, with no Claude turn.

The pane is a Claude Code mod (`hooks/mod/`), which needs a Claude Code that loads mods (2.1.286 does; 2.1.284 does not) and draws in the terminal and the desktop app's Code tab. The desktop app runs its own copy of Claude Code, updated separately from the app; the pane draws there as a sidebar once that copy loads mods, and until then the command answers with text. It only reads the run folder and the pointer (`preflight-checks.json`, which `workflow.py preflight` rewrites as each check starts and settles, is in the run folder); it writes nothing and never reads the runner token. Everything works without it: where the mod is not loaded, or nothing draws (`claude -p`, the VS Code chat panel), the same command prints the same summary from `workflow.py watch`. Mod tests run with `claude plugin test design-lab`.

## References

- `references/prior-art.md` — **read first.** Look for an existing Figma file and existing tooling before extracting anything
- `references/model.md` — the universal model and the provenance rule
- `references/variant-policy.md` — the decision that makes or breaks the library
- `references/findability.md` — how anyone finds a component in a 146-component file
- `references/tokens-and-variables.md` — code syntax, and why the Figma name is not the token
- `references/defaults.md` — which variant goes first, and the evidence for it
- `references/verification.md` — assert numbers, do not eyeball 146 components
- `references/benchmark.md` — run checklist and fixed opening prompt; every run ends with `design-lab:evaluate`
- `references/completion-message.md` — the fixed reply `design-lab:run` ends with
- `references/build-records.md` — the idempotency and resume contract
- `references/strategies/README.md` — per-strategy mapping and counting traps

## Evaluation replays

The corpus and scoreboard use explicit per-person locations from `~/.claude/design-lab.json`, or the file named by `DESIGN_LAB_CONFIG`:

```json
{
  "corpus": "/path/to/corpus",
  "scoreboard": {
    "ledger": "/path/to/ledger.jsonl",
    "dashboard": "/path/to/dashboard.html"
  }
}
```

All three keys are required. The commands never create or edit this configuration. `scoreboard.py record` appends to the ledger and redraws the dashboard from the whole ledger; `--open` shows it.

```bash
python3 scripts/corpus.py freeze --run /path/to/finished-run --label site-a
python3 scripts/corpus.py list
python3 scripts/tier1.py --all --out /tmp/property-results.json
python3 scripts/tier1.py --run /path/to/run --out /tmp/property-results.json
python3 scripts/tier2.py --site site-a --file-key SCRATCH_FILE_KEY
python3 scripts/scoreboard.py record --run /path/to/evaluated-run --tier 2 --site site-a
python3 scripts/scoreboard.py rows
```

Freezing copies the run and writes a manifest with artifact hashes and producer identity. An existing label is refused; use a new label to record a corpus refresh. Older manifests may have no producer commit; that absence stays explicit. Both component-id and older machine-name measurement files are supported.

Tier 1 rebuilds the same trees as `figma_build.py init`, in a temporary directory, and compares their resolved breakpoint properties with the saved measurements. Its output is JSON; one summary per site goes to standard error. Geometry uses tree layout arithmetic, not font shaping or Figma rendering. Geometry needing font shaping says unmeasured. Older captures have styled inline descendants rather than exact character ranges, so text run counts identify distinct measured inline styles and flag flattening; their basis is recorded beside each result. Captured states absent from the default responsive tree are reported as unmeasured. This comparison does not change the builder or verify's gate.

Tier 2 requires Figma open with the runner. It creates a new workspace under the site's `replays/` directory, clears the designated scratch file, rebuilds with frozen images, waits for the build and verification dumps, assembles measurements, verifies, and scores. The runner stays open between evaluations; for `--all`, have it open in each scratch file. The image step has no site or public fallback requests: uncached sources remain failures. For `--all`, add a `scratchFileKey` to each site's `corpus.json`; file keys are checked before any replay starts. `--timeout` limits the wait per site. Failed evaluations keep the workspace and its evidence for inspection. Verification findings do not prevent writing the scorecard. Corrected comparison results accompany the evaluation while the existing `master-matches-capture` gate continues to use its original metric.

The benchmark and ledger share `run_metrics.py`; neither imports the other. Missing metrics remain unmeasured or null. Recording an evaluation is a separate explicit step, so replay does not silently append a ledger row.
