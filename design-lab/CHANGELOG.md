# Changelog

## 0.19.0

**One Site Studio strategy for both kinds of component, read from where the site says its configuration lives; Figma touched only when the build is ready to write; and a pane that no longer cries wolf.** Found while watching a real run of a Site Studio site, where 0.18.0 detected none of its 168 components.

- `design-lab:init`, run once per machine, settles everything about the person and the machine, asking before it installs or changes anything: where runs live (`project`: `PROJECT/design/<date>`, recognised from `PROJECT/worktrees/<name>` or a folder above the repository holding `plans/`, `analysis-reports/` or `design/`; or `home`: `~/.design/<project>/<date>`; never inside a repository), the operator's name, one shared Playwright and Chromium in design-lab's cache folder (capture's default `--node-cwd`), the Python packages (with `--break-system-packages` on Homebrew's Python, user folder only), the Figma runner and its import, and the Claude Code read-blocking setting, with the restart steps and prompts when it changes. `scripts/lab_setup.py check` reports the same without changing anything; `design-lab:run` checks it first. Fonts are deliberately not part of setup: every site's font trouble has been its own.
- `workflow.py init` creates the run folder by that convention when no `--workspace` is given, and prints it; the operator's name comes from setup. The fixed opening prompt no longer names a workspace or operator.
- `/design-lab:watch` with no folder shows this project's newest run, found from the session's folder by the same convention, and follows each newer run as it starts; before the first run the pane opens and waits for one. `workflow.py watch` does the same in text.
- `workflow.py report capture|selectors|plan|verify|build --project <run>` summarises a run in one plain command, and the run skill tells Claude to use it, absolute paths and one command at a time instead of `cd`, shell variables, loops or inline scripts, which Claude Code asks the person to approve when its read-blocking setting is on.
- Site Studio's configuration export is read from the folder the site's own settings declare (`$settings['site_studio_sync']`, or Drupal's `config_sync_directory` when that is absent), never guessed from folder names. The run records it as the decision `sitestudioConfig`; `workflow.py select --sitestudio-config <folder>` names another, and makes Site Studio selectable even when detection could not see it. A setting that cannot be read without running PHP, settings that disagree across sites or files, or a declared folder that is missing are reported with what to do, not guessed past, and preflight gives no go-ahead to a Site Studio run until the folder is recorded. Detecting again keeps a folder a person named. `scripts/sitestudio_source.py` holds the rule; detection, component extraction and token extraction all use it.
- Custom components written in code are found on their own, whether or not the site has configuration-driven ones, the way Site Studio finds them: the `custom_components` folder of the site's own active modules and themes (from `core.extension.yml`) and of the Drupal root, recursively, following symlinks, skipping the folders Site Studio skips, the first definition of a name winning, `name` and `category` required. A component without a form is kept with no fields. Duplicates and refused definitions are listed as problems.
- Kept from an earlier unmerged branch and now released: `json_values` written as a block scalar, usage counted from Site Studio's own layouts, and compiled Site Studio templates located for capture.
- Detection recommends Site Studio over a smaller block and paragraph vocabulary beside it (one site has 2 such bundles and 146 Site Studio components).
- Verified offline on three Site Studio sites: 168 + 4 custom, 146 + 6 custom and 101 + 3 custom components, no problems. Every earlier Site Studio library left the custom components out. Following the declared folder changes one site's custom styles from 172 to 176.
- Site Studio defects come out in a fixed order, so the same source gives the same `components.json`.
- Every registered artifact records which copy of design-lab wrote it (`producedBy`: folder, version, commit, whether it had uncommitted changes, or null when that could not be checked), so a fix applied mid-run can no longer hide behind the version recorded at init.
- Preflight leaves Figma alone. It records the target file's address and checks only what needs no one: the local site, the DDEV project for a database usage source, that the runner port is free (or held only by a finished run's server, stopped later), that node resolves Playwright in the folder given as `--node-cwd` or found in the repository (the folder to give capture), that `cairosvg` imports, and that the plugin version has not changed since the run began; it reports whether Twig debug markup is present, as information. Each check is ticked off in the pane.
- `workflow.py connect`, run when the build is ready to write, does what preflight's Figma part did: starts the runner server, asks the person to open the target file and start the runner, checks the file is the target and empty (or holds this run's own build), and draws the name-only Cover. It records `target.connection` (older runs' `target.preflight` and file address are still read, and a resumed build keeps its Cover proof) and logs `connect` `waiting`, then `complete` or `stopped`, including when the server cannot start.
- The scorer counts the build's wait for the runner as planned: anything from a `connect` `waiting` entry until that attempt completes or stops, each attempt kept separately, to the fraction of a second. A connection that fails is an interruption, as before.
- The run skill tells Claude to use absolute paths and `--project`, never `cd` into the run folder, which made Claude Code ask the person to confirm commands even with permission checks bypassed. The README says when the pane appears in the desktop app, which runs its own copy of Claude Code. Pane: a finished run no longer shows "runner server not responding", since its server is stopped on purpose.
- Runner: after `connect` succeeds against a file whose previous build is complete, the server keeps the runner waiting for the new plan; it used to answer "done", and the runner closed before `figma_build.py init --rebuild` had run. Found on the first real rebuild with 0.19.0.
- Build: a frame whose element has `overflow: hidden` (or `clip`, `auto`, `scroll`) on the site now clips its content in Figma. A carousel's track is many slides wide inside a window that hides them (one measured 19,094 pixels inside a 1,305-pixel window); unclipped, it stretched the component's frame across the page.
- Pane: `/design-lab:watch` brings the pane to the front; with another pane open (Claude Code's changed-files pane), it used to open as a tab behind it. Content starts below the close button's row; a runner that is not needed yet shows as "runner idle until the build" in grey, not "runner not seen" in yellow, and its stale "Connected" message is dropped (`workflow.py watch` says the same); while the build waits for the person to start it, it shows as "waiting for the runner to start"; a `waiting` entry in the phase log (the build's wait for the runner) shows as "Needs you" with no button and one toast.

## 0.18.0

**A pane that tells the person where the run is and when it is done, without asking anything of them.** `/design-lab:watch` opens it beside the transcript; it is a Claude Code mod, so it needs Claude Code 2.1.287 or later, and everything works as before without it.

- Pane: preflight, the phases with the current one marked, build steps done of total, whether the runner is connected, the runner log's last eight lines, and anything that needs the person. A status line such as `design-lab: steps 112/158 · runner connected · 41m` stays visible in that session and clears when the run finishes.
- Watchdog: when the runner stops asking for steps, or the runner server stops beating, the pane raises one toast per stop and shows what to do in Figma desktop, with one button, **Runner restarted, resume**, which puts the resume request in the prompt box (or sends it where there is no prompt box).
- Recap: when the benchmark writes `completion.md`, one toast says the run is done, the status line clears, and the pane shows the completion message as Markdown, links included. `/design-lab:recap [run folder]` answers with it for any finished run, with no Claude turn.
- Preflight checklist: `workflow.py preflight` records every check as it starts and settles in `preflight-checks.json` (id, label, status, what to do, what it waits on), so the pane's Preflight group ticks each one off with nothing to press: site address, the local site answering, site label, operator, the usage source's DDEV project, the Figma file address, the runner connected, and the target file accepting writes. A check that needs the person shows preflight's own message until a later pass proves it; once preflight passes, the group folds to one line. `workflow.py watch` prints the same list, and the status line counts it (`preflight 5/7`).
- Status line: the engine already shows the plugin's name, so the line no longer repeats it; times show on the person's clock.
- Scorer: `scorecard.json` names the build it scored (`run.buildCreatedAt`, the project's creation time), and `report.html` and `completion.md` are written atomically, `completion.md` last. A recap left in a folder that was initialised again is not taken for the new build's; a recap from before the stamp counts once the build has recorded its benchmark as complete. The active-run pointer is left in place, so a finished run's recap stays one command away until the next run starts.
- Tests: the SVG fixture has a size, which cairosvg 2.9 requires.
- Runner server: writes `figma/progress.json` atomically on every request and on a ten-second heartbeat of its own (state, steps done of total, the current step's kind, whether a step is in flight, when the runner last asked, its process id), so a slow step reads as working and a dead server as not responding. `runner-seen` is written atomically too; a poll could read it half-written.
- `workflow.py init` and `preflight` record the active run in the person's design-lab folder (`active-run.json`); `workflow.py watch [--project]` prints the same summary as text, and is what `/design-lab:watch` answers where the mod is not loaded or nothing draws.
- The mod reads only the run folder and the pointer, writes nothing, and never reads the runner token; a test holds it to that. `hooks.json` quotes the guard's path.

## 0.17.0

**Runs can now be replayed and compared: a frozen corpus of finished runs, a property replay that needs no Figma, a rebuild in a scratch Figma file, and a scoreboard ledger with a dashboard.** The measure comes first, so the fixes that follow can be shown to help.

- Corpus: `corpus.py freeze` copies a finished run into the person's corpus with a manifest of artifact hashes and who produced it; `list` shows what is frozen. An existing label is refused.
- Tier 1: `tier1.py` rebuilds the build trees in a temporary folder and compares their resolved breakpoint properties with the saved measurements, with no Figma and no network. Geometry that needs font shaping is reported as unmeasured.
- Tier 2: `tier2.py` rebuilds a frozen site in its scratch Figma file through the runner, with frozen images only, then verifies and scores it. A failed evaluation keeps its workspace for inspection.
- Scoreboard: `scoreboard.py record` appends one row per evaluation to the person's ledger and redraws the dashboard; `--open` shows it. `design-lab:run` records each finished run and opens both the benchmark report and the dashboard, and skips the step when no configuration exists.
- Locations come from `~/.claude/design-lab.json` (or `DESIGN_LAB_CONFIG`): `corpus`, `scoreboard.ledger` and `scoreboard.dashboard`. Nothing creates or edits that file.
- The benchmark and the ledger share `run_metrics.py`; `score_run.py` lost its private copies. `figma_build.py` exposes the tree builder on its own (`build_trees`), and `fetch_images.py --offline` resolves only frozen images.

## 0.16.0

**Unattended runs survive a failed Figma step, and Massport, the first site after America's Credit Unions, builds end to end: 34 of 41 buildable components, carrying 82% of placements; 14 of 102 widths within tolerance, and the verify gate still open on visual fidelity.** A failed step no longer closes the runner: the plugin stays open and waits, so a fix to a template or the server resumes the build with nobody in Figma. Four defects the Massport run hit are fixed.

- Runner: a failed step is reported with its message as well as its stack (the sandbox's stack has no message line, so two failures read only `at style (<input>:127:46)`), and the plugin waits instead of closing. The server answers "wait" for the failed step until `figma_build.py init` rewrites the build state or the server restarts. A failed preflight check still closes the plugin. The runner must be restarted once to load this.
- Usage: refuses a site whose Twig debug is off (`--without-twig-debug` accepts it). On Massport, usage run before Twig debug was on lost every component located by its template, `feature_card` alone carrying 269 placements.
- Usage: an enabled module with no field table no longer fails the phase; Layout Builder on with no per-node overrides never creates `node__layout_builder__layout`.
- Usage: class markers are counted with HTML comments stripped. Twig debug comments name template files such as `block--icon-block.html.twig`, which read as a class the page never prints; three blocks (56 placements for `icon_block`) came out with selectors that matched nothing.
- Build: an effect colour measured without an opacity gets alpha 1, as fills already did; `a: undefined` stopped the build at the first inner shadow.
- Runner server: an image over Figma's 4096-pixel limit is scaled to fit before upload; the node it fills keeps its measured size. Full-page captures of a long accordion (4546 and 5148 pixels tall) stopped the evidence upload.

## 0.15.6

**The last America's Credit Unions refinement: faster iteration, consistent derived layouts, cleaner reveals, sturdier runs, and skills that teach all of 0.15.x.** Benchmark against the 0.15.0 run on the same site: 46 of 61 buildable components built (from 26 of 59), carrying 91% of the site's placements (from 25%); 40 of 138 widths within tolerance (from 13 of 78).

- An iterating rebuild (`--iterate`) skips the full node-tree dumps, which serve run-to-run comparison: a build-and-verify cycle went from about 15 minutes to under 5.
- A child's rendering inside its parent uses one occurrence at every width, so the widths merge into one tree (each width picking its own merged three different cards, each shown at one width only).
- A wrapping row's column gap leaves a pixel of slack, so half-pixel rounding no longer wraps the last item.
- A revealed element (a closed menu's panel) is raised to the top of the stacking order for its screenshot, so other layers do not paint over it.
- Capture: a step stopped at its limit is killed with its process group, so no browser outlives it; limits are 15 minutes to measure and 30 for screenshots, sized for a slow local site.
- `ensure_server` refreshes the runner files whenever it runs and says when the runner must be restarted, so a server restarted after an update never meets an old runner.
- Skills: capture (Twig debug without disabling the Twig cache, child tagging, derived children, reveals, step limits), usage (site-wide home-page candidates, template markers first) and run (waivers, and the fix-and-rebuild loop) describe what 0.15.1 to 0.15.6 added.

## 0.15.5

**Positioned layers, decorations, transformed tracks and embeds drawn where the site draws them; capture can no longer hang.** On America's Credit Unions: verify open findings 3 → 2 (fonts waived by decision); live-capture comparison 25 → 27 of 46, with five components newly passing at desktop and two passing outright.

- Absolutely positioned children no longer shape their parent's flow: the layout comes from the in-flow children, and the positioned ones are drawn over it as absolute children (`layoutPositioning: ABSOLUTE`) at their measured offsets, slotted into the layer order by CSS stacking.
- Decorative `::before`/`::after` boxes (empty content, a background colour, absolutely positioned) become layers at their computed offsets, including any translate, cropped to the component, painted ahead of the element's children. Measurement records `top`, `right`, `bottom` and `left`.
- A child moved by a CSS translate (a carousel's slide track) puts its parent in free placement, so the slide in view stays in view.
- Children drawn in a different order than the DOM (`row-reverse`, `order`), the same at every width, are laid out in drawn order.
- Embedded documents (iframes, video) show their own capture crop at each breakpoint, each visible only at its width, since another document reflows by width.
- Rebuild in place leaves an empty page someone added (a note while showing the file) where it is, in both the wipe and the page step; a foreign page with content still stops the build.
- Capture bounds every browser step (measure 5 minutes, screenshots 10): a page script that never returns now fails one component instead of stopping the run.

## 0.15.4

**Every layout a component renders in is a variant, and the page names everything unresolved.** On America's Credit Unions: nested-component-coverage, example-path-portable and known-gaps-current cleared; verify open findings 5 → 3 (visual comparison, the build-record assertions that follow from it, and fonts Figma lacks); 46 components built.

- A built child whose rendering inside a parent differs in structure from its own capture (a card with three text layers inside one block, seven on its own page) gets that rendering as an alternate layout: built in the child's step as a sibling variant (`Layout=In <parent>`), and the parent nests the variant whose structure matches. New `nesting.py` holds the subtree derivation shared with capture.
- A set of observed layouts is a legitimate set for `variants-are-sets`; the block's comparison measures the captured variant, not the whole set.
- Components hosted by a menu link, notification or other non-page entity, and configuration-placed blocks, take the home page as an example candidate; Twig debug confirms them (a mega menu's featured items).
- `/` is a portable example path when it follows the Example label.
- Getting Started's Known gaps names what the build measured as unresolved, by the check that reports it: components over the comparison threshold (with their worst difference) and fonts Figma lacked.

## 0.15.3

**Fix and rebuild without anyone in Figma; variants, nesting and layout fallbacks resolved from evidence.** On America's Credit Unions: 45 components built (from 36), verify open findings 6 → 5 with variants-are-sets, breakpoint-triad and layout fallbacks cleared and nested-component-coverage from 20 parents to 1.

- `figma_build.py init --rebuild` rebuilds in the same file after a `wipe` step that removes only design-lab's pages and collections; `--iterate` keeps the runner connected between builds. A finished build answers `done` even after templates change, and a build whose templates changed mid-run makes the runner wait rather than close.
- Inline wrappers with no text of their own pass through (an inline `<picture>` reported a 28px line box around a 188px image); absolutely placed siblings are drawn in CSS stacking order; pseudo-element icons keep their rotation; image and vector leaves bind their width variable, so instances switched to another mode resize them.
- Measurement records the page backdrop behind each component and `object-position`; the documentation specimen paints the backdrop the live capture shows through transparent areas.
- Layout: positioned children out of reading order are placed freely without counting as a fallback; a stack whose order changes with width becomes one slot per placement, a moving child in two, each shown only where the site draws it there.
- Variants: each planned axis's value is read from the rendered classes (`width-default`, `banner-secondary`), unknown values stay unknown; the master becomes the observed variant inside a component set, and Known gaps names each uncaptured option.
- Nesting: child bundles are tagged during the parent's measurement (`data-design-lab-child`); Twig debug counts each child's own renders inside the parent (`capture/relationships.json`). A subcomponent that renders through its own template is built (library-standard.md section 1.4 amended), children build first, and a parent nests instances that take its rendering's text and images as overrides; a rendering whose structure differs is built as it stands and recorded as `nestedMismatch`. A slot the parent prints itself is recorded as not rendered, with the evidence; for a multi-type slot only the types seen rendering need instances.
- A child with no example page of its own is captured from inside its parent: its subtree of the parent's measurement and a crop of the parent's screenshots (the occurrence the screenshot shows most of, overhang painted with the child's backdrop).
- Capture: progress estimates use each component's previous time; records are keyed by what each page script does (`setupKey`), and records made under the old key are upgraded rather than recaptured.
- Images: a file missing locally is fetched from the public site; an `<img>` with inline SVG data is drawn as vectors. Verify: no breakpoint width order is required (sidebars and grids break any order).

## 0.15.2

**What the live page draws reaches the Figma master, and the visual comparison measures layout rather than fonts.** On America's Credit Unions this took the components passing the live-capture comparison from 2 of 36 to 18 of 36.

- Frames crop their contents wherever the site uses `overflow: hidden` or `clip`, including the master itself.
- Zero-size wrappers such as `<picture>` and `display: contents` pass through to their drawn children, so images inside them are no longer lost.
- Images drawn by `::before` and `::after` (`content: url(...)`, or an empty box with a background image) become icon layers beside their text; inline SVG data is decoded.
- `clip-path: circle()`, `ellipse()` and `polygon()` on a filled leaf are drawn as that shape, cropped to the element's box.
- CSS background images fill their frame from the site's own file.
- Fonts are matched by family regardless of case, spaces and hyphens (`articulat-cf` finds Articulat CF); families Figma lacks are recorded in the build record as `missingFonts`.
- The live-capture comparison masks the live text boxes at each breakpoint, keeping the unmasked ratio as `ratioUnmasked`; the new `fonts-available` check names each missing family once instead.

## 0.15.1

**Capture is incremental and checkable in seconds, and Drupal sites whose templates embed components are captured.** A refinement of 0.15.0 from a production run on a Drupal 11 site with Layout Builder and paragraphs, where capture was all-or-nothing and each fix cost a 30 to 60 minute run.

- `capture_all.py` records each component's outcome in `capture/records/` as it finishes, with the hash of the config and scale it came from; a later run skips complete components and rebuilds evidence from every current record. `--only` captures named components, `--fresh` redoes them, `--max-pages` (default 3) bounds the page fallback, and progress prints a measured time left per component.
- `check_selectors.mjs` and `capture_all.py --check`: one desktop page load per candidate page reports matches, visible matches and height. 40 components check in about 40 seconds.
- Components shown only inside an inactive tab or closed panel are drawn by showing their hidden ancestors, used only when no candidate page draws them naturally, and recorded as `revealed`.
- Measurements and screenshots are named by component id, so a block and a paragraph sharing a machine name no longer overwrite each other. `figma_build.py` still reads machine-named measurements from earlier runs.
- Drupal rendering recognises tag-form `{% embed %}` and `{% include %}` and records the component a template embeds as its root. Usage candidates are published nodes, newest first, and markers fall back from the wrapper class to the template's Twig debug suggestion (new `twig_debug.py`) or the embedded component's id; with Twig debug on, the exact template marker comes first.
- Variables: the breakpoint collection is `Core Breakpoint`; its variables say why they have no code name; Sass map entries take `map-get($map, key)` as their code name; the master's root width is bound to its variable; every binding is counted in the build record.
- Layer names: text elements are named `Paragraph`, `Inline text`, `Strong text` or `Emphasis` instead of Figma's default `Text`; a class-derived name that would be a Figma default is qualified by its block (`c-card__text` is `Card text`); imported SVG parts are named after their icon.
- Verify: boolean variables are exempt from `variable-scoped` (Figma gives them no scopes); `breakpoint-triad` no longer requires desktop to be the widest (a sidebar component is narrower at desktop than at tablet); the index headings are read from the header row's cells; the collection strategy reason reaches the verify state; `captures-unique` understands id-named files; `code-syntax-resolves` checks `map-get` names.
- Runner: verification dumps older than the newest build result are taken again; the page dump resolves main components asynchronously; runner requests skip the payload size limit; `verify_state.py` merges the dumps.

## 0.15.0

**A benchmark closes every run, and the Cover is for the library's recipient.** A run now ends by scoring itself into a report worth showing to colleagues, and every number in the file and the report comes from one place.

- Each usage-tier page's summary now gives only the tier's component count and placements, which are true before and after the build; whether each component was built is on the Cover and in the Getting Started index.
- Added `design-lab:evaluate` and `scripts/score_run.py`. The scorer reads a run workspace and writes `benchmark/scorecard.json`, validated against the new `schemas/scorecard.schema.json`, `benchmark/report.html` and `benchmark/completion.md`. The report is one self-contained file with inline charts and thumbnails that works in light and dark modes and prints cleanly. It opens with coverage — built out of the components the run could have built, the gap by reason, and the share of author placements the built components carry — then what was built, how faithful it is, what it cost and how repeatable it is.
- `design-lab:run` now ends with the benchmark and replies with a fixed completion message (`references/completion-message.md`): the Figma link, coverage, headline accuracy, time and tokens by model, a link to the report as the developer audit, what was not measured, and where the known gaps are.
- Each report section is scored on its own and says whether it was measured, partly measured, not measured or scored later. A section without evidence explains why and how to measure it next time instead of showing a guessed zero. Foundations and voice, and blinded visual judgement, are placeholders with slots in the scorecard until people score them.
- Added `scripts/library_counts.py`, the one module that counts a library. The Cover, the Getting Started page and the report all use it, so they can no longer disagree. Placements now count inventoried components only; usage rows for things that are not components are reported separately. The Getting Started index now uses the tier the usage phase assigned, so a site header rendered by the theme on every page is High Use there too, not a retirement candidate.
- The Figma Cover now shows only the site's name, the line "Component Library", the number of components and how it splits into High use, Medium use, Low use and Other. Each built component counts in exactly one of the four, so they always add up to the total; a component placed on pages and also nested in others counts by its placements, and Other holds the rest (placed only inside other components, or no usage). The bar under the total is a true proportional bar: its segments are each category's exact share of the whole, colored to match the category's tile. The colors are a fixed palette that is the same on every run and distinguishable under the common color-vision deficiencies, with no grey. The platform eyebrow, lede, not-built count, placement, reference and token counts and both provenance lines are gone. Provenance (source commit, local site, capture widths, standard, renderer runtime, build date) is stored as hidden plugin data on the document and the Cover, and shown in the benchmark report. Getting Started keeps only its regeneration commands. Library standard 4.1.0 records the change; libraries built to 4.0.0 need a rebuild to pick it up.
- Accuracy against the live site keeps the original measure, so earlier results stay comparable, and adds a corrected one that counts height difference and unmatched area and applies the colour tolerance per channel, as the documentation always said. Results are recomputed from each component's specimen screenshot and reported as distributions per breakpoint, with side-by-side Figma and live thumbnails. `figma_compare.py --corrected` exposes the same measure; the default output is unchanged.
- Time and tokens are split. Library production runs from `workflow.py init` to the benchmark step's start; total wall time includes the benchmark. `--session <id>` (or `current`) reads that session's Claude transcript and its subagent transcripts only, sums input, output, cache-write and cache-read tokens, turns and tool calls per model with friendly names such as Opus 5.5, reports the tokens spent after the benchmark started as the increase benchmarking caused, and records which Claude configuration folder (account) the session came from.
- Repeatability reuses `compare_runs.py` when other runs are given, separates differences that only reflect when or where a run happened (timestamps, folder paths, each file's own links) from real ones, and checks that the accuracy verdicts agree across runs.
- `workflow.py init` now records run identity in `project.json` (`run`: plugin version and commit, site label, local site address, operator, Claude configuration folder and model, start time) and every phase change in `phase-log.jsonl`. Existing manifests stay valid; `workflow.py identity` fills in the block for older runs and records schema churn with `--schema-change "<what>"` or `--no-schema-change`. `workflow.py record` accepts a `benchmark` phase.
- Added `references/benchmark.md`: the run checklist and the fixed opening prompt.
- `design-lab:run` asks everything up front and then runs to completion. A new preflight step gathers every answer the run needs in one message (the local and public site addresses, the target Figma file and the runner's readiness, the site label, the operator, the component, token and usage sources, the DDEV project for a database usage source and what to do if it cannot be used, and whether to build the plan as proposed or stop for review), checks what it can, and either records the go-ahead with `workflow.py preflight` and says it is safe to leave the run to complete, or lists exactly what is missing. After the go-ahead the run completes through the benchmark and the completion message without pausing for confirmation; only a genuine blocker, where no path forward exists without the person, stops it, and resuming continues from the artifacts. `workflow.py approve --from-preflight` approves the plan as the person chose at preflight, and plan approval is now written to the phase log. The benchmark reports whether the run stayed unattended after preflight, counting every question to the person and every turn that waited for a prompt between the go-ahead and the benchmark, each with its phase.
- Preflight proves the Figma file can be written before the run starts its long work. `workflow.py preflight` starts the runner server, or reuses the one serving the run, asks the person to start the runner in the target file, then waits for it. The runner confirms the open file is the target and is empty, turns its first page into the Cover page, and draws a name-only Cover there (the site's name and "Component Library") through the real `cover.js`, which proves the connection, page creation, the Cover's font (IBM Plex Sans, or the reported fallback), writing and plugin data. The go-ahead is recorded only with that proof, together with the file's address, the Cover page's id and whether the font loaded; no runner within the timeout, a different file, a rejected token, an outdated runner, a file that is not empty or a Cover that could not be drawn is a hard stop that says what to do first, then why. The build fills in the same Cover page and refuses any file holding more than this run's preflight Cover. The `--runner-ready` confirmation is gone.
- The runner stays open and waits. Before the build has steps the server answers `wait`, and the plugin shows "Connected. Waiting for the build to start." and asks again every 5 seconds; it closes at the end of the build as before, and keeps retrying if the server stops answering. The server started at preflight runs detached, with its process id and log in the run's `figma/` folder, and keeps serving through the build; `workflow.py runner --ensure` restarts it if it has stopped. If the runner has not asked for a step for about two minutes when the build begins or during it, `workflow.py runner --await-runner` stops the run with what is needed first (open Figma desktop, the file, and the runner) and then why, logs the stop as an interruption with its phase, and the build continues where it stopped once the runner is back.
- The runner token belongs to the person, not the run: one token in `~/.design-lab/runner-token` (mode 600, in a folder of mode 700), created once, read by every server, and never written into a run or a log. The runner keeps it, so the person pastes it once per machine; a rejected token makes the runner ask again.
- Claude never reads, prints or copies the runner token. The run gives the person the command to copy it in their own terminal (`pbcopy < ~/.design-lab/runner-token`); the scripts read the file themselves. A `PreToolUse` hook shipped with the plugin (`hooks/guard_runner_token.py`) enforces it: any read, search, edit or shell command that names `~/.design-lab`, other than the copied runner plugin in `~/.design-lab/runner/`, is refused with that command for the person instead.
- Built means recorded, not planned. A component counts as built once its master (`build:<id>`) and its documentation block (`block:<id>`) are recorded in the build state; the state's list of components to build is now `planned` (older state files call it `built`, and are still read). A build that stopped early no longer reports every planned component as built, and receipts are written only for recorded components. The Cover is drawn after every component step, so its numbers are what was built.
- Re-scoring keeps the first benchmark. Once a benchmark has a recorded end, its first start-and-end pair is the benchmark: a later start never moves it, and `workflow.py record --phase benchmark --status running` does nothing and says so. The skills say to re-score with the scorer alone.
- A slow step no longer looks like an absent runner. The server notes when the runner asked, when each answer went back and when results arrive, reports a request still being served on `/health`, and `--await-runner` treats that as connected.
- A handshake answer that arrives after preflight stopped waiting is ignored instead of leaving the server unable to serve steps, and a handshake request without Cover arguments falls back to the name-only defaults.
- The token hook also refuses paths that climb out of `~/.design-lab/runner/` with `..`, and shell commands that name the token or the function that reads it together with a way to show it; ordinary runs of the scripts are unaffected. The function that reads the token documents that it is never printed.
- A damaged transcript line whose message is not an object is skipped instead of stopping the scorer.
- The first scoring of a run stops its runner server, and preflight stops a server left behind by a run whose build has every step recorded, so the next run is not refused. Preflight on a run whose build has begun in the same file proves only the runner's connection, since the file is no longer empty. When `--session current` has more than one session written during the run to choose from, the scorer names its choice on its output and in the report.
- Import the runner once, from `~/.design-lab/runner/`: preflight copies the current runner there, so updates need only a restart of the runner, never a new import. The runner sends its version with every request, and a runner older than the plugin is told to close and start again.
- One run at a time: a runner server serves exactly one run, for the best results in Figma desktop. Preflight refuses to start while another run's server is active, naming that run and how to stop it, and the multi-run `--project W --project W2` serving path is gone.
- The Cover is drawn on Velir Navy `#001B67`, dark enough that a white logo placed on it later keeps about 16 to 1 contrast, with every text in IBM Plex Sans: the headline SemiBold 128 white, the subtitle Regular 28 in `#E6E8FF`, the total SemiBold 176 white with the word "components" in Medium 48 white on the same baseline, and tile values SemiBold 44 white over labels in Medium 16 `#E6E8FF`. If Figma cannot load IBM Plex Sans, the Cover falls back to the kit font rather than failing the build. The category palette is adapted from the Velir chart palette with gold moved to High use: High use `#FAD200` gold, Medium use `#00AEEF` cyan, Low use `#00A457` green and Other `#417DFC` blue, each at least 3 to 1 against the navy and Other deliberately the quietest; crimson `#B9003F` is reserved for retirement candidates. The ground and palette are defined once in `scripts/library_counts.py` and passed to `cover.js` in the cover arguments.
- The report's coverage strip uses the Cover's category colors from the same definition, in the Cover's order, on a navy panel in light and dark modes alike, with a color key and a count for each category; not-built components stay outlined and retirement candidates are hatched in crimson. The report's usage-tier table reads the same way: High use, Medium use, Low use and Other with the Cover's built counts, which add up to the Cover's total, in their category colors on the same navy panel, then retirement candidates on their own row, not counted. "What the run built" and the completion message now split the gap exactly as the strip does (found, not counted, could have built, built, refused by the plan), every number from `library_counts`, so a refused count can no longer include retirement candidates.
- Time in the report is now only time that was measured, and the report defines each measure. Working time is when Claude or its tools were working, read from the session transcript, with subagent time merged so overlapping time counts once. The rest of the transcript's span is waiting, of three kinds: on the person (after a finished turn, or while a question or plan-approval tool waits for the person's answer), on usage limits (rate, session, usage or spend limits, until the limit resets) and on the service (overloaded or unavailable), each detected from the structured records Claude Code writes; working and the three waits add up to the span. The headline figure is working time to produce the library; the benchmark's own working time is given separately. The benchmark ends when its report is finished: the first scoring records that end in the run's phase log, so `design-lab:run` no longer marks the benchmark complete itself, and re-scores keep the recorded end. Wall time, from `workflow.py init` to that end, is shown only when both ends were recorded. The permission modes the transcript recorded are kept for developers, and a session not running with full access is noted in the report. A run scored without a transcript shows the runner's Figma build time and says working time was not measured, instead of a wall-clock span that included idle time. The scorecard's `cost.clock` fields changed accordingly (`wallSeconds` replaces `librarySeconds` and `totalSeconds`) and `cost.working` is new.
- The benchmark counts the time and tokens Claude spent producing the library, by Claude model: token tables list models whose id starts with `claude-`, any entry not attributed to one is only counted in the scorecard's developer field (`unattributedEntries`), and no command text or tool input is ever rendered.

## 0.14.0

**Model-native orchestration without model-dependent bookkeeping.** The plugin now gives a modern model judgment where judgment helps—source selection, variant policy, and fidelity—while moving state, validation, idempotency, and completeness into deterministic tools.

- Added `design-lab:run` and `scripts/workflow.py`: one resumable front door backed by `.design-lab/project.json`, repository/target identity, explicit decisions, phase state, artifact hashes, plan approval, and a completion gate.
- Added standard JSON Schemas and dependency-free validation for project, detection, components, tokens, plans, variable plans, and build records. Writes are atomic; an invalid replacement cannot destroy the last valid artifact.
- Added the combined `drupal-authoring` strategy. Block types and Paragraph types form the Drupal authoring site's 69-item editor vocabulary; its 109 SDCs are rendering primitives and no longer win by raw count.
- Added bounded Drupal rendering evidence. One deterministic pass maps every authoring bundle to existing Twig templates, included SDC definitions, adjacent stylesheets, root classes, referenced fields, and suspicious missing fields. The model can spend judgment on fidelity instead of launching broad searches for each component.
- Added source-authored Sass extraction, cycle-safe memoized resolution, typed variable planning, and reference collections for breakpoints and container widths. Theme-loaded CSS is matched by exact path so basename collisions and module-local properties cannot select a false token layer.
- Replaced repeated procedural skill prose with concise decision contracts pointing to the versioned standard. Added deterministic Figma state-dump scripts so verification no longer asks the model to reproduce long inspection programs from memory.
- Added validated foundation, index, and verification receipts. Artifact kinds are persisted in the manifest, unknown kinds fail closed, and an invalid receipt cannot mark its phase complete.
- Component completion is now derived from approved-plan coverage. Registering one build receipt leaves the phase running; only valid, non-failing receipts for every planned build can complete it, and whole-project validation detects missing or stale receipts.
- Fixed completeness verification silently ignoring the planner's actual top-level `plans` key. A parsed-but-empty plan now blocks instead of disabling the check.
- Added regression tests for atomic writes, schemas, Drupal source ranking, Sass planning, resumable workflow state, and plan completeness.
- Added deterministic DDEV-backed Drupal usage extraction. It reproduces the Drupal authoring site's 10,645 direct placements and 6,305 nested structural instances across all 69 components, registers `usage.json` as its own validated artifact kind, and blocks planning when detected usage was silently skipped.
- Resolved `list_predefined_options` values from their PHP plugins instead of treating Drupal's exported placeholder rows as real enum choices. The Drupal authoring site now resolves all 20 affected fields without model-written repair scripts.
- Bundle stylesheets are additive to child SDC stylesheets, so including `back-link` no longer hides `banner.scss` or `image-banner.scss`. Components and tokens now enforce and emit the standard's required `toolVersion`.
- Added bounded Sass `styleFacts` to Drupal render evidence. Root and nested-part declarations remain separate and retain whether each value came from a CSS custom property, Sass variable, or literal, eliminating another component-by-component source-search loop for the model.
- Verification now uses those deterministic facts to block a component that consumes a source token but binds no Figma variable, even when browser captures are unavailable. The state dump also counts bindings on the component root instead of descendants only.
- Detection no longer reports the active `.design-lab/figma-batches` workspace as external prior art merely because `workflow init` created it before discovery.
- Models can report unavailable evidence but can no longer authorise their own degraded path: usage and phase waivers now require a named human decider and non-empty reason, both validated in the durable project manifest. Final verification also refuses unresolved prerequisite phases, including capture.
- Common Drupal contrib fields (`email`, `telephone`, `smartdate`, and `block_field`) now map to the standard's text/reference kinds instead of being mislabeled as source-code defects.
- Re-running discovery, extraction, usage, planning, variable planning, or changing the Figma target invalidates dependent phase claims and receipt registrations while preserving the raw files for diagnosis. Resume can no longer mistake stale downstream evidence for completion.
- Build receipts now require a non-empty set of explicitly passing assertions. `not-run`, `skipped`, empty, and missing verdicts fail both artifact registration and whole-file verification instead of silently counting as finished work.
- The component skill now explicitly forbids using an editor-field anatomy diagram as the publishable component master. The master represents rendered UI; field anatomy stays on the documentation card, and insufficient rendering evidence fails or refuses the transaction.
- Figma state dumps and verification now recognize both documented card-root conventions (`— documentation` and `Human Label · machine_name (Family)`) and common durable index-row prefixes. This removes false negatives discovered during the Drupal authoring site control replay.
- Added first-class component-scoped capture evidence. The planner now distinguishes visual components, mapped subcomponents, schema-only entities, and retirement candidates; it refuses to publish a master when no live screenshot proves the component's visual identity.
- The Getting Started index is now placement-first and keeps component-master and documentation links separate. Canonical double-underscore build-receipt filenames resume correctly, repeated tier headers verify cleanly, and qualified Drupal source ids prevent block/paragraph name collisions from inflating completeness.
- Documentation is now source-complete decision support: Head, When to use, every authored field/property, every component relationship, desktop/tablet/mobile evidence, native Figma configuration, a root-relative label linked to the canonical FQDN, and actionable Notes. Refused and structural inventory rows remain traceable without fake component pages.
- Variable planning prefers one collection with slash-delimited groups unless lifecycle or mode boundaries justify another collection. Source-authored Sass now outranks a thin compiled-CSS palette, and map members without standalone code names carry an explicit Dev Mode explanation.
- Added live anonymous Drupal example verification, targeted multi-breakpoint capture, and a capture-evidence assembler. Screenshots are mandatory documentation evidence but can never be the publishable component root. Build receipts now prove native node type, source anatomy, three-width comparisons, and real nested instances for rendered source relationships.
- Browser-based capture and measurement accept `DESIGN_LAB_BROWSER_EXECUTABLE`, allowing a reproducible system-Chrome path when Playwright's managed Chromium is unavailable.

**Deterministic Figma builds.** An evaluation on a Drupal Canvas site showed a model relaying hand-written layout code could not build the same library twice. Layout decisions moved into fixed templates and scripts, and the model's remaining job shrank to relaying steps — or to nothing.

- Added `scripts/figma_build.py`: the whole library build as a fixed sequence of steps over fixed `scripts/render/*.js` templates. Each payload carries its arguments and a checksum, so a payload altered in transit is refused rather than built. `next` refuses to run if the templates changed since `init`.
- Added the design-lab runner (`runner/` plus `scripts/figma_runner.py`), a Figma development plugin that fetches each step from localhost and posts the result back. No model is in the loop, so a build costs no tokens. Three builds of the Canvas site produced 7,389 nodes with zero layout, style, typography, or binding differences between runs.
- Added `spec_to_tree.py` and `responsive.py`: measured components become one deterministic Figma tree, and three breakpoint measurements merge into one responsive master instead of per-breakpoint drawings.
- Added `compare_runs.py`, `determinism.py`, and `figma_compare.py` for repeatability scores, canonical layout hashes, and per-variant comparison against live captures.
- Added published-site extractors: `extract_compositions.py` (component sequences per page), `extract_voice.py` (the copy voice report, see `references/voice.md`), Drupal Canvas registrations and usage, `find_rendered_components.py`, and `capture_all.py` to run capture end to end.
- Added `fetch_images.py`, which re-encodes AVIF and other formats Figma cannot upload as PNG.
- `references/relay.md` documents the runner, its one-time manual import into Figma desktop, and the model-relay fallback. The README gives a prompt that produces machine-specific install steps.
- Fixed the Drupal usage crawler skipping certificate verification for every HTTPS site, including public production pages. Verification is now relaxed only for local development hosts (`localhost`, loopback, `*.ddev.site`, `*.localhost`). The same rule now covers every published-site extractor: `find_rendered_components.py`, `published_pages.py`, `extract_voice.py`, and `extract_compositions.py` had still accepted any certificate.
- Build records no longer assert what nobody checked. The block step now reads the master back from the canvas — its node type, whether its root carries an image fill, every nested instance and the component it comes from, and the field rows actually drawn — and the native-component flags are derived from those readings. A slotted component with no real nested instance now fails relationship coverage instead of passing on a hard-coded `true`, and a block recorded before these readings existed fails closed.
- Slot `accepts` is always a list: `["*"]` means any component. Every extractor used to write the bare string `"any"`, which the build-record schema rejected and verification compared letter by letter; older inventories are read the same way.
- The runner is locked to the plugin. The server prints a random token when it starts, the plugin asks for it once and keeps it, and every request without it is refused. Cross-origin reads are allowed only for a plugin's own origin instead of any web page, so a page that learns a file key can neither read steps nor forge results. The unused `--port` flag is gone, a malformed request body gets an error reply, and two workspaces claiming one Figma file are refused instead of one silently replacing the other.
- A component captured at only some widths now gets a build record with a failing `breakpoint-evidence` assertion naming the missing widths, instead of stopping receipt generation for every component. Each capture now lands in the rectangle of its own column when a width was captured but not measured.
- Components with no usage tier get a `Components — Untiered` page instead of stopping the build; with no usage source at all, the five tier pages collapse into that one, as the standard requires.
- An image that cannot be fetched no longer stops the build: it is recorded as failed and the build record's image-upload assertion names it. SVG is rasterised to PNG with cairosvg when installed and otherwise recorded as failed, because Figma cannot use SVG as an image fill. An upload the plugin cannot complete now fails its step, so it is reported rather than recorded as done.
- `compare_runs.py` reads the page dumps the runner writes to `figma/dump/`, so the build's state file is no longer compared as a page, and it compares the variables step's recorded result.

## 0.13.0

**The build side now instructs what the verify side checks.** An audit of all 30 checks against the build skills found 8 with *no* build-side instruction at all and 5 only implied. The verifier had been running ahead of the builder, which means a faithful run of the pipeline produced a library its own verifier rejected.

- **`figma-component` builds the documentation card again.** Deleting `figma-atlas` in 0.10.0 took the only "build every card" instruction with it — a regression this release introduces the fix for. The card is now step 9, built beside its component on the same page, with the section 5 anatomy, the fields **table**, named layers, and `shot:`/`scale:` frame naming. Folding it into `figma-component` rather than restoring a separate skill is deliberate: adjacency is then true by construction, which is what `documentation-adjacent` requires.

- **`figma-foundation` creates the file's pages.** Nothing did. `figma-component` was told to "resolve the target page from the usage tier" against pages that no skill had ever made.

- **`figma-foundation` names collections `<Brand> <Domain>`.** It previously specified `Primitives`, `Semantic`, `Spacing`, `Type` — unprefixed, which is exactly what `collection-naming` fails. The build skill was instructing the defect. Mode naming is now explicit too, rather than left to whatever the variable plan generated.

- **All six extractors stamp `standardVersion`**, and `model.md` and `build-records.md` carry it in their example shapes. Section 10 required it and nothing wrote it. Verified end to end against the real Drupal authoring site repository: 33 paragraph components extracted with `standardVersion: 2.1.0`.

- **`figma-component` step 2 handles machine-name collisions** and step 6 states the `COMPONENT_SET` requirement outright.

### Two bugs of mine, both silent

- **`structuralRefs` was read as `structuralReferences`** in `index_rows.py` and `verify.py` — a key that exists nowhere in `references/model.md`, in `find_examples.py`, or in any real artifact. It always resolved to `None`. Consequences: `two-usage-numbers` failed every library that had the data (all 69 Drupal authoring site components carry it), and `tier_of()` could never assign the Structural Only tier, so **every load-bearing component was tiered as a retirement candidate**. On the Drupal authoring site that moved 3 components out of a list headed "safe to delete" — Structural Only 0 → 3, Retirement Candidates 17 → 14. Both readers now use the model's key and accept the longer spelling rather than silently returning zero.

## 0.12.0

**Standard 2.1.0 — the last three unenforced expectations now have checks**, bringing the set to 30. Each enforces something the standard already required in prose, which is why this is a minor rather than a major: a library genuinely conformant to 2.0.0 stays conformant.

- **`index-complete`** (blocker) — every component in the inventory has a row in the index, *and* the page rendered into Figma is not stale against the index it was generated from. Both are checked, because a reader trusts the page, not the JSON. Section 8 said "every discovered component gets a row" and nothing had ever confirmed it; `--index` was read for exactly one thing, the tier thresholds.
- **`index-links-resolve`** (blocker) — a built component whose index row links to nothing is a component nobody reaches from the one page that claims to list the library.
- **`variants-are-sets`** (blocker) — variants left as loose components instead of a `COMPONENT_SET`. Only a set gives Figma a variant picker and lets the variants be compared against each other, which is the whole point of building them. Uses `plan.json` where available; otherwise detects the shape the mistake takes on canvas — several loose components sharing one machine-name stem. Section 4.4 now states the requirement outright rather than presupposing it.

- **The state dump captures node type and variant count**, without which a loose component cannot be told from a set, and an `indexRowCount` read from the rendered page. The index container is named `Index` and each row `row: <machine_name>` so that count is possible.

- Checks that cannot run still report "not checked" rather than passing. Run against the real Paragraphs site artifacts, `index-complete` confirms all 44 components are listed and `index-links-resolve` passes, while `variants-are-sets` correctly declines to answer because that state dump predates the node-type field.

## 0.11.0

**Standard 2.0.0 — the library is a seed of ground truth, not an idealisation.** This inverts a rule that was stated in three places and was actively harmful.

The plugin previously instructed the builder to bind every visual property to a variable and to *"finish at zero hardcoded fills — assert it"*, and `verification.md` asserted that a raw value was a defect. That silently upgrades the component. A theme that hardcodes `#342649` where it should use `--bs-purple` produced a Figma component with a clean bound variable: the flaw vanished, the designer best placed to notice it never saw it, and the two sides were never comparable, which makes any later sync meaningless.

- **`library-standard.md` section 1** now opens with the governing principle: the Figma component is a faithful representation of the component as the running site implements it, **including its defects**. Bind where the source binds; hardcode where the source hardcodes, and record the divergence as a defect about the codebase. Never improve a component on the way into Figma. Divergence between Figma and code is the product.
- **`figma-component` step 3** and **`verification.md` section 2** rewritten to match. The binding assertion is now three-outcome — source binds and Figma binds, source hardcodes and Figma hardcodes, or a mismatch — and only the mismatch fails.
- **This is a major standard version** because a library built under the old rule can fail the new check.

- **`measure.mjs` records declared values, not just computed ones.** `getComputedStyle` resolves `var(--bs-purple)` and `#342649` to the identical `rgb(52, 38, 73)`, so the pipeline had no way to tell a token from a literal and the fidelity rule would have been unactionable. It now reads the raw declaration off the matching rules. Cascade order is approximated by document order plus matching media queries, not by specificity — stated in the code rather than implied, because that approximation can disagree with the browser.

  Verified against the live Drupal authoring site homepage: `body` computes to `rgb(52, 38, 73)` and declares `var(--bs-body-color)`; `h1` computes to `80px` and declares `var(--k--typography--font-size-h1)`; `a` declares the literal `transparent` for its background and is correctly distinguished.

  That run also found a defect in the existing library. The Drupal authoring site's `tokens.json` records `type/size/h1` with `codeName: null` and the description *"No custom property holds this value. Only the base body size is emitted, as --bs-body-font-size."* The site actually renders h1 through `--k--typography--font-size-h1`. The blank was explained by a wrong explanation, and `code-syntax-set` passed it because it only checks that *an* explanation addresses the absence, not that the explanation is true.

- **New check `bindings-match-source`** (blocker), bringing the set to 27. It compares the source's declared values against the Figma component's bindings and fails a component that binds where the code hardcodes, or hardcodes where the code binds. Compared at component level, not per property — mapping a CSS node path onto a Figma node identifier is a real problem this does not pretend to solve, and the check says so. Degrades to a `minor` "not checked" without `--measurements`.

- **The verify state dump captures `boundVariables`**, which it never did — so nothing had ever looked at whether a built component binds anything at all.

## 0.10.0

**`figma-atlas` is gone, and `references/library-standard.md` is new.** Both come out of comparing four libraries produced for real sites — the Drupal authoring site, Site Studio sites A and B, and the Paragraphs site. They share a page skeleton and almost nothing else: three different artifact classes, four naming schemes, four variable-collection conventions, and `components.json` files agreeing on four top-level keys.

- **`references/library-standard.md`** — the single answer to "what is a finished component library", at `standardVersion` 1.0.0. Artifact model, page list, component and card contracts, variable rules, evidence rules, the Getting Started page, the intermediate model, and 25 conformance checks. It versions independently of the plugin, against the *output*: a major means an existing library must change to stay conformant. Appendix A records which of the four libraries each rule came from.

- **`figma-atlas` removed; `figma-index` replaces it.** The atlas described itself as building "the only full-text index a Figma file has". That is false. Figma's Find searches the entire file across all pages, for canvas text and layer names, and the Assets panel matches descriptions as well as names. The atlas solved a problem Figma had already solved, and paid for it by flattening every field table, relation and screenshot into text — strictly worse documentation than the same facts drawn beside the component.

- **`figma-index`** owns the Getting Started page instead: inventory, coverage counts, the linked index, known gaps and provenance. It is idempotent and meant to run *early and often* — once before anything is built, when every row reads *not built* and that is the coverage baseline, then again after each component. The index is a table of contents, and the skill says so in as many words, so nobody rebuilds a search index by accident.

- **`scripts/index_rows.py`** — joins `components.json` with `builds/*.json` into the index rows. Two checks that fire on real data: `usage-data-missing` (Site Studio site B and the Paragraphs site both carry `"usage": null` for every component, so no tier can be assigned) and `machine-name-collision` (the Drupal authoring site has 12 machine names used by two components each — `block:accordion` and `paragraph:accordion` — which cannot both be named `machine_name — Human Label`, and would have produced 12 pairs of identically-named Figma components).

- **`references/findability.md` corrected.** Its search table had two false rows, and its instruction *"if an existing library file has a page structure, adopt it"* is the single line that let four libraries drift into four page structures. The page list is now fixed by the standard. Added: what to do when a repository has no usage source at all — one `Components — Untiered` page and an admission on Getting Started, never a competing scheme.

- **`build-records.md`** gains `figma.documentationCardId`, the node every index row hyperlinks to. A record without it produces a row that cannot be jumped to.

- **`figma-component` step 12** — refresh the index after writing the build record, so the Getting Started page stops claiming the component is unbuilt.

- **`verify.py` goes from 12 checks to 26**, which is the standard's list exactly — the three places that name checks (`verify.py`, `skills/verify/SKILL.md`, the standard) are now identical sets. New blockers: `component-naming`, `component-description`, `documentation-adjacent`, `layers-named`, `mode-naming`, `no-scratch-pages`, `standard-version-stamped`, `verify-report-exists`. New majors: `collection-naming`, `fields-are-tables`, `two-usage-numbers`, `tier-thresholds-stated`, `known-gaps-current`. `documentation-links` is promoted from major to blocker. New flags: `--index`, `--builds`, `--brand`, `--out`.

- **`--out` writes the verify report**, and its absence is itself a blocker. A library that has never produced a report is not a finished library, and `figma-index` regenerates Known gaps from that file.

- **`completeness` no longer over-reports.** It matched on the human label where `components-built` matched on the machine name, and `_norm` strips underscores — so `Text Editor` and `text_editor` collapsed to one string and a file where nothing was named correctly reported 100% built while a blocker said the component was missing. Both now use one `built_keys()` builder, and the display name is never normalised. The headline coverage figure must never be the more generous of the two.

- **The verify state dump was wrong in two ways**, both found by running it against the live Paragraphs site file rather than a fixture. Figma node proxies *throw* on an unknown property instead of returning `undefined`, so the `n.findAll ? …` guard raised `TypeError` on a TEXT node; it now tests node type. And the Known-gaps capture matched the heading text only, returning `"Known gaps — read before trusting a card"` and nothing beneath it, which would have failed `known-gaps-current` on every run — it now takes the whole section.

- **A check with no subject now reports `N/A`, not `PASS`.** Measured on the Drupal authoring site, whose Figma file contains zero components: five component checks and one shot check had nothing to fail on, so the file scored 17 of 26 passing. It now scores 11 passed, 6 not applicable, 12 open. Reporting a vacuous pass is the same error as reporting an unrun check as passing, and it flatters exactly the libraries that deserve it least.

- **`pages-populated` no longer treats unloaded as empty.** Figma loads pages on demand and an unloaded page reports `0` children whatever it holds — the Drupal authoring site Atlas page reads `0` before `setCurrentPageAsync` and `76` after. The state dump took its counts from the root iteration, so this check would have fired on nearly every page of every file. Counts now come from the per-page pass, and a page never made current is reported as unmeasured rather than empty.

- **`code-syntax-resolves` degrades to `minor` when the theme has no compiled CSS.** Bootstrap-style frameworks emit their custom properties at build time, so grepping a repository whose `dist/` is gitignored reports every one as dangling — eight of them on the Drupal authoring site, at blocker severity, for properties that do resolve in the compiled `index.css` its own tokens.json cites.

  Run against real Paragraphs site state, the check set reports 11 of 44 components built and finds every component named by human label alone, 9 modes still called `Mode 1` or `Default`, `Acme Typography` and `Acme Type` splitting one domain, and 9 to 16 layers per card still named `Frame`.

## 0.9.0

**`design-lab:capture`** — the half of the pipeline that was living in a client repository. Measuring and photographing components was done for the Paragraphs site with scripts under `scripts/figma-spec/`, which meant the next project started from nothing. Ported, generalised and verified against the running Paragraphs site.

- **`measure.mjs`** — box model, typography, fills and borders per node per breakpoint. No images by design: everything it records becomes a native Figma node with bound variables
- **`capture.mjs`** — element-scoped screenshots per breakpoint per state, sharing the same config. `states[].setup` runs in both, so a component that must be opened to be visible opens identically when measured and when photographed. Playwright resolves from the **caller's** directory, not the plugin's, which a bare import gets wrong every time
- **`scaffold_configs.py`** — writes a config per component and, more usefully, names the ones that will silently produce nothing. It reads each component's Twig template for a root selector and reports where the answer came from. A classless root is reported as such: the Paragraphs site's `table_row` opens with a bare `<tr>`, so no selector is derivable and the scaffolder says so instead of guessing

The gap this closes, concretely: the Paragraphs site had four components with no config, therefore no measurements and no screenshots, and one of them — `table_row` — is the third most placed component on the site at 116 placements. Nothing surfaced it until `verify` counted. It is captured now, at 889 x 229 desktop.

Three traps are written into the skill because each produced wrong output: take the first match with real height rather than `.first()`, since pages hold empty instances of the same component; two components can share a root selector and the failure is invisible in a directory listing (five Paragraphs site components produced two distinct pictures); and never expand a component whose measurement recorded it collapsed, which produced a 6131px image captioned 1871px.

## 0.8.0

Three gaps found by running the plugin to completion on the Paragraphs site and then asking what it still would not have caught.

**A completeness figure on every run.** `verify` now prints `COMPLETENESS  N of M components built`, broken down by usage tier, whether or not anything else failed, and closes with a line saying the number needs a human answer. Partial coverage is the one defect that looks like success from the outside: eleven good components on four well-made pages read as a finished library right up until somebody counts. `figma-atlas` now opens by saying it is not the last step — it is very good at making a quarter-built library look complete, because every card it draws is a card that worked.

**Token integration rules that were only ever in someone's head.**
- `plan_variables.py` emits `LeadingRatio` and `Motion` for the CSS custom property source. `LeadingRatio` carries **no scopes**: CSS line-height is legally a length or a unitless ratio, Figma has no ratio-typed line-height variable, and binding 1.56 makes Figma read 1.56 *pixels* and collapse every line of text. Line-height no longer routes through the Type collection for this strategy, where it would have become a bindable pixel value
- `figma-foundation` now states that code syntax is set **only where the Figma value matches the code value**. Pointing a variable at a custom property holding a different number gives a name that resolves, looks right in Dev Mode, and is wrong. On the Paragraphs site that was 1 of 6 radius variables and 6 of 16 spacing variables; the rest were left with no code name
- Where no code name exists, the reason goes **on the variable**. `verify` accepts a description that addresses the absence and flags one that does not

**`figma-component` takes the component name.** `design-lab:figma-component <machine_name>`. With no argument it lists the unbuilt candidates and stops rather than choosing. The build sequence now carries what was learned building eleven of them by hand:
- **Every text node gets a TEXT property.** The step most often skipped and the one that decides whether a component is used at all — without it a designer detaches the instance to change one word, and a detached instance stops tracking the library. Five of the Paragraphs site's first seven had none
- **Every slot gets an INSTANCE_SWAP property**, composed from real instances of the components it accepts. A table containing three actual `table_row` instances shows the relationship; three static rows only look like it
- Property traps, each hit in practice: a colliding property name is silently renamed to `Content2`; a variant set needs the property wired in *every* variant, not just the default; never read `componentPropertyDefinitions` from a variant
- Read the description of any similarly-named component before writing a machine name. A library holding both `table` and `table_row` punishes a guess, and a wrong machine name is worse than none because it gets quoted downstream as fact

## 0.7.3

- `documentation-cards` understands the `<machine_name> — <Human Label> — documentation` card name from `references/findability.md`, not just `<Human Label> — documentation`. Renaming the cards to the documented convention made the check report all 44 as missing, which is the check being wrong rather than the file

## 0.7.2

- `code-syntax-set` now requires the description to *address* the blank, not merely to exist. The 0.7.1 version accepted any description and so passed ten Paragraphs site colours carrying unrelated notes from an earlier build — a false pass, which is precisely the failure this check exists to prevent. A verifier that can be satisfied by irrelevant text is worse than no verifier, because it converts an open question into a recorded pass

## 0.7.1

- `code-syntax-set` no longer flags a variable whose blank code name is explained. An absent code name is not automatically wrong — a Figma font style is a string where CSS carries a numeric weight, and a computed pixel line-height has no equivalent where the token is a unitless ratio. What separates a considered blank from an overlooked one is whether anyone wrote down why, so a description resolves it in place. Same fix-or-waive rule, recorded on the variable where the next person will read it rather than in a side file

## 0.7.0

**`design-lab:verify`** — the missing step. Every skill in this plugin reported success on its own work, and the Paragraphs site library still ended up with four empty Foundations pages, 36 of 43 components never built, not one component carrying a documentation link, and sixteen semantic variables whose Dev Mode code syntax named CSS custom properties that exist nowhere in the codebase. Each step passed. Nothing looked at the whole.

The rule it encodes: **an unmet expectation resolves to a fix or a recorded waiver, never to silence.** Waivers live in `waivers.json` with who decided, when and why, so declining something is durable rather than re-argued every run — and so the agent cannot quietly decide on the user's behalf.

Twelve checks, every one of them derived from something that actually went wrong:

| Check | Catches |
|---|---|
| `foundation-exists` | components built before variables |
| `code-syntax-resolves` | Dev Mode names that exist nowhere in the codebase |
| `components-built` | the plan said build, the file does not have it |
| `variable-scoped` | `ALL_SCOPES` |
| `code-syntax-set` | Dev Mode showing a bare number |
| `modes-earn-themselves` | modes whose values never differ |
| `documentation-links` | nothing leads from the Assets panel to the documentation |
| `documentation-cards` | a component with no card |
| `documentation-cards-unique` | two cards sharing a name |
| `pages-populated` | an empty page |
| `shot-frames-have-images` | a placeholder named like a capture |
| `breakpoints-share-scale` | per-frame scaling that hides responsive behaviour |
| `captures-unique` | two components whose selectors resolve to one element |

`code-syntax-resolves` is the one worth having on its own. It greps every code syntax against the real codebase, and it degrades to a `minor` "not checked" finding rather than a pass when `--theme-root` is absent — a check that did not run is not a check that passed, and conflating the two is the whole failure this release exists to stop.

First run against the Paragraphs site: 4 passed, 17 open, 0 waived.

## 0.6.0

`figma-atlas` specified a *text card* per component — a handful of lines of canvas text. Run against a real library that is visibly not documentation, and the comparison that proved it was Site Studio site B's existing component file, which had already solved this properly. Same lesson as `references/prior-art.md`: the existing artifact was better than the plugin's spec.

- **`figma-atlas` now specifies the full card anatomy** — 940-wide cards in a two-column grid: eyebrow with machine name, title, a stats row, verified live example, a Field/Type/Req./Limit table with explicit truncation, and a breakpoint row
- **One shared scale per component in the breakpoint row.** Scaling each breakpoint independently to fill its slot is the obvious implementation and it silently destroys the point: a 969px desktop and a 740px tablet render identical widths, so the component reads as not responsive. Hit while building the Paragraphs site's cards
- **`shot:` versus `scale:` naming.** A frame named `shot:<name>:<Breakpoint>` claims to hold a capture. When only measurements exist, the frame is a `scale:` diagram and the row says `measured, drawn to scale`. A grey box named `shot:` overstates the file's fidelity
- **`figma-component` step 8 now points documentation links at the atlas card**, and `figma-atlas` asserts they are set. An empty `documentationLinks` is the commonest way a library looks finished and is not — all seven of that site's built components had one
- **`references/verification.md`** gains four documentation assertions

## 0.5.0

`detect.py` could always *recommend* `css-custom-properties`. Nothing implemented it, so on a theme that had moved off Sass the recommended strategy had no extractor behind it. This adds the missing third token source, and it turns out to be the best of the three.

- **`extract_tokens_cssvars.py`** — the CSS custom property extractor. Reads only stylesheets a `*.libraries.yml` actually loads, prunes `core/` and `contrib/`, tracks the selector and media query per declaration, and resolves `var()` chains including the fallback argument. On the Paragraphs site's compiled-CSS branch: 94 tokens from 5 loaded stylesheets, against 1,023 from 174 before core was pruned
- **`plan_variables.py` derives the semantic layer for this strategy.** Custom properties are *authored*, so the names state intent where a Sass name does not. Colours are grouped by normalised hex; the member with no role word in its name is the palette entry and the rest alias it. The Paragraphs site gets 32 semantic variables across `text/*`, `surface/*`, `border/*` and `action/*` — the gap the 2026-08-31 comparison called the most important one, closed from evidence rather than invented
- **New collections** — `Radius`, `FontWeight`, `LetterSpacing`, each with correct scopes, driven by whatever the source actually declares
- **`typeScaling` is genuinely answerable here.** A token that scales must be redeclared under a media query, which is directly observable — unlike a Sass source map, where it is not. A `roleLevelCaveat` records what this still cannot see: a component rule that swaps which token it uses at a breakpoint. The Paragraphs site has 6 such rules

**Behaviour change, and it alters previously-shipped output.** `num()` is now unit-aware. Figma FLOAT variables are pixels, and the old reducer stripped the unit, so `2.25rem` became `2.25` — binding a 36px heading as **2.25 pixels**. This was already wrong on both verified Site Studio sites, not just on the new strategy:

| Site | Token | Was planned as | Now |
|---|---|---|---|
| Site Studio site A | `Blockquote Paragraph` font-size `1.1rem` | 1.1 px | 17.6 px |
| Site Studio site A | `Blockquote Paragraph` line-height `2rem` | 2 px | 32 px |
| Site Studio site B | `Breadcrumbs` margin `1.5rem` | 1.5 px | 24 px |

Percentages now return `None` rather than a bare number, because a percentage is not a pixel length and guessing one is worse than declining.

Otherwise regression-clean: every other value in the `variable-plan.json` of Site Studio sites A and B is unchanged.

## 0.4.0

The Figma half of the pipeline could not run on a Paragraphs site at all. `design-lab:detect` recommends `sass-sourcemap` for the Paragraphs site, and `plan_variables.py` crashed on its output with `KeyError: 'modes'` — so `figma-foundation` never ran, and `figma-component` refuses to start without it. Everything here came from running the plugin end to end against the Paragraphs site and hitting that wall.

- **`plan_variables.py` normalises token schemas instead of assuming one.** The three plug points vary independently, but the planner only ever read the Site Studio shape. It now maps `sass-sourcemap` output into the canonical shape and **refuses outright** on a schema it has no normaliser for. Defaulting the missing key was the tempting fix and the wrong one: every other lookup is `.get(...) or []`, so the planner would have reported four successful collections while silently discarding all 236 recovered tokens
- **`extract_tokens_sourcemap.py` emits `codeName`.** `references/tokens-and-variables.md` has always specified `$brand-blue` for this strategy; the extractor never wrote it, so every variable would have shown a raw hex in Dev Mode. All 64 of its primitives now carry one
- **`extract_tokens_sourcemap.py` evaluates `lighten()` and `darken()`.** Verified exactly: `lighten($periwinkle-dark, 10)` → `#7c92e5`, `lighten($periwinkle-dark, 20%)` → `#a7b6ed`. Both were previously recorded as Paragraphs site colours with **no configuration provenance**. They have exact provenance; the resolver just stopped at the function call
- **`typeScaling` is emitted explicitly as not observable**, rather than being absent. A source map has no CSS property and no media query attached to a declaration, so per-role scaling cannot be derived from it. `noneScale` now has three states — `true`, `false`, and `null` with `observable: false` — because an absent key read as "nothing scales" is the same error `figma-foundation` already warns about
- **`detect.py` performs the prior-art probe itself** and returns `priorArt` plus a leading `PRIOR ART:` note. It lived only in skill prose, so running the script directly skipped the single most expensive lesson in the plugin. It now also searches `reports/`, `docs/`, `design/` and `.storybook/`: on the Paragraphs site the old probe found **nothing**, while `reports/` held six artifacts including a complete Figma structure comparison
- **`extract_paragraphs.py` reads `default_value`** instead of hardcoding `None`. 0.2.0 measured this as set in 2 of 102 Paragraphs site field instances and then discarded it, leaving `plan.py` unable to compute the implicit unset option when deriving a variant axis

Regression: `variable-plan.json` is byte-identical to 0.3.0 on both Site Studio sites A and B.

Not fixed, recorded instead: the **semantic colour layer cannot be derived for this strategy.** Site Studio colours carry tags saying what they are *for*; a Sass variable carries only a name. `plan_variables.py` now emits one `semantic-layer-needs-authoring` warning rather than five identical near-misses, and the layer stays empty until a human names it.

## 0.3.0

Everything here came from running the plugin against Site Studio site B and discovering, afterwards, that a Figma file and a complete working toolchain already existed. Every difference was design-lab being worse.

- `references/prior-art.md` — look for an existing Figma file and existing repository tooling before extracting. `design-lab:detect` now begins with that probe
- `extract_tokens_sitestudio.py` rewritten to read `cohesion_website_settings` first: `cohesion_color` (the palette), `cohesion_font_stack` (families, with `$coh-font-*` resolved), `cohesion_scss_variable` (the spacer scale). Custom styles are now the component layer, emitted separately
- `plan_variables.py` carries the palette across intact and builds a semantic alias layer from the colours' own tags
- `find_examples.py` tiers are now **absolute** and gain two categories — `structural only` and `unused` — plus the Figma page each maps to
- `references/findability.md` prefers usage-tier pages over invented category pages
- Components are named `<machine_name> — <Human Label>`; Assets panel search is substring matching, so one name answers both `banner` and `cpt_cta`

What the greenfield run got wrong, measured:

| | greenfield | the existing answer |
|---|---|---|
| `cpt_text` placements | 26, from a 250-page crawl | **871**, from 2,448 production canvases |
| colour palette | 11 hexes named `card-fake-button` | **43** named colours with Sass variables |
| font families | unresolved `$coh-font-serif` | **Greta Text** |
| spacing | 23 deduped component ramps | `$spacer-xxs..xxxl`, a real 4-96 ramp |
| organisation | invented category pages | usage-tier pages already under review |

## 0.2.0

The Figma half of the pipeline, and three corrections to facts the pilot got wrong.

- `design-lab:usage` — verified anonymous example addresses, placement counts and tiers via `find_examples.py`. Addresses are crawled and status-checked, never read from a claim
- `design-lab:tokens` and `extract_tokens_sitestudio.py` — Site Studio custom styles to `tokens.json`, with per-breakpoint cascade and a `codeName` per token
- `design-lab:figma-foundation` — variable collections, modes, scopes and code syntax
- `design-lab:figma-component` — one component per invocation, with assertions and a build record, so a 146-component library survives context resets
- `design-lab:figma-atlas` — the searchable index page, including what was refused
- `references/findability.md` — the Assets panel searches names only; descriptions are not an index. Category pages and an atlas of canvas text are what make a large file navigable
- `references/tokens-and-variables.md`, `references/defaults.md`, `references/verification.md`, `references/build-records.md`

Corrections, each verified against the repositories:

- **Type does scale on Site Studio site A.** The pilot measured body text at 20/32 across breakpoints and built a single-mode type collection. 13 of 43 font-size tokens scale, Heading 2 among them at 48/48/42/36; Site Studio site B is 8 of 65. Scaling is a per-role fact
- **`coh-ce-<name>-<hash>` is not an instance marker.** It is stamped on every styled element of a component template - Site Studio site B's `cpt_content_card_0` carries eight hashes - so counting it inflates one site footer into 35 placements. The per-placement marker is `coh-component-instance-<uuid>`
- **Site Studio defaults live at `json_values.model.<uuid>.value`**, populated in 1,485 of 1,858 fields. Select options carry no default marker at all across 4,732 options. Paragraphs are the opposite: `default_value` is set in 2 of 102 Paragraphs site field instances

## 0.1.0

Initial skeleton.

- Universal component model (`references/model.md`) with three independent plug points
- Variant policy (`references/variant-policy.md`) with defaults, review flags and a hard stop
- `design-lab:detect` — strategy detection, verified on three real repositories
- `design-lab:inventory` — Site Studio and Single Directory Component extractors, doubling as a source lint
- Zero-dependency YAML fallback for Single Directory Components (no PyYAML on any local interpreter)
- `design-lab:plan` — build proposal with variant arithmetic and refusals
