---
name: run
description: >
  Build or refresh a complete Figma component library from a real codebase, beginning with
  source discovery and ending with whole-file verification. Use for end-to-end library work.
  Not for a single phase on its own — detection (design-lab:detect), extraction
  (design-lab:inventory), one component (design-lab:figma-component), or the final check
  (design-lab:verify).
---

# Run design-lab end to end

Own the whole outcome. Durable artifacts, not conversation memory, determine what is complete and where a resumed run continues. The run asks for everything it needs once, at preflight, and then completes on its own.

## Commands that never need approval

Run folders live outside the repository, and so do design-lab's own scripts. With Claude Code's read-blocking setting on, every command naming them waits for the person, even with permission checks bypassed, unless `design-lab:init` allowed design-lab's folders (the setup check below says so). Whatever the setting, keep commands to what Claude Code can check:

- Run every script with absolute paths and `--project <artifact-directory>`, one command at a time. Never `cd`, never assign shell variables, never write loops or `node -c` scripts.
- To see how a run is going, use `workflow.ts report <topic> --project <artifact-directory>`, where topic is `capture` (progress), `selectors` (components with no visible match), `plan` (what is built and why the rest is refused), `verify` (open findings) or `build` (steps recorded, failures). Read artifacts with the Read tool.
- When something new goes wrong and needs diagnosing, keep to plain commands with literal paths, one at a time; a fix that will be needed again belongs in a script, not in the session.

## Before anything else

