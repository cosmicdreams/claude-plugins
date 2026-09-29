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

## Establish the project

Resolve the repository and an empty or existing target Figma file. Never mutate a reference file the user supplied only for comparison. Before the first Figma write, load the official Figma-use and library-generation guidance; preflight proves the target can be written.

Initialize one workspace per target library:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py init \
  --repo <absolute-repository-path> --workspace <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py detect --project <artifact-directory>
```

Pass `--site-label`, `--site-url`, `--operator` and `--model` to `init` and follow `references/benchmark.md`: every run ends with the benchmark.

Read `detection.json`. Reconcile prior art unless the user explicitly requested an independent scratch build; in that case keep comparison artifacts hidden until the build is frozen.

## Preflight: ask everything once

Before any extraction, gather every answer the run will need in one message to the person, using what the request and `detection.json` already say and asking only for the rest:

- the local site address, and the public address;
- the target Figma file: new and empty, editable by the person's account; preflight proves it can be written;
- a neutral site label and the operator's name;
- the component, token and usage sources: state the detector's recommendation and use it unless the person overrides it now;
- for a database usage source, the DDEV project root, and what to do if that source cannot be used after all: stop, or build without usage tiers;
- how the plan is approved: build the plan as proposed (the default, for runs left unattended) or stop for the person's review before building.

Schema churn is not a question: the run records any schema change or workaround it made, at the benchmark. Then record the answers and check what can be checked:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py preflight --project <artifact-directory> \
  --site-url <local-site-url> --public-url <public-site-url> --figma-url <file-url> \
  --site-label "<label>" --operator "<name>" [--model <model>] [--ddev-root <path>] \
  --plan-approval proposed|review [--usage-fallback stop|untiered]
```

It checks that the local site answers and that a DDEV project is present where the usage source needs one, and records the Figma target. The run's end product is a Figma file, so preflight also proves the file can be written before anything long starts: it starts the runner server (or reuses the one serving this run), prints the runner token with the instruction to open the target file in Figma desktop and start the design-lab runner (`references/relay.md`), and waits for the runner, up to `--runner-timeout` seconds (300 by default). Run it in the background and give the person the token and that instruction as soon as it prints them. The runner confirms the open file is the target and is empty, turns its first page into the Cover page, and draws a name-only Cover there (the site's name and "Component Library", nothing else) through the real `cover.js`: the connection, page creation, IBM Plex Sans (or its fallback, which is reported), writing and plugin data are all proved. The build later fills in that same Cover. Preflight then either records the go-ahead (the `preflight` phase, with what the handshake proved) and prints "I have everything I need; it's safe to let this run to completion", or exits with exactly what is still missing and why: no runner within the timeout, a different file open, a rejected token, a file that is not empty, or a Cover that could not be drawn. It never gives the go-ahead without the drawn Cover. Tell the person that sentence, or what is missing, and run preflight again once it is fixed; the runner stays open, so a second handshake takes seconds. Persist any source override the person gave:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py select --project <artifact-directory> \
  --component <strategy> --token <strategy> [--usage <strategy>]
```

## After the go-ahead, run to completion

After preflight, complete the whole run through the benchmark and the completion message without pausing for confirmation. Do not ask whether to continue between phases or components, and do not report progress as a question. Decide everything the standard and the preflight answers decide, and record each decision in the artifacts. Only a genuine blocker, where no path forward exists without the person, may stop the run: Figma desktop was closed or the person stopped the runner plugin, the local site has stopped and cannot be restarted from here, or a failure has no fix in the templates or rules. The runner server is not one of them: if it has stopped, restart it (below); it keeps its token, so the runner reconnects without the person. When that happens, say exactly what is needed; once it is provided, resume from the artifacts where the run stopped. The plan-approval stop happens only when the person chose review at preflight.

## Produce the review boundary

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py extract --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py usage --project <artifact-directory> \
  --ddev-root <running-ddev-project-root> [--ddev-project <name>]
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py variables --project <artifact-directory>
Run `design-lab:capture` and register `capture-evidence.json`.
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_voice.py --project <artifact-directory> --base-url <local-site-url>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_compositions.py --project <artifact-directory> --base-url <local-site-url>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py plan --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py validate --project <artifact-directory>
```