Check design-lab is set up on this machine; it changes nothing:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/require-node.mjs && node ${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.ts check
```

If anything is `missing` (✗), stop and run `design-lab:init` first, then continue; `advice` (!) does not stop a run. Setup is about the person and the machine; preflight below is about this site.

To resume a run the person did not name, find this project's newest run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts watch` (run from the project or repository folder) prints its `Run folder:` line, which is `<artifact-directory>` from then on; resume from its artifacts.

When that newest run is already finished (its benchmark is done) and the person did not ask for a fresh run, offer both choices in one message: a fresh run, which captures the site again and takes hours, or `design-lab:figma-build`, which builds that run's capture and plan into a new, empty Figma file in minutes. Ask for the new file's address either way.

The design-lab pane opens beside the conversation by itself when this skill starts, and follows the run as its folder appears; never tell the person to open it. If they closed it, `/design-lab:watch` opens it again.

## Establish the project

Resolve the repository and an empty or existing target Figma file. Never mutate a reference file the user supplied only for comparison. Before the first Figma write, load the official Figma-use and library-generation guidance; `workflow.ts connect` checks the target when the build is ready to write.

Initialize one run folder per target library:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts init --repo <absolute-repository-path>
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts detect --project <artifact-directory>
```

Without `--workspace`, `init` creates the run folder by the person's convention (next to the project, `PROJECT/design/<date>`, or `~/.design/<project>/<date>`) and prints it: that folder is `<artifact-directory>` from here on. Give `--workspace` only when the person names a folder. Pass `--site-label`, `--site-url` and `--model` to `init`; the operator's name is the one signed in to Claude Code. Follow `references/benchmark.md`: every run ends with the benchmark.

Read `detection.json`. Reconcile prior art unless the user explicitly requested an independent scratch build; in that case keep comparison artifacts hidden until the build is frozen.

## Preflight: ask everything once

Before any extraction, gather every answer the run will need in one message to the person, using what the request and `detection.json` already say and asking only for the rest:

- the local site address, and the public address;
- the target Figma file: new and empty, editable by the person's account; it is first opened when the build is ready to write;
- a neutral site label (the operator's name is the one signed in to Claude Code; never ask for it);
- the component, token and usage sources: state the detector's recommendation and use it unless the person overrides it now;
- for a database usage source, the DDEV project root, and what to do if that source cannot be used after all: stop, or build without usage tiers;
- how the plan is approved: build the plan as proposed (the default, for runs left unattended) or stop for the person's review before building.

Schema churn is not a question: the run records any schema change or workaround it made, at the benchmark. Then record the answers and check what can be checked:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts preflight --project <artifact-directory> \
  --site-url <local-site-url> --public-url <public-site-url> --figma-url <file-url> \
  --site-label "<label>" [--model <model>] [--ddev-root <path>] \
  --plan-approval proposed|review [--usage-fallback stop|untiered]
```

Preflight checks that the local site answers, the required DDEV project is present, the runner port is free (or held only by a finished run's server, which `connect` stops later), node resolves Playwright in the folder given as `--node-cwd` or found in the repository (pass that folder to capture as `--node-cwd`), CairoSVG imports in baseline, and the plugin version matches the one recorded when this run began. When it can inspect the rendered page, it reports whether Twig debug markup is present; this check is informational. It records the target Figma URL but does not open Figma or start the runner. It prints the same go-ahead when every check passes, or lists what to fix first and why. Persist any source override the person gave:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts select --project <artifact-directory> \
  --component <strategy> --token <strategy> [--usage <strategy>] [--sitestudio-config <folder>]
```

On a Site Studio site, the export folder comes from the site's settings and is recorded at detection. When `detection.json` reports `siteStudio.problem`, find the folder holding the `cohesion_*.yml` export and record it with `--sitestudio-config` before preflight; preflight will not give the go-ahead without it.

## After the go-ahead, run to completion

Build one library at a time: a runner server serves exactly one run, for the best results in Figma desktop. Preflight names another run that is using the runner port and gives the command to stop it.

After preflight, complete the whole run through the benchmark and the completion message without pausing for confirmation. Do not ask whether to continue between phases or components, and do not report progress as a question. Decide everything the standard and the preflight answers decide, and record each decision in the artifacts. Only a genuine blocker, where no path forward exists without the person, may stop the run: Figma desktop was closed or the person stopped the runner plugin, the local site has stopped and cannot be restarted from here, or a failure has no fix in the templates or rules. The runner server is not one of them: if it has stopped, restart it (below); the token is the person's, not the server's, so the runner reconnects without them. When a genuine blocker happens, say first exactly what is needed, then why, reply with that message if the run ends there, and once it is provided, resume from the artifacts where the run stopped. The plan-approval stop happens only when the person chose review at preflight.

## Produce the review boundary

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts extract --project <artifact-directory>
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts usage --project <artifact-directory> \
  --ddev-root <running-ddev-project-root> [--ddev-project <name>]
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts variables --project <artifact-directory>
Run `design-lab:capture` and register `capture-evidence.json`.
node ${CLAUDE_PLUGIN_ROOT}/scripts/extract_voice.ts --project <artifact-directory> --base-url <local-site-url>
node ${CLAUDE_PLUGIN_ROOT}/scripts/extract_compositions.ts --project <artifact-directory> --base-url <local-site-url>
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts plan --project <artifact-directory>
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts validate --project <artifact-directory>
```

Usage is a plan prerequisite whenever detection finds a credible source. The deterministic Drupal extractor records direct placements and nested structural instances separately and merges them into canonical `components.json`. Do not substitute an ad-hoc query. Start DDEV if it is stopped. If the source genuinely cannot be made available, follow the choice made at preflight: with `--usage-fallback untiered`, record the degraded approval in the operator's name and continue; with `stop`, stop and ask for that approval, a genuine blocker:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts select --project <artifact-directory> \
  --usage none --degraded-reason "<why the detected source cannot be used>" \
  --by "<operator> (preflight: build untiered)"
```

That waiver requires a named human decision, which the preflight answer supplies, and means Untiered output. Never invent High/Medium/Low labels from configuration references or silently continue because DDEV was initially stopped. Capture is required for visual assets. A failed or unavailable capture makes that source entity `Not built — no visual evidence`; it never authorizes a speculative master.

Review `plan.json` flags, refusals, variant arithmetic, `variable-plan.json` warnings, and `render-evidence.json` yourself. The rendering artifact resolves each Drupal bundle to concrete Twig, SDC, stylesheet, root-class, and field-reference evidence; inspect those bounded paths for visual judgment instead of launching broad repository-search agents. Flags keep the treatment the plan proposes; components over the variant limit stay refused. The approval choice recorded at preflight governs the plan:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts approve --project <artifact-directory> --from-preflight
```

With "build the plan as proposed" this approves in the operator's name and the run continues. With "stop for my review" it refuses: show the person the plan summary, wait for their approval, record it with `--by <name>`, and continue.

## Render through the build driver

Every Figma write is a fixed template filled from the artifacts; the model relays and decides nothing. That is what makes two runs over the same source produce the same file.

1. When the build is ready to write, connect the runner. Run `workflow.ts connect` in the background and pass its instructions to the person as soon as they print; this is the run's one planned wait for the person after preflight. The first time on a machine they say to import the runner from `~/.design-lab/runner/manifest.json`; after a design-lab update they say to close the runner and start it again; every time they say to open the target file in Figma desktop and start the runner. If the runner asks for a token, the person copies it in their own terminal with `pbcopy < ~/.design-lab/runner-token`. Never read, print, copy or paste the token yourself.

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts connect --project <artifact-directory> [--runner-timeout 300]
   ```

   Wait for it to exit. With exit 0 the runner has confirmed the open file is the target and empty (or holds this run's own build, on a resume), made its first page the Cover page and drawn a name-only Cover through the real `cover.js`, which the build later fills in; go on to step 2. With exit 1 it prints what to do first, then why (no runner within the timeout, a different file open, a rejected token, an outdated runner, a file that is not empty, another run's server still active): reply with that message, and run `connect` again once it is fixed.

   After exit 0, `connect` has also asked Figma which fonts it can draw with and written the run's font plan, `fonts.json` (with Figma's list in `figma/available-fonts.json` and any Adobe Fonts kit read in `fonts-kits.json`). It prints the plan's lines to stderr: every family the site renders, and for each one Figma lacks, the stand-in the build uses by default and the steps to get the real font. Pass those lines to the person as they are, then go on to step 2. Never stop for a font. If the person later says they installed one, run `connect` again (it rewrites the plan from Figma's new list) and rebuild. `workflow.ts report fonts --project <artifact-directory>` shows the plan again at any time.

   Later, whenever the build seems stalled, check that the runner server is alive (restarting it if not, with no one needed in Figma) and that the runner has asked for a step in the last two minutes:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts runner --project <artifact-directory> --await-runner
   ```

   It returns at once while the runner is connected. If the runner has not asked for a step for about two minutes, it stops the run, logs the stop as an interruption with its phase, and prints the message to give the person, first what and then why: "Open Figma desktop, open <file address>, and start the design-lab runner. The build writes the component library into that file through the runner, and it has not connected for N minutes." Reply with that message. On resume, run the same command; once the runner connects, the build continues where it stopped.

2. Plan every step. This converts each captured component into its build tree and fixes the page list, order and contents:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.ts init --project <artifact-directory> \
     --file-key <key> --site-url <local-site-url> --canonical-base-url <public-site-url>
   ```

3. Relay until `next` reports `done`, exactly as `references/relay.md` describes. A long build can be relayed in batches by fresh agents; state lives on disk, so each batch resumes where the last stopped. Never hand-edit the file to fix a problem — fix the template or rule in `scripts/`, re-run `init` in a new file, and relay again.

4. Write and register the receipts the manifest needs (foundation, index, one build record per component):

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.ts receipts --project <artifact-directory>
   ```

5. Run `design-lab:verify`; fix every open finding at its source, or reclassify the component as not built with its reason. A waiver needs the person, so it is a genuine blocker only when neither is possible. Record one in `waivers.json` in the artifact directory with the check, a narrow scope, the reason, who decided, and the date, and pass `--waivers waivers.json`; a decision the person states plainly ("the fonts cannot be made available") is that decision. Known gaps still names a waived finding.

### Fix and rebuild without anyone in Figma

While fixing templates or rules against a built file, rebuild in place instead of creating a new file:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.ts init --project <artifact-directory> \
  --file-key <key> --site-url <local-site-url> --canonical-base-url <public-site-url> --rebuild --iterate
```

`--rebuild` starts with a `wipe` step that removes only design-lab's pages and variable collections (an empty page someone added is left alone; a page with content stops it). `--iterate` keeps the runner connected after the build, waiting for the next one, and skips the full node-tree dumps, which serve run-to-run comparison and take minutes on large pages; a build for the benchmark is run without `--iterate`. Never edit a template while a build is running; the build stops at the next step, and the runner waits for the next `init`. The runner must be restarted in Figma whenever the plugin's version changes: `workflow.ts runner --ensure` refreshes its files and says so.

`design-lab:figma-foundation`, `design-lab:figma-component` and `design-lab:figma-index` describe what their steps produce and how to diagnose them; they no longer build by hand.

Each component is built ONCE, as a responsive master (`src/responsive.ts`, `render/build_responsive.js`). Mobile and tablet are instances of it with the Breakpoint mode set — never separate components, never variants. `voice.json` adds the Brand Voice & Language foundation and `compositions.json` adds the Examples page, both built from instances and measured data only.

## Completion gate

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts validate --project <artifact-directory>
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts status --project <artifact-directory>
```

Do not call the library complete unless the manifest identifies the target Figma file, every in-scope visual component has a passing build record backed by capture evidence or an accurate not-built classification, and the saved whole-file verification report has no unwaived blocker or major finding.

## Benchmark and reply

The last step scores the run you just made (`design-lab:evaluate`). Record schema churn first, from what this run changed, without asking, then time the benchmark as its own step so library production and benchmarking stay separate in time and tokens:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts identity --project <artifact-directory> --no-schema-change   # or --schema-change "<what>"
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts record --project <artifact-directory> --phase benchmark --status running
node ${CLAUDE_PLUGIN_ROOT}/scripts/score_run.ts <artifact-directory> --session current
node ${CLAUDE_PLUGIN_ROOT}/scripts/scoreboard.ts record --run <artifact-directory> --tier 3 --open
open <artifact-directory>/benchmark/report.html
```

The scoreboard records this run as one row in the person's ledger and redraws the dashboard; both live where `~/.claude/design-lab.json` says. Both pages end on the person's screen: the benchmark report for this run in detail, the dashboard for how it compares with earlier runs. Without that configuration file, skip the scoreboard step and say so; the benchmark does not depend on it.

This writes `benchmark/report.html`, `benchmark/scorecard.json` and `benchmark/completion.md` inside the artifact directory. The benchmark ends when its report is finished: the scorer records that end in the phase log itself, so no separate command marks it complete, and a later re-score keeps the recorded end; a re-score runs the scorer alone, never a new start. The scorer then stops this run's runner server, so the next run finds the port free; `connect` also stops a server left behind by a run whose build has every step recorded, and says so. Reply to the user with the contents of `completion.md` exactly: the fixed template in `references/completion-message.md` filled with this run's values. It gives the Figma link, the coverage line, headline accuracy, time and tokens by model for producing the library and for the benchmark, the report as a clickable link labelled as the developer audit, what was not measured, and where the known gaps are listed. Do not paraphrase it or add numbers of your own.