Usage is a plan prerequisite whenever detection finds a credible source. The deterministic Drupal extractor records direct placements and nested structural instances separately and merges them into canonical `components.json`. Do not substitute an ad-hoc query. Start DDEV if it is stopped. If the source genuinely cannot be made available, follow the choice made at preflight: with `--usage-fallback untiered`, record the degraded approval in the operator's name and continue; with `stop`, stop and ask for that approval, a genuine blocker:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py select --project <artifact-directory> \
  --usage none --degraded-reason "<why the detected source cannot be used>" \
  --by "<operator> (preflight: build untiered)"
```

That waiver requires a named human decision, which the preflight answer supplies, and means Untiered output. Never invent High/Medium/Low labels from configuration references or silently continue because DDEV was initially stopped. Capture is required for visual assets. A failed or unavailable capture makes that source entity `Not built — no visual evidence`; it never authorizes a speculative master.

Review `plan.json` flags, refusals, variant arithmetic, `variable-plan.json` warnings, and `render-evidence.json` yourself. The rendering artifact resolves each Drupal bundle to concrete Twig, SDC, stylesheet, root-class, and field-reference evidence; inspect those bounded paths for visual judgment instead of launching broad repository-search agents. Flags keep the treatment the plan proposes; components over the variant limit stay refused. Approval is required before the first external Figma mutation and comes from preflight:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py approve --project <artifact-directory> --from-preflight
```

With "build the plan as proposed" this approves in the operator's name and the run continues. With "stop for my review" it refuses: show the person the plan summary, wait for their approval, record it with `--by <name>`, and continue.

## Render through the build driver

Every Figma write is a fixed template filled from the artifacts; the model relays and decides nothing. That is what makes two runs over the same source produce the same file.

1. The target was recorded at preflight, which proved it can be written and drew the name-only Cover. Check the runner server first, and start it again if it has stopped; it reuses the run's stored token, so nobody needs to do anything in Figma:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py runner --project <artifact-directory> --ensure
   ```

2. Plan every step. This converts each captured component into its build tree and fixes the page list, order and contents:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.py init --project <artifact-directory> \
     --file-key <key> --site-url <local-site-url> --canonical-base-url <public-site-url>
   ```

3. Relay until `next` reports `done`, exactly as `references/relay.md` describes. A long build can be relayed in batches by fresh agents; state lives on disk, so each batch resumes where the last stopped. Never hand-edit the file to fix a problem — fix the template or rule in `scripts/`, re-run `init` in a new file, and relay again.

4. Write and register the receipts the manifest needs (foundation, index, one build record per component):

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.py receipts --project <artifact-directory>
   ```

5. Run `design-lab:verify`; fix every open finding at its source, or reclassify the component as not built with its reason. A waiver needs the person, so it is a genuine blocker only when neither is possible.

`design-lab:figma-foundation`, `design-lab:figma-component` and `design-lab:figma-index` describe what their steps produce and how to diagnose them; they no longer build by hand.

Each component is built ONCE, as a responsive master (`scripts/responsive.py`, `render/build_responsive.js`). Mobile and tablet are instances of it with the Breakpoint mode set — never separate components, never variants. `voice.json` adds the Brand Voice & Language foundation and `compositions.json` adds the Examples page, both built from instances and measured data only.

## Completion gate

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py validate --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py status --project <artifact-directory>
```

Do not call the library complete unless the manifest identifies the target Figma file, every in-scope visual component has a passing build record backed by capture evidence or an accurate not-built classification, and the saved whole-file verification report has no unwaived blocker or major finding.

## Benchmark and reply

The last step scores the run you just made (`design-lab:evaluate`). Record schema churn first, from what this run changed, without asking, then time the benchmark as its own step so library production and benchmarking stay separate in time and tokens:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py identity --project <artifact-directory> --no-schema-change   # or --schema-change "<what>"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py record --project <artifact-directory> --phase benchmark --status running
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/score_run.py <artifact-directory> --session current
```

This writes `benchmark/report.html`, `benchmark/scorecard.json` and `benchmark/completion.md` inside the artifact directory. The benchmark ends when its report is finished: the scorer records that end in the phase log itself, so no separate command marks it complete, and a later re-score keeps the recorded end. Reply to the user with the contents of `completion.md` exactly: the fixed template in `references/completion-message.md` filled with this run's values. It gives the Figma link, the coverage line, headline accuracy, time and tokens by model for producing the library and for the benchmark, the report as a clickable link labelled as the developer audit, what was not measured, and where the known gaps are listed. Do not paraphrase it or add numbers of your own.
